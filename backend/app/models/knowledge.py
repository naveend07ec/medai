from datetime import date, datetime
import math
from typing import Any, Optional
import uuid

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.core.database import Base
from app.models.patient import utc_now


def validate_embedding_vector(
    vector: Any,
    expected_dimension: Optional[int] = None,
) -> list[float]:
    """Validate an embedding vector as a non-empty list of finite floats."""
    if not isinstance(vector, (list, tuple)) or len(vector) == 0:
        raise ValueError("embedding_vector must be a non-empty list of finite numbers.")

    cleaned: list[float] = []
    for item in vector:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise ValueError("embedding_vector entries must be numeric.")
        numeric = float(item)
        if not math.isfinite(numeric):
            raise ValueError("embedding_vector entries must be finite numbers.")
        cleaned.append(numeric)

    if expected_dimension is not None and len(cleaned) != expected_dimension:
        raise ValueError(
            f"embedding_vector length ({len(cleaned)}) must match "
            f"embedding_dimension ({expected_dimension})."
        )

    return cleaned


class KnowledgeDocument(Base):
    """Approved medical reference document metadata for Medical RAG ingestion."""

    __tablename__ = "knowledge_documents"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_publisher: Mapped[str] = mapped_column(String(200), nullable=False)
    publication_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    content_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    content_hash: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=False,
    )
    metadata_json: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
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

    chunks: Mapped[list["KnowledgeChunk"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="KnowledgeChunk.chunk_index",
    )


class KnowledgeChunk(Base):
    """Chunked medical text and its embedding vector stored for NumPy cosine retrieval."""

    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        UniqueConstraint(
            "document_id",
            "chunk_index",
            name="uq_knowledge_chunks_document_chunk_index",
        ),
        CheckConstraint(
            "embedding_dimension > 0",
            name="ck_knowledge_chunks_embedding_dimension_positive",
        ),
        CheckConstraint(
            "chunk_index >= 0",
            name="ck_knowledge_chunks_chunk_index_non_negative",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("knowledge_documents.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    section_heading: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    token_estimate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    embedding_model: Mapped[str] = mapped_column(String(120), nullable=False)
    embedding_dimension: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding_vector: Mapped[list[float]] = mapped_column(JSON, nullable=False)
    chunk_metadata: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSON,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        server_default=func.now(),
        nullable=False,
    )

    document: Mapped["KnowledgeDocument"] = relationship(back_populates="chunks")

    @validates("embedding_dimension")
    def _validate_dimension(self, _key: str, value: int) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValueError("embedding_dimension must be a positive integer.")
        if self.embedding_vector is not None and len(self.embedding_vector) != value:
            raise ValueError(
                f"embedding_dimension ({value}) does not match "
                f"embedding_vector length ({len(self.embedding_vector)})."
            )
        return value

    @validates("embedding_vector")
    def _validate_vector(self, _key: str, value: Any) -> list[float]:
        cleaned = validate_embedding_vector(value, expected_dimension=self.embedding_dimension)
        if self.embedding_dimension is None:
            self.embedding_dimension = len(cleaned)
        return cleaned


@event.listens_for(KnowledgeChunk, "before_insert")
@event.listens_for(KnowledgeChunk, "before_update")
def _enforce_chunk_embedding_consistency(
    _mapper: Any, _connection: Any, target: KnowledgeChunk
) -> None:
    """Verify embedding dimension and vector consistency prior to persistence."""
    if target.embedding_dimension is None or target.embedding_dimension <= 0:
        raise ValueError("embedding_dimension must be a positive integer.")
    validate_embedding_vector(
        target.embedding_vector,
        expected_dimension=target.embedding_dimension,
    )

