from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class DiagnosticConsideration(BaseModel):
    """Non-definitive diagnostic consideration grounded in observed assessment data."""

    condition_or_pattern: str = Field(..., min_length=1, max_length=250)
    supporting_observed_evidence: list[str] = Field(default_factory=list)
    rationale: str = Field(..., min_length=1, max_length=2000)
    uncertainty_note: str = Field(..., min_length=1, max_length=1000)


class MedicalReferenceItem(BaseModel):
    """Verified medical reference returned by Medical RAG when connected."""

    title: str
    source: str
    guideline_or_citation: str
    relevance_note: str


class TreatmentSupportSection(BaseModel):
    """Treatment-support information strictly gated by verified medical references."""

    grounded_in_verified_references: bool
    retrieved_references: list[MedicalReferenceItem] = Field(default_factory=list)
    guidance_items: list[str] = Field(default_factory=list)
    status_note: str


class PredictiveExperimentReference(BaseModel):
    """Separates disease-specific predictive model output from generative AI insights."""

    included: bool
    module_name: Optional[str] = None
    summary: str


class DiagnosticReportContent(BaseModel):
    """Eight-section structured diagnostic report for clinician review."""

    patient_clinical_summary: str
    available_clinical_findings: list[str]
    ai_generated_diagnostic_insights: str
    possible_diagnostic_considerations: list[DiagnosticConsideration]
    missing_information_and_uncertainty: list[str]
    further_clinical_evaluation_considerations: list[str]
    personalized_treatment_support: TreatmentSupportSection
    clinician_review_and_safety_disclaimer: str
    predictive_model_separation_note: PredictiveExperimentReference
    research_context_note: str


class DiagnosticReportResponse(BaseModel):
    """API response representing a persisted diagnostic report."""

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


class GenAIHealthResponse(BaseModel):
    """Readiness status for the external GenAI diagnostic report service."""

    status: Literal["ready", "unavailable"]
    provider: str
    model_name: str
    rag_connected: bool
    detail: Optional[str] = None

