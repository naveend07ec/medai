import json
from pathlib import Path
import sys

from fastapi.testclient import TestClient
import numpy as np
import pytest

from app.main import app
from app.services.predictive_ai.diabetes_predictor import (
    DIABETES_FEATURES,
    DiabetesPredictor,
)

predictor_module = sys.modules["app.services.predictive_ai.diabetes_predictor"]


class MockDiabetesClassifier:
    """Deterministic mock estimator mimicking an XGBoost/scikit-learn classifier."""

    classes_ = np.array([0, 1])

    def __init__(self, prob_class_0: float = 0.27, prob_class_1: float = 0.73) -> None:
        self.prob_class_0 = prob_class_0
        self.prob_class_1 = prob_class_1
        self.recorded_inputs: list[np.ndarray] = []

    def predict_proba(self, features: np.ndarray) -> np.ndarray:
        self.recorded_inputs.append(features.copy())
        return np.array([[self.prob_class_0, self.prob_class_1]] * len(features))

    def predict(self, features: np.ndarray) -> np.ndarray:
        predicted = 1 if self.prob_class_1 >= self.prob_class_0 else 0
        return np.array([predicted] * len(features))


@pytest.fixture()
def sample_imputation_values() -> dict[str, float]:
    return {
        "Glucose": 117.0,
        "BloodPressure": 72.0,
        "SkinThickness": 29.0,
        "Insulin": 125.0,
        "BMI": 32.3,
    }


@pytest.fixture()
def configured_mock_predictor(
    monkeypatch,
    tmp_path: Path,
    sample_imputation_values: dict[str, float],
) -> MockDiabetesClassifier:
    """Configure the singleton diabetes_predictor with temp artifacts and a mocked model."""
    model_file = tmp_path / "xgboost_diabetes_model.pkl"
    model_file.write_bytes(b"placeholder-artifact")

    imputation_file = tmp_path / "imputation_values.json"
    imputation_file.write_text(json.dumps(sample_imputation_values), encoding="utf-8")

    mock_model = MockDiabetesClassifier(prob_class_0=0.27, prob_class_1=0.73)
    load_counter = {"count": 0}

    def fake_load_pickle(_path: Path) -> MockDiabetesClassifier:
        load_counter["count"] += 1
        return mock_model

    monkeypatch.setattr(predictor_module, "_load_pickle_artifact", fake_load_pickle)

    predictor = predictor_module.diabetes_predictor
    predictor.reset()
    monkeypatch.setattr(predictor, "_explicit_model_path", model_file)
    monkeypatch.setattr(predictor, "_explicit_imputation_path", imputation_file)
    monkeypatch.setattr(predictor, "_explicit_model_name", "xgboost_diabetes_model")
    monkeypatch.setattr(predictor, "_explicit_model_version", "pima-colab-v1")

    mock_model.load_counter = load_counter  # type: ignore[attr-defined]
    yield mock_model
    predictor.reset()


def test_valid_diabetes_prediction_and_single_load(configured_mock_predictor):
    """Valid inputs return expected schema, probabilities, disclaimer, and load model once."""
    payload = {
        "Pregnancies": 2,
        "Glucose": 148.0,
        "BloodPressure": 76.0,
        "SkinThickness": 32.0,
        "Insulin": 140.0,
        "BMI": 33.6,
        "DiabetesPedigreeFunction": 0.627,
        "Age": 45,
    }

    with TestClient(app) as client:
        health_res = client.get("/api/v1/predictions/diabetes/health")
        assert health_res.status_code == 200
        assert health_res.json()["status"] == "ready"
        assert health_res.json()["model_loaded"] is True
        assert health_res.json()["imputation_loaded"] is True

        first_res = client.post("/api/v1/predictions/diabetes", json=payload)
        second_res = client.post("/api/v1/predictions/diabetes", json=payload)

    assert first_res.status_code == 200
    assert second_res.status_code == 200
    assert configured_mock_predictor.load_counter["count"] == 1

    body = first_res.json()
    assert set(body.keys()) == {
        "predicted_class",
        "class_0_probability",
        "class_1_probability",
        "model_name",
        "model_version",
        "module_name",
        "clinical_disclaimer",
    }
    assert body["predicted_class"] == 1
    assert body["class_0_probability"] == pytest.approx(0.27)
    assert body["class_1_probability"] == pytest.approx(0.73)
    assert body["model_name"] == "xgboost_diabetes_model"
    assert body["model_version"] == "pima-colab-v1"
    assert body["module_name"] == "Diabetes prediction experiment"

    disclaimer = body["clinical_disclaimer"].lower()
    assert "research prototype" in disclaimer
    assert "not" in disclaimer and "diagnosis" in disclaimer


def test_saved_imputation_preprocessing_and_feature_order(
    configured_mock_predictor,
    sample_imputation_values: dict[str, float],
):
    """Zero values in physiological columns are imputed with saved medians; Pregnancies=0 stays 0."""
    payload = {
        "Pregnancies": 0,
        "Glucose": 0.0,
        "BloodPressure": 0.0,
        "SkinThickness": 0.0,
        "Insulin": 0.0,
        "BMI": 0.0,
        "DiabetesPedigreeFunction": 0.45,
        "Age": 31,
    }

    with TestClient(app) as client:
        res = client.post("/api/v1/predictions/diabetes", json=payload)

    assert res.status_code == 200
    assert len(configured_mock_predictor.recorded_inputs) == 1
    recorded = configured_mock_predictor.recorded_inputs[0]
    assert recorded.shape == (1, len(DIABETES_FEATURES))

    expected_order = [
        0.0,  # Pregnancies=0 must NOT be overwritten
        sample_imputation_values["Glucose"],
        sample_imputation_values["BloodPressure"],
        sample_imputation_values["SkinThickness"],
        sample_imputation_values["Insulin"],
        sample_imputation_values["BMI"],
        0.45,
        31.0,
    ]
    assert recorded[0].tolist() == pytest.approx(expected_order)


def test_invalid_or_missing_feature_values_rejected(configured_mock_predictor):
    """Missing fields, negative values, and invalid types return HTTP 422."""
    with TestClient(app) as client:
        missing_res = client.post(
            "/api/v1/predictions/diabetes",
            json={"Pregnancies": 1, "Glucose": 120},
        )
        assert missing_res.status_code == 422

        negative_glucose = client.post(
            "/api/v1/predictions/diabetes",
            json={
                "Pregnancies": 1,
                "Glucose": -10,
                "BloodPressure": 70,
                "SkinThickness": 20,
                "Insulin": 80,
                "BMI": 25.0,
                "DiabetesPedigreeFunction": 0.5,
                "Age": 30,
            },
        )
        assert negative_glucose.status_code == 422

        zero_age = client.post(
            "/api/v1/predictions/diabetes",
            json={
                "Pregnancies": 1,
                "Glucose": 120,
                "BloodPressure": 70,
                "SkinThickness": 20,
                "Insulin": 80,
                "BMI": 25.0,
                "DiabetesPedigreeFunction": 0.5,
                "Age": 0,
            },
        )
        assert zero_age.status_code == 422

        implausible_payloads = [
            {"Glucose": 15.0},
            {"BloodPressure": 10.0},
            {"BMI": 5.0},
            {"Pregnancies": 25},
            {"DiabetesPedigreeFunction": 0.01},
            {"Age": 15},
        ]
        base_valid = {
            "Pregnancies": 1,
            "Glucose": 120.0,
            "BloodPressure": 70.0,
            "SkinThickness": 20.0,
            "Insulin": 80.0,
            "BMI": 25.0,
            "DiabetesPedigreeFunction": 0.5,
            "Age": 30,
        }
        for override in implausible_payloads:
            res = client.post(
                "/api/v1/predictions/diabetes",
                json={**base_valid, **override},
            )
            assert res.status_code == 422


def test_missing_model_artifacts_handled_safely(monkeypatch, tmp_path: Path):
    """Missing artifacts return 503 without leaking internal filesystem paths or tracebacks."""
    missing_model = tmp_path / "secret_dir" / "xgboost_diabetes_model.pkl"
    missing_imputation = tmp_path / "secret_dir" / "imputation_values.json"

    isolated_predictor = DiabetesPredictor(
        model_path=missing_model,
        imputation_path=missing_imputation,
        model_name="xgboost_diabetes_model",
        model_version="pima-colab-v1",
    )
    monkeypatch.setattr(
        "app.api.v1.predictions.diabetes_predictor",
        isolated_predictor,
    )
    monkeypatch.setattr(
        "app.services.predictive_ai.diabetes_predictor",
        isolated_predictor,
    )

    with TestClient(app) as client:
        health_res = client.get("/api/v1/predictions/diabetes/health")
        assert health_res.status_code == 200
        health_body = health_res.json()
        assert health_body["status"] == "unavailable"
        assert health_body["model_loaded"] is False
        assert health_body["imputation_loaded"] is False
        assert "secret_dir" not in (health_body["detail"] or "")
        assert str(tmp_path) not in (health_body["detail"] or "")

        pred_res = client.post(
            "/api/v1/predictions/diabetes",
            json={
                "Pregnancies": 2,
                "Glucose": 120,
                "BloodPressure": 70,
                "SkinThickness": 20,
                "Insulin": 80,
                "BMI": 28.5,
                "DiabetesPedigreeFunction": 0.4,
                "Age": 34,
            },
        )
        assert pred_res.status_code == 503
        detail = pred_res.json()["detail"]
        assert "unavailable" in detail.lower()
        assert "secret_dir" not in detail
        assert str(tmp_path) not in detail
        assert "traceback" not in detail.lower()


def test_existing_health_and_cors_preserved():
    """Existing health endpoints and configured CORS headers function properly."""
    with TestClient(app) as client:
        root_res = client.get("/")
        assert root_res.status_code == 200
        assert root_res.json()["status"] == "running"

        health_res = client.get("/health")
        assert health_res.status_code == 200
        assert health_res.json()["status"] == "healthy"

        v1_health_res = client.get(
            "/api/v1/health",
            headers={"Origin": "http://localhost:5173"},
        )
        assert v1_health_res.status_code == 200
        assert v1_health_res.json()["api_version"] == "v1"
        assert v1_health_res.headers.get("access-control-allow-origin") == "http://localhost:5173"
