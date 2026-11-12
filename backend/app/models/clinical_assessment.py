from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional
import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.patient import utc_now

if TYPE_CHECKING:
    from app.models.assessment_attachment import AssessmentAttachment
    from app.models.diagnostic_report import DiagnosticReport
    from app.models.patient import Patient


class ClinicalAssessment(Base):
    """Clinical intake and assessment record linked to a patient by UUID."""

    __tablename__ = "clinical_assessments"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("patients.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )

    # Assessment-specific demographic context (does not mutate patient identity)
    demographics_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Symptoms and medical history
    current_symptoms: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    symptom_duration: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    previous_conditions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    existing_medications: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    medical_history_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Clinical measurements
    systolic_bp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    diastolic_bp: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    heart_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    body_temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    oxygen_saturation: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    additional_measurements: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Laboratory and EHR information
    lab_results: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ehr_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    previous_reports: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attached_report_names: Mapped[list[str]] = mapped_column(
        JSON,
        default=list,
        nullable=False,
    )

    # Medical image metadata
    attached_images: Mapped[list[dict[str, str]]] = mapped_column(
        JSON,
        default=list,
        nullable=False,
    )
    imaging_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Genomic information references
    genomic_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    family_history_markers: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Preprocessing summary and optional predictive experiment output
    preprocessing_summary: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
    )
    predictive_experiment_result: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
    )
    clinician_reviewed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now(),
        nullable=False,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        server_default=func.now(),
        nullable=False,
    )

    patient: Mapped["Patient"] = relationship(back_populates="assessments")
    diagnostic_reports: Mapped[list["DiagnosticReport"]] = relationship(
        back_populates="assessment",
        order_by="DiagnosticReport.created_at.desc()",
    )
    attachments: Mapped[list["AssessmentAttachment"]] = relationship(
        back_populates="assessment",
        order_by="AssessmentAttachment.created_at.asc()",
        cascade="all, delete-orphan",
    )

