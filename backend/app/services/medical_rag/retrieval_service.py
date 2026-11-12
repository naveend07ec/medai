from typing import Optional

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import Settings
from app.models.knowledge import KnowledgeChunk
from app.schemas.knowledge import RetrievalResult, RetrievedChunkItem
from app.services.medical_rag.embedding_service import (
    GeminiEmbeddingService,
    embedding_service as default_embedding_service,
)


class KnowledgeRetrievalService:
    """Retrieves relevant medical chunks from PostgreSQL using NumPy cosine similarity."""

    def __init__(
        self,
        embedding_svc: Optional[GeminiEmbeddingService] = None,
        settings_override: Optional[Settings] = None,
    ) -> None:
        self._embedding_service = embedding_svc or default_embedding_service
        self._settings_override = settings_override

    def _get_settings(self) -> Settings:
        return self._settings_override or Settings()

    def retrieve(
        self,
        db: Session,
        query_text: str,
        top_k: Optional[int] = None,
        min_similarity: Optional[float] = None,
    ) -> RetrievalResult:
        """Rank stored chunks by cosine similarity and filter by threshold."""
        cleaned_query = query_text.strip()
        if not cleaned_query:
            raise ValueError("Retrieval query text must not be empty.")

        current = self._get_settings()
        effective_k = top_k if top_k is not None else current.RAG_TOP_K
        effective_threshold = (
            min_similarity if min_similarity is not None else current.RAG_MIN_SIMILARITY
        )
        if effective_k < 1:
            raise ValueError("top_k must be at least 1.")
        if effective_threshold < 0.0 or effective_threshold > 1.0:
            raise ValueError("min_similarity must be between 0.0 and 1.0.")

        expected_dim = current.GEMINI_EMBEDDING_DIMENSION
        stmt = (
            select(KnowledgeChunk)
            .options(joinedload(KnowledgeChunk.document))
            .where(KnowledgeChunk.embedding_dimension == expected_dim)
        )
        stored_chunks = list(db.scalars(stmt).all())

        if not stored_chunks:
            return RetrievalResult(
                sufficient_evidence=False,
                status="insufficient_evidence",
                query=cleaned_query,
                top_k_requested=effective_k,
                min_similarity_applied=effective_threshold,
                total_chunks_searched=0,
                retrieved_chunks=[],
                message=(
                    "Insufficient verified medical evidence: the medical knowledge base "
                    "contains no indexed chunks matching the configured embedding dimension."
                ),
            )

        query_embedding = self._embedding_service.embed_query(cleaned_query)
        query_vec = np.asarray(query_embedding, dtype=np.float64)
        query_norm = float(np.linalg.norm(query_vec))
        if query_norm == 0.0:
            return RetrievalResult(
                sufficient_evidence=False,
                status="insufficient_evidence",
                query=cleaned_query,
                top_k_requested=effective_k,
                min_similarity_applied=effective_threshold,
                total_chunks_searched=len(stored_chunks),
                retrieved_chunks=[],
                message="Insufficient evidence: query embedding had zero magnitude.",
            )

        matrix = np.asarray(
            [chunk.embedding_vector for chunk in stored_chunks],
            dtype=np.float64,
        )
        row_norms = np.linalg.norm(matrix, axis=1)
        valid_mask = row_norms > 0.0

        scores = np.full(len(stored_chunks), -1.0, dtype=np.float64)
        if np.any(valid_mask):
            scores[valid_mask] = (matrix[valid_mask] @ query_vec) / (
                row_norms[valid_mask] * query_norm
            )

        ranked_indices = np.argsort(scores)[::-1]
        selected: list[RetrievedChunkItem] = []

        for idx in ranked_indices:
            score = float(scores[int(idx)])
            if score < effective_threshold:
                continue
            chunk = stored_chunks[int(idx)]
            doc = chunk.document
            selected.append(
                RetrievedChunkItem(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    document_title=doc.title,
                    source_publisher=doc.source_publisher,
                    publication_date=doc.publication_date,
                    source_url=doc.source_url,
                    section_heading=chunk.section_heading,
                    page_number=chunk.page_number,
                    chunk_index=chunk.chunk_index,
                    chunk_text=chunk.chunk_text,
                    similarity_score=round(max(-1.0, min(1.0, score)), 6),
                )
            )
            if len(selected) >= effective_k:
                break

        if not selected:
            return RetrievalResult(
                sufficient_evidence=False,
                status="insufficient_evidence",
                query=cleaned_query,
                top_k_requested=effective_k,
                min_similarity_applied=effective_threshold,
                total_chunks_searched=len(stored_chunks),
                retrieved_chunks=[],
                message=(
                    "Insufficient verified medical evidence met the configured "
                    "similarity threshold."
                ),
            )

        return RetrievalResult(
            sufficient_evidence=True,
            status="evidence_found",
            query=cleaned_query,
            top_k_requested=effective_k,
            min_similarity_applied=effective_threshold,
            total_chunks_searched=len(stored_chunks),
            retrieved_chunks=selected,
            message=f"Retrieved {len(selected)} relevant medical reference chunk(s).",
        )


retrieval_service = KnowledgeRetrievalService()

