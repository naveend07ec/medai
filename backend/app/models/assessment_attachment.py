from datetime import datetime
from typing import TYPE_CHECKING, Optional
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.patient import utc_now

if TYPE_CHECKING:
    from app.models.clinical_assessment import ClinicalAssessment


class AssessmentAttachment(Base):
    """Persisted clinical document or medical image associated with a ClinicalAssessment."""

    __tablename__ = "assessment_attachments"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("clinical_assessments.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # 'document' | 'image'
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    modality: Mapped[str] = mapped_column(String(50), nullable=False)
    extraction_status: Mapped[str] = mapped_column(String(30), nullable=False)
    extracted_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extraction_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exif_stripped: Mapped[bool] = mapped_column(
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
    )

    assessment: Mapped["ClinicalAssessment"] = relationship(back_populates="attachments")

