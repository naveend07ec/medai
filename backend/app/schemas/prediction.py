import math
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationInfo, field_validator

ZERO_OR_PLAUSIBLE_MIN: dict[str, tuple[float, float, str]] = {
    "Glucose": (30.0, 500.0, "mg/dL"),
    "BloodPressure": (20.0, 200.0, "mm Hg"),
    "SkinThickness": (5.0, 100.0, "mm"),
    "Insulin": (2.0, 900.0, "mu U/ml"),
    "BMI": (10.0, 80.0, "kg/m^2"),
}


class DiabetesPredictionRequest(BaseModel):
    """Input features in the exact order expected by the Pima diabetes XGBoost model."""

    Pregnancies: int = Field(
        ...,
        ge=0,
        le=20,
        description="Number of pregnancies (0-20)",
    )
    Glucose: float = Field(
        ...,
        ge=0,
        le=500,
        description="Plasma glucose concentration (mg/dL); 0 triggers saved median imputation or 30-500",
    )
    BloodPressure: float = Field(
        ...,
        ge=0,
        le=200,
        description="Diastolic blood pressure (mm Hg); 0 triggers saved median imputation or 20-200",
    )
    SkinThickness: float = Field(
        ...,
        ge=0,
        le=100,
        description="Triceps skin fold thickness (mm); 0 triggers saved median imputation or 5-100",
    )
    Insulin: float = Field(
        ...,
        ge=0,
        le=900,
        description="2-hour serum insulin (mu U/ml); 0 triggers saved median imputation or 2-900",
    )
    BMI: float = Field(
        ...,
        ge=0,
        le=80,
        description="Body mass index (kg/m^2); 0 triggers saved median imputation or 10-80",
    )
    DiabetesPedigreeFunction: float = Field(
        ...,
        ge=0.05,
        le=3.0,
        description="Diabetes pedigree function score (0.05-3.0)",
    )
    Age: int = Field(
        ...,
        ge=18,
        le=110,
        description="Age in years (18-110, adult Pima dataset cohort)",
    )

    @field_validator(
        "Glucose",
        "BloodPressure",
        "SkinThickness",
        "Insulin",
        "BMI",
        "DiabetesPedigreeFunction",
    )
    @classmethod
    def ensure_finite_float(cls, value: float) -> float:
        """Reject NaN or infinite numerical inputs."""
        if not math.isfinite(value):
            raise ValueError("Value must be a finite number.")
        return value

    @field_validator(
        "Glucose",
        "BloodPressure",
        "SkinThickness",
        "Insulin",
        "BMI",
    )
    @classmethod
    def validate_zero_or_plausible_range(
        cls, value: float, info: ValidationInfo
    ) -> float:
        """Allow 0 for saved median imputation or require a physiologically plausible value."""
        if value == 0:
            return value
        min_val, max_val, unit = ZERO_OR_PLAUSIBLE_MIN[info.field_name]
        if value < min_val or value > max_val:
            raise ValueError(
                f"{info.field_name} must be 0 (missing-value code) or between "
                f"{min_val:g} and {max_val:g} {unit}."
            )
        return value


class DiabetesPredictionResponse(BaseModel):
    """Model-estimated output for the diabetes predictive experiment."""

    predicted_class: Literal[0, 1]
    class_0_probability: float = Field(..., ge=0.0, le=1.0)
    class_1_probability: float = Field(..., ge=0.0, le=1.0)
    model_name: str
    model_version: str
    module_name: str = "Diabetes prediction experiment"
    clinical_disclaimer: str


class PredictiveModelHealthResponse(BaseModel):
    """Readiness status and metadata for the predictive AI module."""

    module_name: str = "Diabetes prediction experiment"
    model_name: str
    model_version: str
    status: Literal["ready", "unavailable"]
    model_loaded: bool
    imputation_loaded: bool
    detail: Optional[str] = None
