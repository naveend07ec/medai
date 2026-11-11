import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.models.clinical_assessment import ClinicalAssessment
from app.models.patient import Patient
from app.schemas.assessment import ClinicalAssessmentResponse
from app.schemas.patient import PatientCreateRequest, PatientResponse

router = APIRouter(prefix="/patients", tags=["Patients"])


def _generate_unique_patient_code(db: Session) -> str:
    """Generate a collision-checked patient code when none is supplied."""
    for _ in range(10):
        candidate = f"PT-{uuid.uuid4().hex[:8].upper()}"
        exists = db.scalar(
            select(Patient.id).where(Patient.patient_code == candidate)
        )
        if exists is None:
            return candidate
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Unable to allocate a unique patient code.",
    )


@router.post(
    "",
    response_model=PatientResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a patient identity record",
)
def create_patient(
    payload: PatientCreateRequest,
    db: Session = Depends(get_db),
) -> Patient:
    """Persist a new patient identity record without clinical assessment fields."""
    patient_code = payload.patient_code or _generate_unique_patient_code(db)

    if payload.patient_code:
        existing = db.scalar(
            select(Patient.id).where(Patient.patient_code == patient_code)
        )
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A patient with this patient code already exists.",
            )

    patient = Patient(
        patient_code=patient_code,
        full_name=payload.full_name,
        date_of_birth=payload.date_of_birth,
        sex=payload.sex,
        contact_number=payload.contact_number,
    )
    db.add(patient)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A patient with this patient code already exists.",
        ) from exc

    db.refresh(patient)
    return patient


@router.get(
    "",
    response_model=list[PatientResponse],
    summary="List patient identity records",
)
def list_patients(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[Patient]:
    """Return patient identity records ordered from newest to oldest."""
    stmt = (
        select(Patient)
        .order_by(Patient.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(db.scalars(stmt).all())


@router.get(
    "/by-code/{patient_code}",
    response_model=PatientResponse,
    summary="Look up a patient by patient code",
)
def get_patient_by_code(
    patient_code: str,
    db: Session = Depends(get_db),
) -> Patient:
    """Retrieve a single patient record by its unique patient_code."""
    patient = db.scalar(
        select(Patient).where(Patient.patient_code == patient_code.strip())
    )
    if patient is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient record not found.",
        )
    return patient


@router.get(
    "/{patient_id}",
    response_model=PatientResponse,
    summary="Look up a patient by UUID",
)
def get_patient_by_id(
    patient_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> Patient:
    """Retrieve a single patient record by its UUID primary key."""
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient record not found.",
        )
    return patient


@router.get(
    "/{patient_id}/assessments",
    response_model=list[ClinicalAssessmentResponse],
    summary="List clinical assessments for a specific patient",
)
def list_patient_assessments(
    patient_id: uuid.UUID,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[ClinicalAssessment]:
    """Retrieve clinical assessment history for the referenced patient UUID."""
    patient = db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient record not found.",
        )

    stmt = (
        select(ClinicalAssessment)
        .options(joinedload(ClinicalAssessment.patient))
        .where(ClinicalAssessment.patient_id == patient_id)
        .order_by(ClinicalAssessment.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(db.scalars(stmt).all())
