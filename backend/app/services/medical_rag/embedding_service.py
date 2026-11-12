import logging
from typing import Optional

from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types

from app.core.config import Settings
from app.models.knowledge import validate_embedding_vector

logger = logging.getLogger(__name__)


class EmbeddingServiceError(RuntimeError):
    """Base error raised by the Gemini embedding service."""


class EmbeddingServiceUnavailableError(EmbeddingServiceError):
    """Raised when Gemini embedding credentials or upstream service are unavailable."""


class EmbeddingRateLimitError(EmbeddingServiceUnavailableError):
    """Raised when Gemini API quota or rate limits are exceeded."""


class EmbeddingTimeoutError(EmbeddingServiceUnavailableError):
    """Raised when the Gemini embedding request exceeds the configured timeout."""


class GeminiEmbeddingService:
    """Generates and validates text embeddings via the official google-genai SDK."""

    def __init__(self, settings_override: Optional[Settings] = None) -> None:
        self._settings_override = settings_override

    def _get_settings(self) -> Settings:
        return self._settings_override or Settings()

    def is_configured(self) -> bool:
        """Return True if a non-empty Gemini API key is configured."""
        return self._get_settings().get_gemini_api_key() is not None

    def _build_client(self, current: Settings) -> genai.Client:
        api_key = current.get_gemini_api_key()
        if not api_key:
            raise EmbeddingServiceUnavailableError(
                "Gemini embedding service is unavailable because GEMINI_API_KEY is not configured."
            )
        timeout_ms = max(1000, int(current.GEMINI_TIMEOUT_SECONDS * 1000))
        return genai.Client(
            api_key=api_key,
            http_options=genai_types.HttpOptions(timeout=timeout_ms),
        )

    def embed_texts(
        self,
        texts: list[str],
        task_type: str = "RETRIEVAL_DOCUMENT",
    ) -> list[list[float]]:
        """Generate validated embeddings for a list of non-empty strings in batches."""
        if not texts:
            raise ValueError("At least one text string is required for embedding.")
        cleaned_texts = [text.strip() for text in texts]
        if any(not text for text in cleaned_texts):
            raise ValueError("Embedding input texts must not be blank.")

        current = self._get_settings()
        client = self._build_client(current)
        model = current.GEMINI_EMBEDDING_MODEL.strip()
        dimension = current.GEMINI_EMBEDDING_DIMENSION
        batch_size = current.GEMINI_EMBEDDING_BATCH_SIZE

        vectors: list[list[float]] = []
        for start in range(0, len(cleaned_texts), batch_size):
            batch = cleaned_texts[start : start + batch_size]
            batch_vectors = self._embed_batch(
                client=client,
                model=model,
                batch=batch,
                dimension=dimension,
                task_type=task_type,
            )
            vectors.extend(batch_vectors)

        return vectors

    def embed_query(self, query_text: str) -> list[float]:
        """Generate a validated query embedding for similarity retrieval."""
        cleaned = query_text.strip()
        if not cleaned:
            raise ValueError("Query text must not be empty.")
        return self.embed_texts([cleaned], task_type="RETRIEVAL_QUERY")[0]

    def _embed_batch(
        self,
        client: genai.Client,
        model: str,
        batch: list[str],
        dimension: int,
        task_type: str,
    ) -> list[list[float]]:
        config = genai_types.EmbedContentConfig(
            output_dimensionality=dimension,
            task_type=task_type,
        )
        try:
            response = client.models.embed_content(
                model=model,
                contents=batch,
                config=config,
            )
        except genai_errors.APIError as exc:
            status_code = getattr(exc, "code", None)
            msg_lower = str(exc).lower()
            if status_code == 429 or "resource_exhausted" in msg_lower or "quota" in msg_lower:
                logger.warning("Gemini embedding rate limit or quota exceeded (HTTP %s).", status_code)
                raise EmbeddingRateLimitError(
                    "Gemini embedding quota or rate limit exceeded. Please retry later."
                ) from exc
            logger.warning("Gemini embedding API error (HTTP %s).", status_code)
            raise EmbeddingServiceUnavailableError(
                "Gemini embedding service returned an upstream error."
            ) from exc
        except TimeoutError as exc:
            logger.warning("Gemini embedding request timed out.")
            raise EmbeddingTimeoutError(
                "Gemini embedding request timed out."
            ) from exc
        except Exception as exc:
            if "timeout" in str(exc).lower():
                logger.warning("Gemini embedding request timed out.")
                raise EmbeddingTimeoutError(
                    "Gemini embedding request timed out."
                ) from exc
            logger.warning("Unexpected error communicating with Gemini embedding service.")
            raise EmbeddingServiceUnavailableError(
                "Unable to generate embeddings from the Gemini service."
            ) from exc

        embeddings = getattr(response, "embeddings", None) or []
        if len(embeddings) != len(batch):
            raise EmbeddingServiceError(
                f"Gemini embedding response count ({len(embeddings)}) did not match batch size ({len(batch)})."
            )

        validated: list[list[float]] = []
        for entry in embeddings:
            values = getattr(entry, "values", None)
            try:
                clean_vec = validate_embedding_vector(
                    values,
                    expected_dimension=dimension,
                )
            except ValueError as exc:
                raise EmbeddingServiceError(
                    f"Invalid embedding vector returned by Gemini: {exc}"
                ) from exc
            validated.append(clean_vec)

        return validated


embedding_service = GeminiEmbeddingService()

