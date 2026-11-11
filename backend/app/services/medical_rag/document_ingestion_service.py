from dataclasses import dataclass
from datetime import date
import hashlib
import io
from pathlib import Path
import re
from typing import Optional

from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.knowledge import KnowledgeChunk, KnowledgeDocument
from app.services.medical_rag.embedding_service import (
    GeminiEmbeddingService,
    embedding_service as default_embedding_service,
)

SUPPORTED_EXTENSIONS = {".pdf", ".txt", ".md", ".markdown"}
_MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s+(.+)$")
_NUMBERED_HEADING_RE = re.compile(r"^\d+(?:\.\d+)*\.?\s+[A-Z][^\n]{2,80}$")
_ALLCAPS_HEADING_RE = re.compile(r"^[A-Z][A-Z0-9\s,/-]{3,70}$")


class DocumentIngestionError(ValueError):
    """Raised when an uploaded document is invalid, unsupported, or empty."""


class DuplicateDocumentError(RuntimeError):
    """Raised when a document with identical cleaned content hash already exists."""


@dataclass(frozen=True)
class ExtractedSegment:
    """Cleaned text block with optional section heading and 1-based page number."""

    text: str
    section_heading: Optional[str]
    page_number: Optional[int]


@dataclass(frozen=True)
class PreparedChunk:
    """Chunk ready for embedding and database persistence."""

    chunk_index: int
    chunk_text: str
    section_heading: Optional[str]
    page_number: Optional[int]
    token_estimate: int


def clean_extracted_text(raw_text: str) -> str:
    """Normalize line endings, strip control characters, and collapse extra whitespace."""
    normalized = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", normalized)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in normalized.split("\n")]
    joined = "\n".join(lines)
    joined = re.sub(r"\n{3,}", "\n\n", joined)
    return joined.strip()


def _detect_heading(line: str) -> Optional[str]:
    md_match = _MARKDOWN_HEADING_RE.match(line)
    if md_match:
        return md_match.group(1).strip()
    if _NUMBERED_HEADING_RE.match(line) or _ALLCAPS_HEADING_RE.match(line):
        return line.strip()
    return None


def _split_into_segments(
    cleaned_text: str,
    page_number: Optional[int],
    initial_heading: Optional[str] = None,
) -> tuple[list[ExtractedSegment], Optional[str]]:
    """Group paragraphs with the most recent section heading."""
    segments: list[ExtractedSegment] = []
    current_heading = initial_heading
    paragraph_buffer: list[str] = []

    def flush_buffer() -> None:
        if paragraph_buffer:
            content = "\n".join(paragraph_buffer).strip()
            if content:
                segments.append(
                    ExtractedSegment(
                        text=content,
                        section_heading=current_heading,
                        page_number=page_number,
                    )
                )
            paragraph_buffer.clear()

    for line in cleaned_text.split("\n"):
        if not line:
            flush_buffer()
            continue
        heading = _detect_heading(line)
        if heading:
            flush_buffer()
            current_heading = heading[:255]
            continue
        paragraph_buffer.append(line)

    flush_buffer()

    # Fallback if a document only had headings and no body paragraphs
    if not segments and cleaned_text:
        segments.append(
            ExtractedSegment(
                text=cleaned_text,
                section_heading=current_heading,
                page_number=page_number,
            )
        )

    return segments, current_heading


def extract_document_segments(
    file_bytes: bytes,
    file_name: str,
) -> tuple[list[ExtractedSegment], str]:
    """Extract cleaned text segments from PDF, TXT, or Markdown file bytes."""
    if not file_bytes:
        raise DocumentIngestionError("Uploaded document file is empty.")

    extension = Path(file_name).suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise DocumentIngestionError(
            f"Unsupported document format '{extension or 'unknown'}'. "
            "Supported formats: .pdf, .txt, .md."
        )

    all_segments: list[ExtractedSegment] = []
    current_heading: Optional[str] = None

    if extension == ".pdf":
        try:
            reader = PdfReader(io.BytesIO(file_bytes))
        except Exception as exc:
            raise DocumentIngestionError("Unable to read PDF document.") from exc

        for idx, page in enumerate(reader.pages, start=1):
            try:
                raw_page_text = page.extract_text() or ""
            except Exception as exc:
                raise DocumentIngestionError(
                    f"Failed to extract text from PDF page {idx}."
                ) from exc
            cleaned_page = clean_extracted_text(raw_page_text)
            if not cleaned_page:
                continue
            page_segments, current_heading = _split_into_segments(
                cleaned_page,
                page_number=idx,
                initial_heading=current_heading,
            )
            all_segments.extend(page_segments)
    else:
        try:
            decoded = file_bytes.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise DocumentIngestionError(
                "Text or Markdown document must be valid UTF-8 encoded text."
            ) from exc

        cleaned = clean_extracted_text(decoded)
        if cleaned:
            all_segments, _ = _split_into_segments(cleaned, page_number=None)

    if not all_segments:
        raise DocumentIngestionError(
            "Document contains no extractable text after cleaning."
        )

    full_cleaned_text = "\n\n".join(seg.text for seg in all_segments)
    return all_segments, full_cleaned_text


def _find_split_end(text: str, start: int, chunk_size: int) -> int:
    end = min(len(text), start + chunk_size)
    if end >= len(text):
        return len(text)

    window = text[start:end]
    for separator in ("\n\n", "\n", ". ", " "):
        sep_idx = window.rfind(separator)
        if sep_idx >= chunk_size // 3:
            return start + sep_idx + (1 if separator == ". " else 0)
    return end


def chunk_segments(
    segments: list[ExtractedSegment],
    chunk_size: int,
    chunk_overlap: int,
) -> list[PreparedChunk]:
    """Split extracted segments into overlapping chunks while preserving provenance."""
    if chunk_size <= 0:
        raise ValueError("chunk_size must be a positive integer.")
    if chunk_overlap < 0 or chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be >= 0 and smaller than chunk_size.")

    chunks: list[PreparedChunk] = []
    chunk_index = 0

    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue

        start = 0
        while start < len(text):
            end = _find_split_end(text, start, chunk_size)
            slice_text = text[start:end].strip()
            if slice_text:
                chunks.append(
                    PreparedChunk(
                        chunk_index=chunk_index,
                        chunk_text=slice_text,
                        section_heading=segment.section_heading,
                        page_number=segment.page_number,
                        token_estimate=max(1, len(slice_text) // 4),
                    )
                )
                chunk_index += 1

            if end >= len(text):
                break
            next_start = max(start + 1, end - chunk_overlap)
            start = next_start

    if not chunks:
        raise DocumentIngestionError("No text chunks were produced from the document.")

    return chunks


class DocumentIngestionService:
    """Handles document extraction, deduplication, chunking, embedding, and DB storage."""

    def __init__(
        self,
        embedding_svc: Optional[GeminiEmbeddingService] = None,
        settings_override: Optional[Settings] = None,
    ) -> None:
        self._embedding_service = embedding_svc or default_embedding_service
        self._settings_override = settings_override

    def _get_settings(self) -> Settings:
        return self._settings_override or Settings()

    def ingest_document(
        self,
        db: Session,
        *,
        file_bytes: bytes,
        file_name: str,
        title: str,
        source_publisher: str,
        publication_date: Optional[date] = None,
        source_url: Optional[str] = None,
        content_type: Optional[str] = None,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
    ) -> KnowledgeDocument:
        """Extract, deduplicate, chunk, embed, and persist a medical reference document."""
        clean_title = title.strip()
        clean_publisher = source_publisher.strip()
        if len(clean_title) < 2:
            raise DocumentIngestionError("Document title must be at least 2 characters.")
        if len(clean_publisher) < 2:
            raise DocumentIngestionError(
                "Source or publisher must be at least 2 characters."
            )

        current = self._get_settings()
        effective_chunk_size = chunk_size or current.RAG_CHUNK_SIZE
        effective_overlap = (
            chunk_overlap if chunk_overlap is not None else current.RAG_CHUNK_OVERLAP
        )

        segments, full_cleaned_text = extract_document_segments(file_bytes, file_name)
        content_hash = hashlib.sha256(full_cleaned_text.encode("utf-8")).hexdigest()

        existing = db.scalar(
            select(KnowledgeDocument).where(
                KnowledgeDocument.content_hash == content_hash
            )
        )
        if existing is not None:
            raise DuplicateDocumentError(
                "A document with identical extracted content has already been ingested."
            )

        prepared_chunks = chunk_segments(
            segments=segments,
            chunk_size=effective_chunk_size,
            chunk_overlap=effective_overlap,
        )

        vectors = self._embedding_service.embed_texts(
            [chunk.chunk_text for chunk in prepared_chunks],
            task_type="RETRIEVAL_DOCUMENT",
        )
        if len(vectors) != len(prepared_chunks):
            raise RuntimeError("Embedding count did not match prepared chunk count.")

        embedding_model = current.GEMINI_EMBEDDING_MODEL.strip()
        embedding_dim = current.GEMINI_EMBEDDING_DIMENSION

        document = KnowledgeDocument(
            title=clean_title,
            source_publisher=clean_publisher,
            publication_date=publication_date,
            source_url=source_url.strip() if source_url and source_url.strip() else None,
            file_name=Path(file_name).name,
            content_type=content_type,
            content_hash=content_hash,
            metadata_json={
                "chunk_size": effective_chunk_size,
                "chunk_overlap": effective_overlap,
                "segment_count": len(segments),
            },
        )

        for chunk, vector in zip(prepared_chunks, vectors, strict=True):
            document.chunks.append(
                KnowledgeChunk(
                    chunk_index=chunk.chunk_index,
                    chunk_text=chunk.chunk_text,
                    section_heading=chunk.section_heading,
                    page_number=chunk.page_number,
                    token_estimate=chunk.token_estimate,
                    embedding_model=embedding_model,
                    embedding_dimension=embedding_dim,
                    embedding_vector=vector,
                    chunk_metadata={
                        "title": clean_title,
                        "source_publisher": clean_publisher,
                    },
                )
            )

        db.add(document)
        db.commit()
        db.refresh(document)
        return document


document_ingestion_service = DocumentIngestionService()
