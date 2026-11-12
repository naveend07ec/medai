from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.report import GenAIHealthResponse, RagQueryRequest, RagQueryResponse
from app.services.generative_ai.gemini_service import (
    GeminiRateLimitError,
    GeminiServiceError,
    gemini_service,
)
from app.services.medical_rag.rag_service import rag_service
from app.services.privacy.safety_validation_service import ClinicalSafetyValidationError

router = APIRouter(tags=["GenAI & Medical RAG"])


@router.get(
    "/genai/health",
    response_model=GenAIHealthResponse,
    summary="Check Gemini API and Medical RAG service readiness",
)
def get_genai_health(
    db: Session = Depends(get_db),
) -> GenAIHealthResponse:
    """Report readiness of Gemini text generation and indexed RAG chunks."""
    return gemini_service.health_status(db)


@router.post(
    "/rag/query",
    response_model=RagQueryResponse,
    summary="Run RAG-grounded clinical decision-support query",
)
def query_medical_rag(
    payload: RagQueryRequest,
    db: Session = Depends(get_db),
) -> RagQueryResponse:
    """Execute emergency screening, PII filtering, RAG retrieval, and Gemini synthesis."""
    try:
        return rag_service.run_clinical_query(db, payload)
    except GeminiRateLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    except GeminiServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ClinicalSafetyValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
