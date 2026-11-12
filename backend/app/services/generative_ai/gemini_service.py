import logging
import time
from typing import Optional

from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.knowledge import KnowledgeChunk, KnowledgeDocument
from app.schemas.report import GenAIHealthResponse

logger = logging.getLogger(__name__)


class GeminiServiceError(RuntimeError):
    """Base error raised by the Gemini text-generation service."""


class GeminiServiceUnavailableError(GeminiServiceError):
    """Raised when Gemini configuration or upstream service is unavailable."""


class GeminiAuthenticationError(GeminiServiceUnavailableError):
    """Raised when Gemini rejects the configured API credentials."""


class GeminiRateLimitError(GeminiServiceUnavailableError):
    """Raised when Gemini API rate limits or free-tier quotas are exceeded."""


class GeminiTimeoutError(GeminiServiceUnavailableError):
    """Raised when a Gemini API request exceeds the configured timeout."""


class GeminiService:
    """Wrapper around the official google-genai SDK for grounded text generation."""

    def __init__(self, settings_override: Optional[Settings] = None) -> None:
        self._settings_override = settings_override

    def _get_settings(self) -> Settings:
        return self._settings_override or Settings()

    def is_configured(self) -> bool:
        """Return True when a non-empty Gemini API key is configured."""
        return self._get_settings().get_gemini_api_key() is not None

    def _build_client(self, current: Settings) -> genai.Client:
        api_key = current.get_gemini_api_key()
        if not api_key:
            raise GeminiServiceUnavailableError(
                "Gemini API service is unavailable because GEMINI_API_KEY is not configured."
            )
        timeout_ms = max(1000, int(current.GEMINI_TIMEOUT_SECONDS * 1000))
        return genai.Client(
            api_key=api_key,
            http_options=genai_types.HttpOptions(timeout=timeout_ms),
        )

    def health_status(self, db: Optional[Session] = None) -> GenAIHealthResponse:
        """Return readiness metadata for Gemini generation and the knowledge base."""
        current = self._get_settings()
        model_name = current.get_gemini_model()
        embedding_model = current.GEMINI_EMBEDDING_MODEL.strip()

        doc_count = 0
        chunk_count = 0
        if db is not None:
            doc_count = int(db.scalar(select(func.count(KnowledgeDocument.id))) or 0)
            chunk_count = int(db.scalar(select(func.count(KnowledgeChunk.id))) or 0)

        if not self.is_configured():
            return GenAIHealthResponse(
                status="unavailable",
                provider="gemini",
                model_name=model_name,
                embedding_model=embedding_model,
                rag_connected=chunk_count > 0,
                indexed_documents=doc_count,
                indexed_chunks=chunk_count,
                demo_mode=current.GENAI_DEMO_MODE,
                detail=(
                    "Gemini API key is not configured. Set GEMINI_API_KEY in "
                    "backend/.env to enable Gemini RAG clinical insights."
                ),
            )

        return GenAIHealthResponse(
            status="ready",
            provider="gemini",
            model_name=model_name,
            embedding_model=embedding_model,
            rag_connected=chunk_count > 0,
            indexed_documents=doc_count,
            indexed_chunks=chunk_count,
            demo_mode=current.GENAI_DEMO_MODE,
            detail=None,
        )

    def generate_structured_json(
        self,
        *,
        system_instruction: str,
        user_prompt: str,
        image_parts: Optional[list[tuple[bytes, str]]] = None,
        temperature: float = 0.2,
    ) -> tuple[str, str]:
        """Call Gemini via google-genai SDK and return (model_name, raw_json_text)."""
        current = self._get_settings()
        model_name = current.get_gemini_model()
        client = self._build_client(current)

        config = genai_types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
            response_mime_type="application/json",
        )

        contents: object = user_prompt
        if image_parts:
            contents = [
                user_prompt,
                *[
                    genai_types.Part.from_bytes(data=img_bytes, mime_type=mime_type)
                    for img_bytes, mime_type in image_parts
                ],
            ]

        response = None
        max_attempts = 2
        for attempt in range(max_attempts):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=config,
                )
                break
            except genai_errors.APIError as exc:
                status_code = getattr(exc, "code", None)
                msg_lower = str(exc).lower()
                if status_code in (401, 403) or "api_key" in msg_lower or "permission" in msg_lower:
                    logger.warning("Gemini API authentication rejected (HTTP %s).", status_code)
                    raise GeminiAuthenticationError(
                        "Gemini API authentication failed. Verify GEMINI_API_KEY configuration."
                    ) from exc
                if status_code == 429 or "resource_exhausted" in msg_lower or "quota" in msg_lower:
                    logger.warning("Gemini API quota or rate limit exceeded (HTTP %s).", status_code)
                    raise GeminiRateLimitError(
                        "Gemini API rate limit or free-tier quota exceeded. Please retry later."
                    ) from exc
                if status_code in (503, 504) and attempt + 1 < max_attempts:
                    logger.warning(
                        "Transient Gemini API error (HTTP %s); retrying once.",
                        status_code,
                    )
                    time.sleep(0.5)
                    continue
                if status_code == 504:
                    logger.warning("Gemini API request timed out upstream (HTTP 504).")
                    raise GeminiTimeoutError(
                        "Gemini API request timed out. Please try again later."
                    ) from exc
                logger.warning("Gemini API error (HTTP %s).", status_code)
                raise GeminiServiceUnavailableError(
                    "Gemini API service is temporarily unavailable."
                ) from exc
            except TimeoutError as exc:
                logger.warning("Gemini API request timed out.")
                raise GeminiTimeoutError(
                    "Gemini API request timed out. Please try again later."
                ) from exc
            except Exception as exc:
                if "timeout" in str(exc).lower():
                    logger.warning("Gemini API request timed out.")
                    raise GeminiTimeoutError(
                        "Gemini API request timed out. Please try again later."
                    ) from exc
                logger.warning("Unexpected error communicating with Gemini API.")
                raise GeminiServiceUnavailableError(
                    "Unable to communicate with the Gemini API service."
                ) from exc

        raw_text = getattr(response, "text", None)
        if not raw_text or not str(raw_text).strip():
            raise GeminiServiceError("Gemini API returned an empty response.")

        return model_name, str(raw_text).strip()


gemini_service = GeminiService()

