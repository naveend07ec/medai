from datetime import date, datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class KnowledgeDocumentResponse(BaseModel):
    """Metadata representation of an ingested medical reference document."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    source_publisher: str
    publication_date: Optional[date] = None
    source_url: Optional[str] = None
    file_name: Optional[str] = None
    content_type: Optional[str] = None
    content_hash: str
    chunk_count: int = 0
    created_at: datetime
    updated_at: datetime


class KnowledgeDocumentIngestResponse(BaseModel):
    """Response returned after successful document extraction, chunking, and embedding."""

    document: KnowledgeDocumentResponse
    chunks_created: int
    embedding_model: str
    embedding_dimension: int


class KnowledgeBaseStatusResponse(BaseModel):
    """Summary of Medical RAG knowledge base storage and embedding readiness."""

    vector_store_backend: str
    document_count: int
    chunk_count: int
    embedding_model: str
    embedding_dimension: int
    embedding_service_ready: bool
    top_k_default: int
    min_similarity_default: float


class RetrievedChunkItem(BaseModel):
    """Single retrieved medical chunk with full provenance and cosine similarity score."""

    chunk_id: UUID
    document_id: UUID
    document_title: str
    source_publisher: str
    publication_date: Optional[date] = None
    source_url: Optional[str] = None
    section_heading: Optional[str] = None
    page_number: Optional[int] = None
    chunk_index: int
    chunk_text: str
    similarity_score: float = Field(..., ge=-1.0, le=1.0)


class RetrievalResult(BaseModel):
    """Outcome of a semantic retrieval query against PostgreSQL + NumPy."""

    sufficient_evidence: bool
    status: Literal["evidence_found", "insufficient_evidence"]
    query: str
    top_k_requested: int
    min_similarity_applied: float
    total_chunks_searched: int
    retrieved_chunks: list[RetrievedChunkItem] = Field(default_factory=list)
    message: str
