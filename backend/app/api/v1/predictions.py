from fastapi import APIRouter, HTTPException, status

from app.schemas.prediction import (
    DiabetesPredictionRequest,
    DiabetesPredictionResponse,
    PredictiveModelHealthResponse,
)
from app.services.predictive_ai import ModelUnavailableError, diabetes_predictor

router = APIRouter(prefix="/predictions", tags=["Predictive AI"])


@router.get(
    "/diabetes/health",
    response_model=PredictiveModelHealthResponse,
    summary="Check diabetes predictive experiment model readiness",
)
def diabetes_model_health() -> PredictiveModelHealthResponse:
    """Return metadata and readiness status for the diabetes predictive model."""
    return diabetes_predictor.health_status()


@router.post(
    "/diabetes",
    response_model=DiabetesPredictionResponse,
    summary="Run the diabetes predictive research experiment",
)
def predict_diabetes(payload: DiabetesPredictionRequest) -> DiabetesPredictionResponse:
    """Estimate class probabilities using the pre-trained Pima diabetes XGBoost model."""
    try:
        return diabetes_predictor.predict(payload)
    except ModelUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

