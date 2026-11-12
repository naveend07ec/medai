from dataclasses import dataclass
import io
import json
from pathlib import Path
from typing import Optional
import uuid

from pypdf import PdfReader

from app.core.config import BASE_DIR
from app.services.medical_rag.document_ingestion_service import clean_extracted_text

SUPPORTED_CLINICAL_DOC_EXTENSIONS = {".pdf", ".txt", ".md", ".markdown", ".csv", ".json"}
MAX_CLINICAL_DOCUMENT_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_EXTRACTED_TEXT_CHARS = 24_000
UPLOADS_ROOT = BASE_DIR / "uploads" / "assessments"


class DocumentProcessingError(ValueError):
    """Raised when an uploaded clinical document violates type or size constraints."""


@dataclass(frozen=True)
class ProcessedClinicalDocument:
    """Result of validating, storing, and extracting text from a clinical document."""

    original_filename: str
    mime_type: str
    size_bytes: int
    storage_path: str
    extraction_status: str  # 'extracted' | 'unreadable'
    extracted_text: Optional[str]
    extraction_note: Optional[str]


def _extract_pdf_text(file_bytes: bytes) -> tuple[Optional[str], Optional[str]]:
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
    except Exception:
        return None, "PDF file could not be opened or parsed."

    if getattr(reader, "is_encrypted", False):
        try:
            reader.decrypt("")
        except Exception:
            return None, "PDF is password-protected and could not be read."

    pages_text: list[str] = []
    for idx, page in enumerate(reader.pages, start=1):
        try:
            raw = page.extract_text() or ""
        except Exception:
            raw = ""
        cleaned = clean_extracted_text(raw)
        if cleaned:
            pages_text.append(f"[Page {idx}]\n{cleaned}")

    combined = "\n\n".join(pages_text).strip()
    if not combined:
        return (
            None,
            "No readable text was found in this PDF (it may be a scanned image-only PDF).",
        )
    if len(combined) > MAX_EXTRACTED_TEXT_CHARS:
        return (
            combined[:MAX_EXTRACTED_TEXT_CHARS].rstrip(),
            f"Extracted text truncated to {MAX_EXTRACTED_TEXT_CHARS} characters for safe processing.",
        )
    return combined, None


def _decode_text_document(
    file_bytes: bytes,
    ext: str,
) -> tuple[Optional[str], Optional[str]]:
    try:
        decoded = file_bytes.decode("utf-8")
    except UnicodeDecodeError:
        decoded = file_bytes.decode("latin-1", errors="replace")

    if ext == ".json":
        try:
            parsed = json.loads(decoded)
            decoded = json.dumps(parsed, indent=2, ensure_ascii=False)
        except json.JSONDecodeError:
            pass

    cleaned = clean_extracted_text(decoded)
    if not cleaned:
        return None, "Uploaded document contained no readable text."

    if len(cleaned) > MAX_EXTRACTED_TEXT_CHARS:
        return (
            cleaned[:MAX_EXTRACTED_TEXT_CHARS].rstrip(),
            f"Extracted text truncated to {MAX_EXTRACTED_TEXT_CHARS} characters for safe processing.",
        )
    return cleaned, None


def extract_and_store_clinical_document(
    *,
    assessment_id: uuid.UUID,
    file_bytes: bytes,
    file_name: str,
    mime_type: Optional[str] = None,
    uploads_root: Optional[Path] = None,
) -> ProcessedClinicalDocument:
    """Validate, persist, and extract readable text from an uploaded clinical document."""
    safe_name = Path(file_name or "clinical_document.txt").name
    ext = Path(safe_name).suffix.lower()

    if ext not in SUPPORTED_CLINICAL_DOC_EXTENSIONS:
        raise DocumentProcessingError(
            f"Unsupported clinical document format '{ext or 'unknown'}'. "
            "Supported formats: PDF, TXT, Markdown, CSV, and JSON."
        )
    if not file_bytes:
        raise DocumentProcessingError(f"Uploaded file '{safe_name}' is empty.")
    if len(file_bytes) > MAX_CLINICAL_DOCUMENT_BYTES:
        raise DocumentProcessingError(
            f"Uploaded file '{safe_name}' exceeds the 10 MB size limit."
        )

    if ext == ".pdf":
        extracted_text, note = _extract_pdf_text(file_bytes)
        resolved_mime = mime_type or "application/pdf"
    else:
        extracted_text, note = _decode_text_document(file_bytes, ext)
        resolved_mime = mime_type or "text/plain"

    root = (uploads_root or UPLOADS_ROOT).resolve()
    target_dir = (root / str(assessment_id) / "docs").resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    stored_file = (target_dir / f"{uuid.uuid4()}{ext}").resolve()
    if root not in stored_file.parents:
        raise DocumentProcessingError("Invalid storage path resolved for document.")
    stored_file.write_bytes(file_bytes)

    status = "extracted" if extracted_text else "unreadable"
    return ProcessedClinicalDocument(
        original_filename=safe_name[:255],
        mime_type=resolved_mime[:100],
        size_bytes=len(file_bytes),
        storage_path=str(stored_file),
        extraction_status=status,
        extracted_text=extracted_text,
        extraction_note=note,
    )

