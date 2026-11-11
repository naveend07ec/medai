from datetime import date
import json
import logging
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

from app.core.config import Settings
from app.models.clinical_assessment import ClinicalAssessment
from app.schemas.report import (
    DiagnosticConsideration,
    DiagnosticReportContent,
    GenAIHealthResponse,
    PredictiveExperimentReference,
)
from app.services.medical_rag import retrieve_verified_medical_references
from app.services.treatment_support import build_treatment_support_section

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = {"gemini", "openai_compatible"}

SAFETY_DISCLAIMER = (
    "Clinician Review Required — Research Prototype Output Only. Observed findings "
    "reflect recorded intake inputs, whereas diagnostic insights and considerations "
    "are AI-generated interpretations for clinical review. This report is not a "
    "definitive medical diagnosis, has not undergone clinical validation, and never "
    "constitutes an autonomous prescription or treatment order."
)

RESEARCH_CONTEXT_NOTE = (
    "Platform Research Context: Any Pima diabetes XGBoost output is a separate "
    "disease-specific tabular probability estimate (not a general diagnostic model). "
    "Colab GAN synthetic healthcare data experiments and Paillier homomorphic "
    "encryption / multi-hospital aggregation experiments are offline research "
    "components and are not executed during live GenAI report generation."
)


class GenAIUnavailableError(RuntimeError):
    """Raised when the external GenAI provider is unconfigured or unreachable."""


class _LLMGeneratedSections(BaseModel):
    """Validated JSON schema expected from the external GenAI provider."""

    patient_clinical_summary: str = Field(..., min_length=10, max_length=3000)
    ai_generated_diagnostic_insights: str = Field(..., min_length=10, max_length=4000)
    possible_diagnostic_considerations: list[DiagnosticConsideration] = Field(
        default_factory=list,
        max_length=8,
    )
    additional_missing_or_uncertainty: list[str] = Field(
        default_factory=list,
        max_length=10,
    )
    further_clinical_evaluation_considerations: list[str] = Field(
        default_factory=list,
        max_length=10,
    )


def _compute_age_years(dob: Optional[date]) -> Optional[int]:
    if dob is None:
        return None
    today = date.today()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    return max(0, age)


def _extract_observed_and_missing(
    assessment: ClinicalAssessment,
) -> tuple[list[str], list[str], dict[str, Any], PredictiveExperimentReference]:
    """Build deterministic observed findings and missing-data inventory from DB state."""
    patient = assessment.patient
    age_years = _compute_age_years(patient.date_of_birth if patient else None)
    sex = patient.sex if patient and patient.sex else "Not specified"

    observed: list[str] = []
    missing: list[str] = []

    if age_years is not None or sex != "Not specified":
        observed.append(
            f"Demographics: Age {age_years if age_years is not None else 'unknown'} years, Sex: {sex}."
        )
    if assessment.demographics_notes:
        observed.append(f"Visit context notes: {assessment.demographics_notes}")

    if assessment.current_symptoms:
        duration_suffix = (
            f" (duration: {assessment.symptom_duration})"
            if assessment.symptom_duration
            else ""
        )
        observed.append(
            f"Reported symptoms: {assessment.current_symptoms}{duration_suffix}."
        )
    else:
        missing.append("Current presenting symptoms were not recorded.")

    if assessment.previous_conditions:
        observed.append(
            f"Previous medical conditions: {assessment.previous_conditions}."
        )
    else:
        missing.append("Previous medical conditions history was not provided.")

    if assessment.existing_medications:
        observed.append(f"Existing medications: {assessment.existing_medications}.")
    else:
        missing.append("Current medication list and dosages were not provided.")

    if assessment.medical_history_notes:
        observed.append(f"Allergies / medical history notes: {assessment.medical_history_notes}.")
    else:
        missing.append("Known allergies status was not recorded.")

    vitals_parts: list[str] = []
    if assessment.systolic_bp is not None or assessment.diastolic_bp is not None:
        sbp = f"{assessment.systolic_bp:g}" if assessment.systolic_bp is not None else "—"
        dbp = f"{assessment.diastolic_bp:g}" if assessment.diastolic_bp is not None else "—"
        vitals_parts.append(f"BP {sbp}/{dbp} mm Hg")
    if assessment.heart_rate is not None:
        vitals_parts.append(f"HR {assessment.heart_rate:g} bpm")
    if assessment.body_temperature is not None:
        vitals_parts.append(f"Temp {assessment.body_temperature:g} °C")
    if assessment.oxygen_saturation is not None:
        vitals_parts.append(f"SpO2 {assessment.oxygen_saturation:g}%")
    if assessment.additional_measurements:
        vitals_parts.append(assessment.additional_measurements)

    if vitals_parts:
        observed.append(f"Clinical measurements: {', '.join(vitals_parts)}.")
    else:
        missing.append("Structured clinical vital-sign measurements were not entered.")

    if assessment.lab_results:
        observed.append(f"Laboratory results: {assessment.lab_results}.")
    else:
        missing.append("Laboratory results were not provided.")

    if assessment.ehr_summary:
        observed.append(f"EHR / clinical notes: {assessment.ehr_summary}.")
    if assessment.previous_reports:
        observed.append(f"Previous clinical reports: {assessment.previous_reports}.")
    if assessment.attached_report_names:
        observed.append(
            "Attached report metadata (file names only; contents not parsed): "
            + ", ".join(assessment.attached_report_names)
            + "."
        )
        missing.append(
            "Attached report files were not automatically extracted or parsed for text analysis."
        )

    if assessment.attached_images or assessment.imaging_notes:
        img_names = [img.get("name", "unnamed") for img in assessment.attached_images]
        img_desc = ", ".join(img_names) if img_names else "none attached"
        notes_part = f" Notes: {assessment.imaging_notes}." if assessment.imaging_notes else ""
        observed.append(
            f"Medical imaging metadata (not AI-analyzed): {img_desc}.{notes_part}"
        )
        missing.append(
            "Automated medical image interpretation is not integrated; clinician visual review is required."
        )
    else:
        missing.append("Medical imaging data was not provided.")

    if assessment.family_history_markers or assessment.genomic_notes:
        genomic_parts = [
            p
            for p in (assessment.family_history_markers, assessment.genomic_notes)
            if p
        ]
        observed.append(
            f"Genomic / hereditary reference notes (not AI-analyzed): {' | '.join(genomic_parts)}."
        )
        missing.append(
            "Automated genomic variant analysis is not implemented."
        )
    else:
        missing.append("Genomic information was not provided.")

    # Separate disease-specific predictive model results from generative insights
    pred = assessment.predictive_experiment_result or {}
    if pred.get("status") == "completed" and isinstance(pred.get("result"), dict):
        res = pred["result"]
        predictive_ref = PredictiveExperimentReference(
            included=True,
            module_name=res.get("module_name", "Diabetes prediction experiment"),
            summary=(
                f"Separate XGBoost Pima Diabetes Experiment ({res.get('model_name', 'xgboost')}, "
                f"{res.get('model_version', 'v1')}): Predicted Class {res.get('predicted_class')}; "
                f"Class 0 prob = {res.get('class_0_probability')}, "
                f"Class 1 prob = {res.get('class_1_probability')}. "
                "Statistical tabular estimate only — not a medical diagnosis."
            ),
        )
    else:
        predictive_ref = PredictiveExperimentReference(
            included=False,
            module_name=None,
            summary=pred.get(
                "message",
                "Optional disease-specific Pima diabetes predictive experiment was not executed for this assessment.",
            ),
        )

    deidentified_context = {
        "patient_age_years": age_years,
        "patient_sex": sex,
        "observed_findings": observed,
        "missing_information": missing,
        "separate_predictive_experiment": predictive_ref.model_dump(),
        "medical_rag_connected": False,
    }
    return observed, missing, deidentified_context, predictive_ref


def _strip_markdown_fences(raw_text: str) -> str:
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) >= 2 and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text


def _build_clinical_prompt(deidentified_context: dict[str, Any]) -> tuple[str, str]:
    system_instruction = (
        "You are a cautious clinical decision-support assistant in a research prototype. "
        "Analyze ONLY the de-identified clinical findings supplied in JSON. "
        "STRICT RULES:\n"
        "1. Never claim diagnostic certainty or issue a definitive diagnosis.\n"
        "2. Never prescribe medications or invent ungrounded treatment citations.\n"
        "3. Clearly distinguish observed facts from AI-generated interpretations.\n"
        "4. Explicitly identify missing clinical information and uncertainty.\n"
        "5. Do not treat a Pima diabetes tabular probability as a general-purpose diagnosis.\n"
        "6. Return ONLY valid JSON matching the exact schema:\n"
        "{\n"
        '  "patient_clinical_summary": "concise clinical synthesis of available info",\n'
        '  "ai_generated_diagnostic_insights": "structured AI interpretation noting uncertainty",\n'
        '  "possible_diagnostic_considerations": [\n'
        "    {\n"
        '      "condition_or_pattern": "non-definitive differential possibility",\n'
        '      "supporting_observed_evidence": ["observed finding 1"],\n'
        '      "rationale": "why this pattern may warrant clinician consideration",\n'
        '      "uncertainty_note": "specific gaps or limitations"\n'
        "    }\n"
        "  ],\n"
        '  "additional_missing_or_uncertainty": ["uncertainty item"],\n'
        '  "further_clinical_evaluation_considerations": ["clinician evaluation or workup question"]\n'
        "}"
    )

    user_content = (
        "Analyze this de-identified clinical assessment payload and produce the JSON report:\n"
        + json.dumps(deidentified_context, indent=2)
    )
    return system_instruction, user_content


class GenAIDiagnosticService:
    """Generates structured diagnostic insight reports from saved clinical assessments."""

    def __init__(self, settings_override: Optional[Settings] = None) -> None:
        self._settings_override = settings_override

    def _get_settings(self) -> Settings:
        return self._settings_override or Settings()

    def health_status(self) -> GenAIHealthResponse:
        current = self._get_settings()
        provider = current.GENAI_PROVIDER.strip().lower()
        rag_connected, _, _ = retrieve_verified_medical_references()

        if provider not in SUPPORTED_PROVIDERS:
            return GenAIHealthResponse(
                status="unavailable",
                provider=provider,
                model_name=current.GENAI_MODEL,
                rag_connected=rag_connected,
                detail="Configured GenAI provider is not supported.",
            )

        if not current.GENAI_API_KEY or not current.GENAI_API_KEY.strip():
            return GenAIHealthResponse(
                status="unavailable",
                provider=provider,
                model_name=current.GENAI_MODEL,
                rag_connected=rag_connected,
                detail=(
                    "External GenAI credentials are not configured. Set GENAI_API_KEY "
                    "in backend/.env to enable AI diagnostic report generation."
                ),
            )

        return GenAIHealthResponse(
            status="ready",
            provider=provider,
            model_name=current.GENAI_MODEL,
            rag_connected=rag_connected,
            detail=None,
        )

    def _call_provider(
        self,
        current: Settings,
        system_instruction: str,
        user_content: str,
    ) -> str:
        provider = current.GENAI_PROVIDER.strip().lower()
        api_key = (current.GENAI_API_KEY or "").strip()
        if not api_key:
            raise GenAIUnavailableError(
                "GenAI diagnostic report service is unavailable because GENAI_API_KEY is not configured."
            )

        if provider not in SUPPORTED_PROVIDERS:
            raise GenAIUnavailableError(
                f"Configured GenAI provider '{provider}' is not supported."
            )

        try:
            with httpx.Client(timeout=current.GENAI_TIMEOUT_SECONDS) as client:
                if provider == "gemini":
                    base_url = (
                        current.GENAI_BASE_URL
                        or "https://generativelanguage.googleapis.com/v1beta"
                    ).rstrip("/")
                    url = f"{base_url}/models/{current.GENAI_MODEL}:generateContent"
                    response = client.post(
                        url,
                        headers={
                            "x-goog-api-key": api_key,
                            "Content-Type": "application/json",
                        },
                        json={
                            "systemInstruction": {
                                "parts": [{"text": system_instruction}]
                            },
                            "contents": [
                                {"role": "user", "parts": [{"text": user_content}]}
                            ],
                            "generationConfig": {
                                "temperature": 0.2,
                                "responseMimeType": "application/json",
                            },
                        },
                    )
                    response.raise_for_status()
                    payload = response.json()
                    candidates = payload.get("candidates") or []
                    if not candidates:
                        raise ValueError("No candidates returned by Gemini provider.")
                    parts = (candidates[0].get("content") or {}).get("parts") or []
                    if not parts or "text" not in parts[0]:
                        raise ValueError("Malformed Gemini response content.")
                    return str(parts[0]["text"])

                base_url = (
                    current.GENAI_BASE_URL or "https://api.openai.com/v1"
                ).rstrip("/")
                url = f"{base_url}/chat/completions"
                response = client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": current.GENAI_MODEL,
                        "temperature": 0.2,
                        "response_format": {"type": "json_object"},
                        "messages": [
                            {"role": "system", "content": system_instruction},
                            {"role": "user", "content": user_content},
                        ],
                    },
                )
                response.raise_for_status()
                payload = response.json()
                choices = payload.get("choices") or []
                if not choices:
                    raise ValueError("No choices returned by OpenAI-compatible provider.")
                message = choices[0].get("message") or {}
                content = message.get("content")
                if not content:
                    raise ValueError("Empty content returned by OpenAI-compatible provider.")
                return str(content)
        except httpx.TimeoutException as exc:
            logger.warning("GenAI provider request timed out.")
            raise GenAIUnavailableError(
                "External GenAI service timed out. Please try again later."
            ) from exc
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "GenAI provider returned HTTP %s.", exc.response.status_code
            )
            raise GenAIUnavailableError(
                "External GenAI service rejected the request or is temporarily unavailable."
            ) from exc
        except httpx.HTTPError as exc:
            logger.warning("Network error communicating with GenAI provider.")
            raise GenAIUnavailableError(
                "Unable to reach the external GenAI service."
            ) from exc
        except Exception as exc:
            logger.warning("Unexpected error parsing external GenAI response.")
            raise GenAIUnavailableError(
                "External GenAI service returned an unreadable response."
            ) from exc

    def generate_report(
        self, assessment: ClinicalAssessment
    ) -> tuple[str, str, DiagnosticReportContent]:
        """Generate an 8-section structured diagnostic report for a saved assessment."""
        current = self._get_settings()
        health = self.health_status()
        if health.status != "ready":
            raise GenAIUnavailableError(
                health.detail or "External GenAI diagnostic service is unavailable."
            )

        observed, missing, deidentified_context, predictive_ref = (
            _extract_observed_and_missing(assessment)
        )
        system_instruction, user_content = _build_clinical_prompt(deidentified_context)

        raw_text = self._call_provider(current, system_instruction, user_content)
        cleaned_json = _strip_markdown_fences(raw_text)

        try:
            parsed_llm = _LLMGeneratedSections.model_validate_json(cleaned_json)
        except Exception as exc:
            logger.warning("GenAI provider JSON did not match required report schema.")
            raise GenAIUnavailableError(
                "External GenAI response did not match the required structured report format."
            ) from exc

        rag_connected, retrieved_refs, rag_note = retrieve_verified_medical_references()
        treatment_support = build_treatment_support_section(
            rag_connected=rag_connected,
            retrieved_references=retrieved_refs,
            rag_status_note=rag_note,
        )

        combined_missing = list(missing)
        for item in parsed_llm.additional_missing_or_uncertainty:
            cleaned = item.strip()
            if cleaned and cleaned not in combined_missing:
                combined_missing.append(cleaned)

        report_content = DiagnosticReportContent(
            patient_clinical_summary=parsed_llm.patient_clinical_summary.strip(),
            available_clinical_findings=observed,
            ai_generated_diagnostic_insights=parsed_llm.ai_generated_diagnostic_insights.strip(),
            possible_diagnostic_considerations=parsed_llm.possible_diagnostic_considerations,
            missing_information_and_uncertainty=combined_missing,
            further_clinical_evaluation_considerations=[
                item.strip()
                for item in parsed_llm.further_clinical_evaluation_considerations
                if item.strip()
            ],
            personalized_treatment_support=treatment_support,
            clinician_review_and_safety_disclaimer=SAFETY_DISCLAIMER,
            predictive_model_separation_note=predictive_ref,
            research_context_note=RESEARCH_CONTEXT_NOTE,
        )

        return (
            current.GENAI_PROVIDER.strip().lower(),
            current.GENAI_MODEL,
            report_content,
        )


genai_diagnostic_service = GenAIDiagnosticService()

