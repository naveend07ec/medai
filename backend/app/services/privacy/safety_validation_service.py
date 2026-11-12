from datetime import date
import re
from typing import Any, Optional

from app.models.clinical_assessment import ClinicalAssessment
from app.schemas.knowledge import RetrievedChunkItem
from app.schemas.report import (
    DocumentExtractionSummary,
    EmergencyAlert,
    MedicalImageObservation,
    PredictiveExperimentReference,
    RetrievedSourceItem,
)
from app.services.multimodal.image_processor import load_sanitized_image_bytes

EMERGENCY_TRIAGE_DISCLAIMER = (
    "Automated keyword and vital-sign red-flag screening is a preliminary safety "
    "check and is NOT a clinically validated triage system."
)

PRIVACY_FILTER_NOTICE = (
    "Direct identifiers (names, contact numbers, dates of birth, patient codes) were "
    "excluded and pattern redaction was applied prior to external API calls. Basic "
    "PII filtering does not guarantee formal statistical anonymity."
)

_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
_ID_LABELED_RE = re.compile(
    r"\b(?:patient\s*name|name|dob|date\s*of\s*birth|phone|mobile|ssn)\s*[:=]\s*[^\n,;]+",
    re.IGNORECASE,
)

_PROHIBITED_DIAGNOSIS_PATTERNS = (
    re.compile(
        r"(?<!not a )(?<!not )(?<!no )\b(?:definitive diagnosis|confirmed diagnosis|final diagnosis)\b\s*(?:of|is|:)",
        re.IGNORECASE,
    ),
    re.compile(r"\bpatient definitely has\b", re.IGNORECASE),
    re.compile(r"\bwe diagnose (?:this|the) patient with\b", re.IGNORECASE),
)

_PROHIBITED_PRESCRIBING_PATTERNS = (
    re.compile(
        r"(?<!never )(?<!not )(?<!cannot )\b(?:prescribe|i recommend taking|start taking)\s+[A-Za-z]",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?<!never )(?<!not )\b(?:take|administer)\s+\d+(?:\.\d+)?\s*(?:mg|mcg|ml|units)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?<!never )(?<!not )\b(?:increase|decrease|double|stop)\s+(?:the\s+)?(?:dose|dosage|medication)\b",
        re.IGNORECASE,
    ),
)

_CHEST_PAIN_RE = re.compile(
    r"\b(?:chest pain|chest tightness|chest pressure|angina)\b", re.IGNORECASE
)
_BREATHLESS_RE = re.compile(
    r"\b(?:breathless(?:ness)?|shortness of breath|difficulty breathing|dyspnea|cannot breathe|can't breathe)\b",
    re.IGNORECASE,
)
_SEVERE_BREATHING_RE = re.compile(
    r"\b(?:severe breathing difficulty|respiratory distress|unable to breathe|cannot breathe|can't breathe|gasping for air|cyanosis|blue lips)\b",
    re.IGNORECASE,
)
_STROKE_RE = re.compile(
    r"\b(?:facial droop|face drooping|arm weakness|slurred speech|speech difficulty|sudden numbness|sudden confusion|sudden vision loss|stroke warning|hemiparesis)\b",
    re.IGNORECASE,
)
_UNCONSCIOUS_RE = re.compile(
    r"\b(?:unconscious(?:ness)?|unresponsive|loss of consciousness|passed out and not waking|active seizure|convulsions)\b",
    re.IGNORECASE,
)
_SEVERE_OTHER_RE = re.compile(
    r"\b(?:anaphylaxis|throat swelling|severe bleeding|uncontrolled bleeding|suicidal)\b",
    re.IGNORECASE,
)


class ClinicalSafetyValidationError(ValueError):
    """Raised when generated AI output fails schema, safety, or citation checks."""


class SafetyValidationService:
    """Performs independent emergency checks, PII filtering, and response safety validation."""

    def check_emergency(
        self,
        *,
        symptoms_text: str = "",
        context_text: str = "",
        oxygen_saturation: Optional[float] = None,
        systolic_bp: Optional[float] = None,
        diastolic_bp: Optional[float] = None,
    ) -> EmergencyAlert:
        """Evaluate emergency red-flag patterns before calling Gemini."""
        combined = f"{symptoms_text}\n{context_text}".strip()
        matched: list[str] = []

        if _CHEST_PAIN_RE.search(combined) and _BREATHLESS_RE.search(combined):
            matched.append("Chest pain accompanied by breathlessness")
        if _STROKE_RE.search(combined):
            matched.append("Possible stroke warning signs")
        if _SEVERE_BREATHING_RE.search(combined):
            matched.append("Severe breathing difficulty or respiratory distress")
        if _UNCONSCIOUS_RE.search(combined):
            matched.append("Unconsciousness, unresponsiveness, or active seizure")
        if _SEVERE_OTHER_RE.search(combined):
            matched.append("Critical acute warning keyword detected")

        if oxygen_saturation is not None and oxygen_saturation < 90.0:
            matched.append(f"Critically low oxygen saturation (SpO2 {oxygen_saturation:g}%)")
        if (
            (systolic_bp is not None and systolic_bp >= 180.0)
            or (diastolic_bp is not None and diastolic_bp >= 120.0)
        ) and combined:
            matched.append("Severely elevated blood pressure reading with reported symptoms")

        if matched:
            return EmergencyAlert(
                emergency_detected=True,
                urgency_level="emergency",
                matched_patterns=matched,
                emergency_guidance=(
                    "URGENT SAFETY WARNING: Potential emergency warning indicators were "
                    "detected (" + "; ".join(matched) + "). Seek immediate emergency "
                    "medical evaluation or contact local emergency services right away. "
                    "Do not delay emergency care for routine follow-up questions."
                ),
                triage_disclaimer=EMERGENCY_TRIAGE_DISCLAIMER,
            )

        return EmergencyAlert(
            emergency_detected=False,
            urgency_level="standard",
            matched_patterns=[],
            emergency_guidance=None,
            triage_disclaimer=EMERGENCY_TRIAGE_DISCLAIMER,
        )

    def redact_pii_text(self, text: Optional[str]) -> Optional[str]:
        """Strip obvious email, phone, and labeled identifier patterns from free text."""
        if text is None:
            return None
        cleaned = _EMAIL_RE.sub("[REDACTED_EMAIL]", text)
        cleaned = _PHONE_RE.sub("[REDACTED_PHONE]", cleaned)
        cleaned = _ID_LABELED_RE.sub("[REDACTED_IDENTIFIER]", cleaned)
        return cleaned.strip() or None

    @staticmethod
    def compute_age_years(dob: Optional[date]) -> Optional[int]:
        if dob is None:
            return None
        today = date.today()
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        return max(0, age)

    def build_deidentified_assessment_context(
        self, assessment: ClinicalAssessment
    ) -> tuple[dict[str, Any], list[str], list[str], PredictiveExperimentReference, EmergencyAlert]:
        """Extract de-identified context, deterministic findings, missing gaps, and ML separation."""
        patient = assessment.patient
        age_years = self.compute_age_years(patient.date_of_birth if patient else None)
        sex = patient.sex if patient and patient.sex else "Not specified"

        symptoms = self.redact_pii_text(assessment.current_symptoms)
        duration = self.redact_pii_text(assessment.symptom_duration)
        conditions = self.redact_pii_text(assessment.previous_conditions)
        medications = self.redact_pii_text(assessment.existing_medications)
        allergies_notes = self.redact_pii_text(assessment.medical_history_notes)
        demographics_notes = self.redact_pii_text(assessment.demographics_notes)
        lab_results = self.redact_pii_text(assessment.lab_results)
        ehr_summary = self.redact_pii_text(assessment.ehr_summary)
        previous_reports = self.redact_pii_text(assessment.previous_reports)
        imaging_notes = self.redact_pii_text(assessment.imaging_notes)
        family_markers = self.redact_pii_text(assessment.family_history_markers)
        genomic_notes = self.redact_pii_text(assessment.genomic_notes)

        attachments = list(getattr(assessment, "attachments", None) or [])
        doc_attachments = [att for att in attachments if att.kind == "document"]
        image_attachments = [att for att in attachments if att.kind == "image"]

        redacted_doc_entries: list[dict[str, str]] = []
        extracted_doc_texts: list[str] = []
        for doc in doc_attachments:
            if doc.extraction_status == "extracted" and doc.extracted_text:
                redacted = self.redact_pii_text(doc.extracted_text) or ""
                if redacted:
                    redacted_doc_entries.append(
                        {
                            "file_name": doc.original_filename,
                            "extraction_status": "extracted",
                            "extracted_text": redacted[:8000],
                        }
                    )
                    extracted_doc_texts.append(redacted)

        emergency_alert = self.check_emergency(
            symptoms_text=symptoms or "",
            context_text=" ".join(
                part
                for part in (
                    demographics_notes,
                    conditions,
                    ehr_summary,
                    lab_results,
                    *extracted_doc_texts,
                )
                if part
            ),
            oxygen_saturation=assessment.oxygen_saturation,
            systolic_bp=assessment.systolic_bp,
            diastolic_bp=assessment.diastolic_bp,
        )

        observed: list[str] = []
        missing: list[str] = []

        if age_years is not None or sex != "Not specified":
            observed.append(
                f"Demographics (de-identified): Age {age_years if age_years is not None else 'unknown'} years, Sex: {sex}."
            )
        if demographics_notes:
            observed.append(f"Assessment context: {demographics_notes}")

        if symptoms:
            dur = f" (duration: {duration})" if duration else ""
            observed.append(f"Patient-reported symptoms: {symptoms}{dur}.")
        else:
            missing.append("Current presenting symptoms were not recorded.")

        if conditions:
            observed.append(f"Previous medical conditions: {conditions}.")
        else:
            missing.append("Previous medical conditions history was not provided.")

        if medications:
            observed.append(f"Existing medications: {medications}.")
        else:
            missing.append("Current medication list and dosages were not provided.")

        if allergies_notes:
            observed.append(f"Allergies / medical history notes: {allergies_notes}.")
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
            vitals_parts.append(
                self.redact_pii_text(assessment.additional_measurements) or ""
            )
        vitals_parts = [v for v in vitals_parts if v]

        if vitals_parts:
            observed.append(f"Manually entered clinical measurements: {', '.join(vitals_parts)}.")
        else:
            missing.append("Structured clinical vital-sign measurements were not entered.")

        if lab_results:
            observed.append(f"Laboratory results: {lab_results}.")
        else:
            missing.append("Laboratory results were not provided.")

        if ehr_summary:
            observed.append(f"EHR / clinical summary: {ehr_summary}.")
        if previous_reports:
            observed.append(f"Previous reports summary: {previous_reports}.")

        processed_doc_names = {doc.original_filename for doc in doc_attachments}
        for doc in doc_attachments:
            if doc.extraction_status == "extracted" and doc.extracted_text:
                observed.append(
                    f"Extracted clinical document '{doc.original_filename}' "
                    f"({len(doc.extracted_text)} characters extracted)."
                )
            else:
                note = doc.extraction_note or "Readable text could not be extracted."
                missing.append(
                    f"Uploaded clinical document '{doc.original_filename}' could not be extracted: {note}"
                )

        unprocessed_legacy_names = [
            name for name in (assessment.attached_report_names or [])
            if name not in processed_doc_names
        ]
        if unprocessed_legacy_names:
            observed.append(
                f"Uploaded report metadata ({len(unprocessed_legacy_names)} file name(s); "
                "full uploaded report documents were not transmitted or parsed)."
            )
            missing.append(
                "Uploaded clinical report files were not extracted or analyzed."
            )

        if image_attachments:
            observed.append(
                f"Medical image attachments provided ({len(image_attachments)} file(s): "
                + ", ".join(f"{img.original_filename} [{img.modality}]" for img in image_attachments)
                + ")."
            )
            if imaging_notes:
                observed.append(f"Imaging context notes: {imaging_notes}.")
        elif assessment.attached_images or imaging_notes:
            count = len(assessment.attached_images)
            note_part = f" Notes: {imaging_notes}." if imaging_notes else ""
            observed.append(
                f"Medical image metadata ({count} attachment(s); raw image bytes were not uploaded for vision analysis).{note_part}"
            )
            missing.append(
                "Medical image bytes were not uploaded for automated observation; clinician imaging review is required."
            )
        else:
            missing.append("Medical imaging data was not provided.")

        if family_markers or genomic_notes:
            genomic_parts = [p for p in (family_markers, genomic_notes) if p]
            observed.append(
                f"Genomic / hereditary notes (not AI-analyzed): {' | '.join(genomic_parts)}."
            )
            missing.append("Automated genomic variant interpretation is not implemented.")

        observed = [item.strip() for item in observed if item and item.strip()]
        missing = [item.strip() for item in missing if item and item.strip()]

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
                    f"Class 1 prob = {res.get('class_1_probability')}."
                ),
            )
        else:
            predictive_ref = PredictiveExperimentReference(
                included=False,
                module_name=None,
                summary=pred.get(
                    "message",
                    "Optional disease-specific Pima diabetes predictive experiment was not executed.",
                ),
            )

        deidentified_context = {
            "patient_age_years": age_years,
            "patient_sex": sex,
            "observed_clinical_findings": observed,
            "extracted_clinical_documents": redacted_doc_entries,
            "attached_medical_images": [
                {
                    "image_name": img.original_filename,
                    "modality": img.modality,
                    "mime_type": img.mime_type,
                    "exif_stripped": img.exif_stripped,
                }
                for img in image_attachments
            ],
            "missing_information": missing,
            "separate_predictive_ml_output": predictive_ref.model_dump(),
            "emergency_precheck": emergency_alert.model_dump(),
            "privacy_notice": PRIVACY_FILTER_NOTICE,
        }
        return deidentified_context, observed, missing, predictive_ref, emergency_alert

    def extract_multimodal_attachments(
        self, assessment: ClinicalAssessment
    ) -> tuple[
        list[DocumentExtractionSummary],
        list[tuple[bytes, str, str, str]],
        list[MedicalImageObservation],
    ]:
        """Build sanitized document summaries and load stored image bytes for Gemini."""
        attachments = list(getattr(assessment, "attachments", None) or [])
        doc_summaries: list[DocumentExtractionSummary] = []
        image_inputs: list[tuple[bytes, str, str, str]] = []
        fallback_image_obs: list[MedicalImageObservation] = []

        for att in attachments:
            if att.kind == "document":
                if att.extraction_status == "extracted" and att.extracted_text:
                    redacted = self.redact_pii_text(att.extracted_text) or ""
                    doc_summaries.append(
                        DocumentExtractionSummary(
                            file_name=att.original_filename,
                            extraction_status="extracted",
                            summary_note=att.extraction_note or "Text extracted and PII-filtered.",
                            extracted_excerpt=redacted[:320],
                        )
                    )
                else:
                    doc_summaries.append(
                        DocumentExtractionSummary(
                            file_name=att.original_filename,
                            extraction_status=att.extraction_status,
                            summary_note=att.extraction_note
                            or "No readable text could be extracted from this document.",
                            extracted_excerpt=None,
                        )
                    )
            elif att.kind == "image":
                raw_bytes = load_sanitized_image_bytes(att.storage_path)
                if raw_bytes:
                    image_inputs.append(
                        (raw_bytes, att.mime_type, att.original_filename, att.modality)
                    )
                else:
                    fallback_image_obs.append(
                        MedicalImageObservation(
                            image_name=att.original_filename,
                            modality=att.modality,
                            processing_status="unreadable",
                            visibly_observed=[],
                            possible_indications=[],
                            uncertainties=[
                                "Image file bytes could not be read from secure storage."
                            ],
                            clinician_verification_needed=(
                                "Re-upload the image or have a qualified clinician inspect the original image."
                            ),
                            limitation_note=(
                                "Image could not be processed; no image findings were generated."
                            ),
                        )
                    )

        return doc_summaries, image_inputs, fallback_image_obs

    def verify_citations(
        self,
        cited_chunk_ids: list[str],
        retrieved_chunks: list[RetrievedChunkItem],
    ) -> tuple[list[RetrievedSourceItem], list[str]]:
        """Verify cited chunk IDs strictly match retrieved PostgreSQL + NumPy chunks."""
        chunk_map = {str(chunk.chunk_id): chunk for chunk in retrieved_chunks}
        verified: list[RetrievedSourceItem] = []
        seen_ids: set[str] = set()
        rejected: list[str] = []

        for raw_id in cited_chunk_ids:
            cid = str(raw_id).strip()
            if not cid:
                continue
            if cid not in chunk_map:
                rejected.append(cid)
                continue
            if cid in seen_ids:
                continue
            seen_ids.add(cid)
            matched = chunk_map[cid]
            verified.append(
                RetrievedSourceItem(
                    chunk_id=matched.chunk_id,
                    document_id=matched.document_id,
                    document_title=matched.document_title,
                    source_publisher=matched.source_publisher,
                    publication_date=matched.publication_date,
                    source_url=matched.source_url,
                    section_heading=matched.section_heading,
                    page_number=matched.page_number,
                    similarity_score=matched.similarity_score,
                    excerpt=matched.chunk_text[:400],
                )
            )

        return verified, rejected

    def validate_clinical_text_safety(
        self,
        texts_to_check: list[str],
        *,
        sufficient_evidence: bool,
        treatment_guidance_items: list[str],
        rejected_citations: list[str],
    ) -> None:
        """Reject unsupported diagnoses, autonomous prescribing, or fabricated citations."""
        if rejected_citations:
            raise ClinicalSafetyValidationError(
                "Generated response cited unverified source identifiers not present in retrieved chunks."
            )

        if not sufficient_evidence and treatment_guidance_items:
            raise ClinicalSafetyValidationError(
                "Generated response included treatment guidance despite insufficient retrieved evidence."
            )

        combined = "\n".join(text for text in texts_to_check if text)
        for pattern in _PROHIBITED_DIAGNOSIS_PATTERNS:
            if pattern.search(combined):
                raise ClinicalSafetyValidationError(
                    "Generated response contained an unsupported definitive diagnosis claim."
                )

        for pattern in _PROHIBITED_PRESCRIBING_PATTERNS:
            if pattern.search(combined):
                raise ClinicalSafetyValidationError(
                    "Generated response contained prohibited autonomous prescribing or dosage-change instructions."
                )


safety_validation_service = SafetyValidationService()

