import json
import logging
import math
from pathlib import Path
import pickle
import threading
from typing import Any, Optional

import joblib
import numpy as np

from app.core.config import get_settings
from app.schemas.prediction import (
    DiabetesPredictionRequest,
    DiabetesPredictionResponse,
    PredictiveModelHealthResponse,
)

logger = logging.getLogger(__name__)

DIABETES_FEATURES: tuple[str, ...] = (
    "Pregnancies",
    "Glucose",
    "BloodPressure",
    "SkinThickness",
    "Insulin",
    "BMI",
    "DiabetesPedigreeFunction",
    "Age",
)

ZERO_AS_MISSING_FEATURES: tuple[str, ...] = (
    "Glucose",
    "BloodPressure",
    "SkinThickness",
    "Insulin",
    "BMI",
)

MODULE_NAME = "Diabetes prediction experiment"
CLINICAL_DISCLAIMER = (
    "Research prototype output only. Estimated probabilities reflect statistical "
    "model patterns on historical Pima dataset features and do not represent a "
    "medical diagnosis, clinical certainty, or treatment advice. Consult a qualified "
    "healthcare professional for clinical evaluation."
)


class ModelUnavailableError(RuntimeError):
    """Raised when predictive model artifacts are missing or cannot be loaded."""


def _load_pickle_artifact(model_path: Path) -> Any:
    """Load a serialized scikit-learn/XGBoost model artifact."""
    try:
        return joblib.load(model_path)
    except Exception:
        with model_path.open("rb") as artifact_file:
            return pickle.load(artifact_file)


def _parse_imputation_payload(raw_payload: Any) -> tuple[dict[str, float], tuple[str, ...]]:
    """Extract training-fitted median imputation values from saved JSON."""
    if not isinstance(raw_payload, dict):
        raise ValueError("Imputation artifact must be a JSON object.")

    zero_cols = raw_payload.get("zero_as_missing_columns")
    if isinstance(zero_cols, list) and all(isinstance(col, str) for col in zero_cols):
        zero_as_missing = tuple(col for col in zero_cols if col in DIABETES_FEATURES)
    else:
        zero_as_missing = ZERO_AS_MISSING_FEATURES

    candidate_values = raw_payload
    for nested_key in ("medians", "imputation_values", "values"):
        if isinstance(raw_payload.get(nested_key), dict):
            candidate_values = raw_payload[nested_key]
            break

    parsed: dict[str, float] = {}
    for feature in DIABETES_FEATURES:
        if feature in candidate_values:
            numeric_value = float(candidate_values[feature])
            if not math.isfinite(numeric_value):
                raise ValueError(f"Non-finite imputation value for {feature}.")
            parsed[feature] = numeric_value

    missing_required = [col for col in zero_as_missing if col not in parsed]
    if missing_required:
        raise ValueError(
            "Imputation artifact is missing required training-fitted median values."
        )

    return parsed, zero_as_missing


class DiabetesPredictor:
    """Manages loading, preprocessing, and inference for the diabetes XGBoost model."""

    def __init__(
        self,
        model_path: Optional[Path] = None,
        imputation_path: Optional[Path] = None,
        model_name: Optional[str] = None,
        model_version: Optional[str] = None,
    ) -> None:
        self._explicit_model_path = model_path
        self._explicit_imputation_path = imputation_path
        self._explicit_model_name = model_name
        self._explicit_model_version = model_version
        self._lock = threading.Lock()
        self._model: Any = None
        self._imputation_values: Optional[dict[str, float]] = None
        self._zero_as_missing: tuple[str, ...] = ZERO_AS_MISSING_FEATURES

    def _resolve_config(self) -> tuple[Path, Path, str, str]:
        current_settings = get_settings()
        model_path = self._explicit_model_path or current_settings.resolve_artifact_path(
            current_settings.DIABETES_MODEL_PATH
        )
        imputation_path = (
            self._explicit_imputation_path
            or current_settings.resolve_artifact_path(current_settings.DIABETES_IMPUTATION_PATH)
        )
        model_name = self._explicit_model_name or current_settings.DIABETES_MODEL_NAME
        model_version = self._explicit_model_version or current_settings.DIABETES_MODEL_VERSION
        return model_path, imputation_path, model_name, model_version

    def reset(self) -> None:
        """Clear cached artifacts so they can be reloaded on next use."""
        with self._lock:
            self._model = None
            self._imputation_values = None
            self._zero_as_missing = ZERO_AS_MISSING_FEATURES

    def load_artifacts(self) -> None:
        """Load the model and saved imputation values once into memory."""
        with self._lock:
            if self._model is not None and self._imputation_values is not None:
                return

            model_path, imputation_path, _, _ = self._resolve_config()

            if not model_path.is_file() or not imputation_path.is_file():
                logger.warning("Diabetes predictive model artifacts are missing.")
                raise ModelUnavailableError(
                    "Predictive model artifacts are currently unavailable."
                )

            try:
                raw_json = json.loads(imputation_path.read_text(encoding="utf-8"))
                imputation_values, zero_cols = _parse_imputation_payload(raw_json)
            except Exception:
                logger.exception("Failed to load diabetes imputation values artifact.")
                raise ModelUnavailableError(
                    "Predictive preprocessing configuration could not be loaded."
                )

            try:
                model = _load_pickle_artifact(model_path)
                if not hasattr(model, "predict_proba"):
                    raise TypeError("Loaded model does not support predict_proba.")
            except Exception:
                logger.exception("Failed to load diabetes predictive model artifact.")
                raise ModelUnavailableError(
                    "Predictive model artifact could not be loaded."
                )

            self._imputation_values = imputation_values
            self._zero_as_missing = zero_cols
            self._model = model
            logger.info("Diabetes predictive model artifacts loaded successfully.")

    def _ensure_loaded(self) -> None:
        if self._model is None or self._imputation_values is None:
            self.load_artifacts()

    def preprocess(self, payload: DiabetesPredictionRequest) -> np.ndarray:
        """Order features and apply saved training-fitted median imputation."""
        self._ensure_loaded()
        assert self._imputation_values is not None

        raw_data = payload.model_dump()
        ordered_values: list[float] = []

        for feature in DIABETES_FEATURES:
            value = float(raw_data[feature])
            if feature in self._zero_as_missing and (value == 0.0 or math.isnan(value)):
                value = self._imputation_values[feature]
            ordered_values.append(value)

        return np.asarray([ordered_values], dtype=float)

    def predict(self, payload: DiabetesPredictionRequest) -> DiabetesPredictionResponse:
        """Run preprocessing and inference to return class and probability estimates."""
        self._ensure_loaded()
        assert self._model is not None

        features = self.preprocess(payload)
        probabilities = self._model.predict_proba(features)[0]

        classes = list(getattr(self._model, "classes_", [0, 1]))
        if 0 in classes and 1 in classes:
            prob_0 = float(probabilities[classes.index(0)])
            prob_1 = float(probabilities[classes.index(1)])
        else:
            prob_0 = float(probabilities[0])
            prob_1 = float(probabilities[1])

        if hasattr(self._model, "predict"):
            predicted_raw = int(self._model.predict(features)[0])
        else:
            predicted_raw = 1 if prob_1 >= prob_0 else 0

        predicted_class = 1 if predicted_raw == 1 else 0
        _, _, model_name, model_version = self._resolve_config()

        return DiabetesPredictionResponse(
            predicted_class=predicted_class,
            class_0_probability=round(prob_0, 6),
            class_1_probability=round(prob_1, 6),
            model_name=model_name,
            model_version=model_version,
            module_name=MODULE_NAME,
            clinical_disclaimer=CLINICAL_DISCLAIMER,
        )

    def health_status(self) -> PredictiveModelHealthResponse:
        """Report model artifact readiness without exposing internal file paths."""
        _, _, model_name, model_version = self._resolve_config()
        detail: Optional[str] = None

        if self._model is None or self._imputation_values is None:
            try:
                self.load_artifacts()
            except ModelUnavailableError as exc:
                detail = str(exc)

        model_loaded = self._model is not None
        imputation_loaded = self._imputation_values is not None
        is_ready = model_loaded and imputation_loaded

        return PredictiveModelHealthResponse(
            module_name=MODULE_NAME,
            model_name=model_name,
            model_version=model_version,
            status="ready" if is_ready else "unavailable",
            model_loaded=model_loaded,
            imputation_loaded=imputation_loaded,
            detail=None if is_ready else (detail or "Predictive model artifacts are unavailable."),
        )


diabetes_predictor = DiabetesPredictor()


def load_diabetes_predictor() -> None:
    """Preload diabetes predictor artifacts at startup without crashing if absent."""
    try:
        diabetes_predictor.load_artifacts()
    except ModelUnavailableError:
        logger.warning(
            "Startup preload skipped: diabetes predictive model artifacts are not yet available."
        )

