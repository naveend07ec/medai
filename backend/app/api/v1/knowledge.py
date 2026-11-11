from datetime import date
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.database import get_db
from app.models.knowledge import KnowledgeChunk, KnowledgeDocument
from app.schemas.knowledge import (
    KnowledgeBaseStatusResponse,
    KnowledgeDocumentIngestResponse,
    KnowledgeDocumentResponse,
)
from app.services.medical_rag.document_ingestion_service import (
    DocumentIngestionError,
    DuplicateDocumentError,
    document_ingestion_service,
)
from app.services.medical_rag.embedding_service import (
    EmbeddingRateLimitError,
    EmbeddingServiceError,
    EmbeddingServiceUnavailableError,
    embedding_service,
)

router = APIRouter(prefix="/knowledge", tags=["Medical Knowledge Base"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB safety limit


def _to_document_response(
    document: KnowledgeDocument,
    chunk_count: int,
) -> KnowledgeDocumentResponse:
    return KnowledgeDocumentResponse(
        id=document.id,
        title=document.title,
        source_publisher=document.source_publisher,
        publication_date=document.publication_date,
        source_url=document.source_url,
        file_name=document.file_name,
        content_type=document.content_type,
        content_hash=document.content_hash,
        chunk_count=chunk_count,
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


@router.post(
    "/documents",
    response_model=KnowledgeDocumentIngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest an approved medical reference document into the knowledge base",
)
async def ingest_knowledge_document(
    file: UploadFile = File(...),
    title: str = Form(..., min_length=2, max_length=255),
    source_publisher: str = Form(..., min_length=2, max_length=200),
    publication_date: Optional[date] = Form(default=None),
    source_url: Optional[str] = Form(default=None, max_length=1000),
    db: Session = Depends(get_db),
) -> KnowledgeDocumentIngestResponse:
    """Extract, chunk, embed, and store an approved PDF, TXT, or Markdown document."""
    file_bytes = await file.read()
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file exceeds the 10 MB size limit.",
        )

    current_settings = Settings()
    try:
        document = document_ingestion_service.ingest_document(
            db,
            file_bytes=file_bytes,
            file_name=file.filename or "document.txt",
            title=title,
            source_publisher=source_publisher,
            publication_date=publication_date,
            source_url=source_url,
            content_type=file.content_type,
        )
    except DuplicateDocumentError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except DocumentIngestionError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except EmbeddingRateLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    except (EmbeddingServiceUnavailableError, EmbeddingServiceError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    chunk_count = len(document.chunks)
    return KnowledgeDocumentIngestResponse(
        document=_to_document_response(document, chunk_count),
        chunks_created=chunk_count,
        embedding_model=current_settings.GEMINI_EMBEDDING_MODEL,
        embedding_dimension=current_settings.GEMINI_EMBEDDING_DIMENSION,
    )


@router.get(
    "/status",
    response_model=KnowledgeBaseStatusResponse,
    summary="Check Medical Knowledge Base storage and embedding status",
)
def get_knowledge_base_status(
    db: Session = Depends(get_db),
) -> KnowledgeBaseStatusResponse:
    """Return document/chunk counts and embedding configuration status."""
    current_settings = Settings()
    document_count = db.scalar(select(func.count(KnowledgeDocument.id))) or 0
    chunk_count = db.scalar(select(func.count(KnowledgeChunk.id))) or 0

    return KnowledgeBaseStatusResponse(
        vector_store_backend=current_settings.VECTOR_STORE_BACKEND,
        document_count=int(document_count),
        chunk_count=int(chunk_count),
        embedding_model=current_settings.GEMINI_EMBEDDING_MODEL,
        embedding_dimension=current_settings.GEMINI_EMBEDDING_DIMENSION,
        embedding_service_ready=embedding_service.is_configured(),
        top_k_default=current_settings.RAG_TOP_K,
        min_similarity_default=current_settings.RAG_MIN_SIMILARITY,
    )


@router.get(
    "/documents",
    response_model=list[KnowledgeDocumentResponse],
    summary="List ingested medical reference documents",
)
def list_knowledge_documents(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[KnowledgeDocumentResponse]:
    """List ingested medical reference documents ordered from newest to oldest."""
    chunk_counts_subquery = (
        select(
            KnowledgeChunk.document_id,
            func.count(KnowledgeChunk.id).label("chunk_count"),
        )
        .group_by(KnowledgeChunk.document_id)
        .subquery()
    )
    stmt = (
        select(
            KnowledgeDocument,
            func.coalesce(chunk_counts_subquery.c.chunk_count, 0),
        )
        .outerjoin(
            chunk_counts_subquery,
            KnowledgeDocument.id == chunk_counts_subquery.c.document_id,
        )
        .order_by(KnowledgeDocument.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    rows = db.execute(stmt).all()
    return [_to_document_response(doc, int(count)) for doc, count in rows]
