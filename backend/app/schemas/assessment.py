from datetime import datetime
import math
from typing import Any, Optional
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.schemas.patient import PatientResponse


class AttachedImageMetadata(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    size_label: str = Field(..., min_length=1, max_length=50)
    type: str = Field(..., min_length=1, max_length=100)


class ClinicalAssessmentCreate(BaseModel):
    """Request payload for creating a clinical assessment linked to a patient."""

    patient_id: UUID

    demographics_notes: Optional[str] = Field(default=None, max_length=2000)

    current_symptoms: Optional[str] = Field(default=None, max_length=4000)
    symptom_duration: Optional[str] = Field(default=None, max_length=120)
    previous_conditions: Optional[str] = Field(default=None, max_length=4000)
    existing_medications: Optional[str] = Field(default=None, max_length=4000)
    medical_history_notes: Optional[str] = Field(default=None, max_length=4000)

    systolic_bp: Optional[float] = Field(default=None, ge=50, le=280)
    diastolic_bp: Optional[float] = Field(default=None, ge=30, le=180)
    heart_rate: Optional[float] = Field(default=None, ge=25, le=250)
    body_temperature: Optional[float] = Field(default=None, ge=30, le=45)
    oxygen_saturation: Optional[float] = Field(default=None, ge=40, le=100)
    additional_measurements: Optional[str] = Field(default=None, max_length=2000)

    lab_results: Optional[str] = Field(default=None, max_length=4000)
    ehr_summary: Optional[str] = Field(default=None, max_length=4000)
    previous_reports: Optional[str] = Field(default=None, max_length=4000)
    attached_report_names: list[str] = Field(default_factory=list, max_length=50)

    attached_images: list[AttachedImageMetadata] = Field(
        default_factory=list,
        max_length=50,
    )
    imaging_notes: Optional[str] = Field(default=None, max_length=2000)

    genomic_notes: Optional[str] = Field(default=None, max_length=4000)
    family_history_markers: Optional[str] = Field(default=None, max_length=2000)

    preprocessing_summary: Optional[dict[str, Any]] = None
    predictive_experiment_result: Optional[dict[str, Any]] = None
    clinician_reviewed: bool = False

    @field_validator(
        "systolic_bp",
        "diastolic_bp",
        "heart_rate",
        "body_temperature",
        "oxygen_saturation",
    )
    @classmethod
    def ensure_finite_optional_float(cls, value: Optional[float]) -> Optional[float]:
        if value is not None and not math.isfinite(value):
            raise ValueError("Measurement value must be a finite number.")
        return value

    @field_validator(
        "demographics_notes",
        "current_symptoms",
        "symptom_duration",
        "previous_conditions",
        "existing_medications",
        "medical_history_notes",
        "additional_measurements",
        "lab_results",
        "ehr_summary",
        "previous_reports",
        "imaging_notes",
        "genomic_notes",
        "family_history_markers",
    )
    @classmethod
    def normalize_optional_strings(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @model_validator(mode="after")
    def require_at_least_one_clinical_input(self) -> "ClinicalAssessmentCreate":
        has_content = any(
            [
                self.demographics_notes,
                self.current_symptoms,
                self.symptom_duration,
                self.previous_conditions,
                self.existing_medications,
                self.medical_history_notes,
                self.systolic_bp is not None,
                self.diastolic_bp is not None,
                self.heart_rate is not None,
                self.body_temperature is not None,
                self.oxygen_saturation is not None,
                self.additional_measurements,
                self.lab_results,
                self.ehr_summary,
                self.previous_reports,
                len(self.attached_report_names) > 0,
                len(self.attached_images) > 0,
                self.imaging_notes,
                self.genomic_notes,
                self.family_history_markers,
                self.predictive_experiment_result is not None,
            ]
        )
        if not has_content:
            raise ValueError(
                "At least one clinical observation, record, image reference, "
                "genomic note, or predictive result is required."
            )
        return self


class ClinicalAssessmentReviewUpdate(BaseModel):
    clinician_reviewed: bool


class AssessmentAttachmentResponse(BaseModel):
    """Metadata and extraction status for an uploaded clinical document or image."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    assessment_id: UUID
    kind: str
    original_filename: str
    mime_type: str
    size_bytes: int
    modality: str
    extraction_status: str
    extracted_text: Optional[str] = None
    extraction_note: Optional[str] = None
    exif_stripped: bool = False
    created_at: datetime


class ClinicalAssessmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    patient_id: UUID

    demographics_notes: Optional[str] = None

    current_symptoms: Optional[str] = None
    symptom_duration: Optional[str] = None
    previous_conditions: Optional[str] = None
    existing_medications: Optional[str] = None
    medical_history_notes: Optional[str] = None

    systolic_bp: Optional[float] = None
    diastolic_bp: Optional[float] = None
    heart_rate: Optional[float] = None
    body_temperature: Optional[float] = None
    oxygen_saturation: Optional[float] = None
    additional_measurements: Optional[str] = None

    lab_results: Optional[str] = None
    ehr_summary: Optional[str] = None
    previous_reports: Optional[str] = None
    attached_report_names: list[str] = Field(default_factory=list)

    attached_images: list[AttachedImageMetadata] = Field(default_factory=list)
    imaging_notes: Optional[str] = None

    genomic_notes: Optional[str] = None
    family_history_markers: Optional[str] = None

    preprocessing_summary: Optional[dict[str, Any]] = None
    predictive_experiment_result: Optional[dict[str, Any]] = None
    clinician_reviewed: bool

    created_at: datetime
    updated_at: datetime
    patient: Optional[PatientResponse] = None
    attachments: list[AssessmentAttachmentResponse] = Field(default_factory=list)

