from functools import lru_cache
import json
from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL

BASE_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = BASE_DIR.parent


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "Healthcare GenAI Platform"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"

    DATABASE_URL: Optional[str] = None
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: Optional[str] = None
    POSTGRES_USER: Optional[str] = None
    POSTGRES_PASSWORD: Optional[str] = None
    SQL_ECHO: bool = False

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    DIABETES_MODEL_PATH: str = "ai-artifacts/predictive/xgboost_diabetes_model.pkl"
    DIABETES_IMPUTATION_PATH: str = "ai-artifacts/preprocessing/imputation_values.json"
    DIABETES_MODEL_NAME: str = "xgboost_diabetes_model"
    DIABETES_MODEL_VERSION: str = "pima-colab-v1"

    # Legacy/existing GenAI settings preserved for backward compatibility
    GENAI_PROVIDER: str = "gemini"
    GENAI_API_KEY: Optional[str] = None
    GENAI_MODEL: str = "gemini-2.5-flash"
    GENAI_BASE_URL: Optional[str] = None
    GENAI_TIMEOUT_SECONDS: float = 30.0

    # Gemini API + RAG configuration
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_EMBEDDING_MODEL: str = "gemini-embedding-001"
    GEMINI_EMBEDDING_DIMENSION: int = Field(default=768, ge=1, le=3072)
    GEMINI_EMBEDDING_BATCH_SIZE: int = Field(default=50, ge=1, le=100)
    GEMINI_TIMEOUT_SECONDS: float = Field(default=30.0, gt=0.0, le=300.0)
    VECTOR_STORE_BACKEND: str = "postgres_numpy"
    RAG_TOP_K: int = Field(default=5, ge=1, le=50)
    RAG_MIN_SIMILARITY: float = Field(default=0.35, ge=0.0, le=1.0)
    RAG_CHUNK_SIZE: int = Field(default=1000, ge=100, le=8000)
    RAG_CHUNK_OVERLAP: int = Field(default=150, ge=0, le=2000)
    GENAI_DEMO_MODE: bool = False

    @field_validator("RAG_CHUNK_OVERLAP")
    @classmethod
    def validate_chunk_overlap(cls, value: int, info) -> int:
        chunk_size = info.data.get("RAG_CHUNK_SIZE", 1000)
        if value >= chunk_size:
            raise ValueError("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE.")
        return value

    @field_validator("VECTOR_STORE_BACKEND")
    @classmethod
    def validate_vector_store_backend(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if cleaned != "postgres_numpy":
            raise ValueError(
                "Only 'postgres_numpy' is supported for VECTOR_STORE_BACKEND in this phase."
            )
        return cleaned

    def get_gemini_api_key(self) -> Optional[str]:
        """Return configured Gemini API key without exposing it in logs or responses."""
        for candidate in (self.GEMINI_API_KEY, self.GENAI_API_KEY):
            if candidate and candidate.strip():
                return candidate.strip()
        return None

    def get_gemini_model(self) -> str:
        """Resolve the configured Gemini generation model identifier."""
        for candidate in (self.GEMINI_MODEL, self.GENAI_MODEL):
            if candidate and candidate.strip():
                return candidate.strip()
        return "gemini-2.5-flash"

    def get_cors_origins(self) -> list[str]:
        """Parse configured CORS origins from a comma-separated string or JSON list."""
        raw = self.CORS_ORIGINS.strip()
        if not raw:
            return []
        if raw.startswith("["):
            parsed = json.loads(raw)
            return [str(origin).strip() for origin in parsed if str(origin).strip()]
        return [origin.strip() for origin in raw.split(",") if origin.strip()]

    def resolve_artifact_path(self, configured_path: str) -> Path:
        """Resolve an artifact path against the project root when relative."""
        candidate = Path(configured_path)
        if candidate.is_absolute():
            return candidate
        project_candidate = PROJECT_ROOT / candidate
        if project_candidate.exists():
            return project_candidate
        backend_candidate = BASE_DIR / candidate
        if backend_candidate.exists():
            return backend_candidate
        return project_candidate

    def get_database_url(self) -> Optional[str]:
        """Resolve the SQLAlchemy database URL from environment configuration."""
        if self.DATABASE_URL:
            url = self.DATABASE_URL.strip()
            if url.startswith("postgres://"):
                return "postgresql+psycopg://" + url[len("postgres://"):]
            if url.startswith("postgresql://"):
                return "postgresql+psycopg://" + url[len("postgresql://"):]
            return url

        if self.POSTGRES_USER and self.POSTGRES_PASSWORD and self.POSTGRES_DB:
            return URL.create(
                drivername="postgresql+psycopg",
                username=self.POSTGRES_USER,
                password=self.POSTGRES_PASSWORD,
                host=self.POSTGRES_HOST,
                port=self.POSTGRES_PORT,
                database=self.POSTGRES_DB,
            ).render_as_string(hide_password=False)

        return None


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()


settings = get_settings()
