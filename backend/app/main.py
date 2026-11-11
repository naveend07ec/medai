from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.api.v1.assessments import router as assessments_router
from app.api.v1.health import router as health_router
from app.api.v1.knowledge import router as knowledge_router
from app.api.v1.patients import router as patients_router
from app.api.v1.predictions import router as predictions_router
from app.core.config import settings
from app.core.database import DatabaseNotConfiguredError
from app.services.predictive_ai import load_diabetes_predictor

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Load predictive model artifacts once during application startup when available."""
    load_diabetes_predictor()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    description=(
        "Privacy-aware AI-assisted healthcare "
        "research and clinical decision-support prototype."
    ),
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)


@app.exception_handler(DatabaseNotConfiguredError)
async def database_not_configured_handler(
    _request: Request, _exc: DatabaseNotConfiguredError
) -> JSONResponse:
    logger.warning("Database endpoint requested before DATABASE_URL configuration.")
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": (
                "Database is not configured. Set DATABASE_URL in backend/.env "
                "and run Alembic migrations."
            )
        },
    )


@app.exception_handler(OperationalError)
async def database_operational_error_handler(
    _request: Request, _exc: OperationalError
) -> JSONResponse:
    logger.error("Database connection or operational failure.")
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": (
                "Database service is currently unavailable. Verify PostgreSQL is "
                "running and migrations have been applied."
            )
        },
    )


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_error_handler(
    _request: Request, _exc: SQLAlchemyError
) -> JSONResponse:
    logger.error("Unhandled database error during request processing.")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "A database error occurred while processing the request."},
    )


app.include_router(
    health_router,
    prefix="/api/v1",
)
app.include_router(
    patients_router,
    prefix="/api/v1",
)
app.include_router(
    assessments_router,
    prefix="/api/v1",
)
app.include_router(
    knowledge_router,
    prefix="/api/v1",
)
app.include_router(
    predictions_router,
    prefix="/api/v1",
)


@app.get("/")
def root():
    return {
        "project": "Healthcare GenAI Platform",
        "status": "running",
        "version": "0.1.0",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "Healthcare GenAI Backend",
    }
