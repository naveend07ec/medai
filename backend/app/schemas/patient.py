from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PatientCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    date_of_birth: date
    sex: Optional[str] = Field(default=None, max_length=20)
    contact_number: Optional[str] = Field(
        default=None,
        max_length=20,
    )

    @field_validator("full_name")
    @classmethod
    def strip_full_name(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("Full name must contain at least 2 non-space characters.")
        return cleaned

    @field_validator("sex", "contact_number")
    @classmethod
    def strip_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class PatientCreateRequest(PatientCreate):
    """API request schema allowing an optional caller-specified patient_code."""

    patient_code: Optional[str] = Field(default=None, min_length=2, max_length=50)

    @field_validator("patient_code")
    @classmethod
    def strip_patient_code(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class PatientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    patient_code: str
    full_name: str
    date_of_birth: date
    sex: Optional[str] = None
    contact_number: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
