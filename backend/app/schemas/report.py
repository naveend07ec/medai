from datetime import date, datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class DiagnosticConsideration(BaseModel):
    """Non-definitive diagnostic consideration grounded in observed and retrieved data."""

    condition_or_pattern: str = Field(..., min_length=1, max_length=250)
    plain_language_explanation: Optional[str] = Field(default=None, max_length=1500)
    why_findings_point_here: Optional[str] = Field(default=None, max_length=1500)
    supporting_observed_evidence: list[str] = Field(default_factory=list)
    cited_chunk_ids: list[str] = Field(default_factory=list)
    rationale: str = Field(..., min_length=1, max_length=2000)
    uncertainty_note: str = Field(..., min_length=1, max_length=1000)


class FindingExplanation(BaseModel):
    """Plain-language explanation of an important symptom, vital sign, or lab finding."""

    finding_name: str = Field(..., min_length=1, max_length=200)
    observed_value: str = Field(..., min_length=1, max_length=300)
    reference_range_note: str = Field(..., min_length=1, max_length=400)
    status_flag: Literal[
        "within_range",
        "outside_range",
        "reported_symptom",
        "needs_confirmation",
    ] = "needs_confirmation"
    plain_language_meaning: str = Field(..., min_length=1, max_length=1000)
    why_it_matters: str = Field(..., min_length=1, max_length=1000)


class RetrievedSourceItem(BaseModel):
    """Verified medical chunk provenance mapped strictly from PostgreSQL + NumPy retrieval."""

    chunk_id: UUID
    document_id: UUID
    document_title: str
    source_publisher: str
    publication_date: Optional[date] = None
    source_url: Optional[str] = None
    section_heading: Optional[str] = None
    page_number: Optional[int] = None
    similarity_score: float = Field(..., ge=-1.0, le=1.0)
    excerpt: str


class TreatmentAndManagementSection(BaseModel):
    """Evidence-grounded treatment and management guidance requiring clinician review."""

    grounded_in_verified_references: bool
    guidance_items: list[str] = Field(default_factory=list)
    cited_chunk_ids: list[str] = Field(default_factory=list)
    status_note: str
    clinician_review_required: bool = True


class EmergencyAlert(BaseModel):
    """Independent keyword/vital red-flag screening output (not a validated triage system)."""

    emergency_detected: bool
    urgency_level: Literal["emergency", "standard"]
    matched_patterns: list[str] = Field(default_factory=list)
    emergency_guidance: Optional[str] = None
    triage_disclaimer: str


class PredictiveExperimentReference(BaseModel):
    """Separates disease-specific predictive ML output from GenAI / RAG explanations."""

    included: bool
    module_name: Optional[str] = None
    summary: str
    limitations: str = (
        "Tabular Pima dataset experiment output is statistical only and is never "
        "a substitute for generative clinical synthesis or a confirmed diagnosis."
    )


class DocumentExtractionSummary(BaseModel):
    """Summary of an uploaded clinical document's extraction and provenance."""

    file_name: str
    extraction_status: str
    summary_note: Optional[str] = None
    extracted_excerpt: Optional[str] = None


class MedicalImageObservation(BaseModel):
    """Structured, non-definitive observation for a supported medical image."""

    image_name: str = Field(..., min_length=1, max_length=255)
    modality: str = Field(..., min_length=1, max_length=60)
    processing_status: Literal["analyzed", "unreadable", "not_provided"] = "analyzed"
    visibly_observed: list[str] = Field(default_factory=list)
    possible_indications: list[str] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    clinician_verification_needed: str = Field(
        default="A qualified radiologist or clinician should review the original image directly."
    )
    limitation_note: str = Field(
        default="AI image observations are preliminary decision support only and not a validated radiology read."
    )


class DiagnosticReportContent(BaseModel):
    """Structured RAG clinical report with plain-language explanations for clinician & patient review."""

    patient_context_summary: str = Field(..., min_length=1)
    relevant_clinical_findings: list[str] = Field(default_factory=list)
    finding_explanations: list[FindingExplanation] = Field(default_factory=list)
    extracted_document_summaries: list[DocumentExtractionSummary] = Field(
        default_factory=list
    )
    image_observations: list[MedicalImageObservation] = Field(default_factory=list)
    possible_diagnostic_considerations: list[DiagnosticConsideration] = Field(
        default_factory=list
    )
    supporting_medical_evidence: str = Field(..., min_length=1)
    additional_information_required: list[str] = Field(default_factory=list)
    doctor_discussion_points: list[str] = Field(default_factory=list)
    risk_indicators_and_safety_warnings: list[str] = Field(default_factory=list)
    treatment_and_management_information: TreatmentAndManagementSection
    clinical_limitations: list[str] = Field(..., min_length=1)
    retrieved_sources: list[RetrievedSourceItem] = Field(default_factory=list)

    emergency_alert: EmergencyAlert
    evidence_sufficient: bool
    generated_by_gemini: bool = True
    predictive_ml_output: PredictiveExperimentReference
    research_context_note: str
    clinician_review_disclaimer: str


class DiagnosticReportResponse(BaseModel):
    """API response representing a persisted structured diagnostic report."""

    id: UUID
    assessment_id: UUID
    provider: str
    model_name: str
    report: DiagnosticReportContent
    clinician_reviewed: bool
    clinician_notes: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class DiagnosticReportReviewUpdate(BaseModel):
    """Request payload for updating clinician review status on a generated report."""

    clinician_reviewed: bool
    clinician_notes: Optional[str] = Field(default=None, max_length=4000)


class RagQueryRequest(BaseModel):
    """Clinical question request for RAG-grounded decision support."""

    question: str = Field(..., min_length=3, max_length=2000)
    clinical_context: Optional[str] = Field(default=None, max_length=4000)
    top_k: Optional[int] = Field(default=None, ge=1, le=20)
    min_similarity: Optional[float] = Field(default=None, ge=0.0, le=1.0)

    @field_validator("question")
    @classmethod
    def strip_question(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 3:
            raise ValueError("Clinical question must contain at least 3 characters.")
        return cleaned

    @field_validator("clinical_context")
    @classmethod
    def strip_context(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class RagQueryResponse(BaseModel):
    """Structured RAG clinical Q&A response with safety triage and provenance."""

    status: Literal["completed", "emergency_warning_only"]
    generated_by_gemini: bool
    gemini_available: bool
    provider: str
    model_name: str
    emergency_alert: EmergencyAlert
    report: Optional[DiagnosticReportContent] = None
    notice: Optional[str] = None


class GenAIHealthResponse(BaseModel):
    """Readiness status for the Gemini API and Medical RAG services."""

    status: Literal["ready", "unavailable"]
    provider: str
    model_name: str
    embedding_model: str
    rag_connected: bool
    indexed_documents: int = 0
    indexed_chunks: int = 0
    demo_mode: bool = False
    detail: Optional[str] = None
