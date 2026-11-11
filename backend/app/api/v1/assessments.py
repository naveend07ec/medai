from datetime import datetime, timezone
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.models.clinical_assessment import ClinicalAssessment
from app.models.diagnostic_report import DiagnosticReport
from app.models.patient import Patient
from app.schemas.assessment import (
    ClinicalAssessmentCreate,
    ClinicalAssessmentResponse,
    ClinicalAssessmentReviewUpdate,
)
from app.schemas.report import (
    DiagnosticReportContent,
    DiagnosticReportResponse,
    DiagnosticReportReviewUpdate,
    GenAIHealthResponse,
)
from app.services.generative_ai import GenAIUnavailableError, genai_diagnostic_service

router = APIRouter(prefix="/assessments", tags=["Clinical Assessments"])


def _to_report_response(record: DiagnosticReport) -> DiagnosticReportResponse:
    return DiagnosticReportResponse(
        id=record.id,
        assessment_id=record.assessment_id,
        provider=record.provider,
        model_name=record.model_name,
        report=DiagnosticReportContent.model_validate(record.report_payload),
        clinician_reviewed=record.clinician_reviewed,
        clinician_notes=record.clinician_notes,
        reviewed_at=record.reviewed_at,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _get_assessment_or_404(
    db: Session,
    assessment_id: uuid.UUID,
) -> ClinicalAssessment:
    stmt = (
        select(ClinicalAssessment)
        .options(joinedload(ClinicalAssessment.patient))
        .where(ClinicalAssessment.id == assessment_id)
    )
    assessment = db.scalar(stmt)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clinical assessment record not found.",
        )
    return assessment


def _get_latest_report_or_404(
    db: Session,
    assessment_id: uuid.UUID,
) -> DiagnosticReport:
    stmt = (
        select(DiagnosticReport)
        .where(DiagnosticReport.assessment_id == assessment_id)
        .order_by(DiagnosticReport.created_at.desc())
        .limit(1)
    )
    report = db.scalar(stmt)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No diagnostic report has been generated for this assessment yet.",
        )
    return report


@router.get(
    "/genai/health",
    response_model=GenAIHealthResponse,
    summary="Check external GenAI diagnostic report service readiness",
)
def genai_report_health() -> GenAIHealthResponse:
    """Return configuration readiness for GenAI diagnostic report generation."""
    return genai_diagnostic_service.health_status()


@router.post(
    "",
    response_model=ClinicalAssessmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a clinical assessment linked to a patient",
)
def create_assessment(
    payload: ClinicalAssessmentCreate,
    db: Session = Depends(get_db),
) -> ClinicalAssessment:
    """Persist a clinical assessment linked to an existing patient UUID."""
    patient = db.get(Patient, payload.patient_id)
    if patient is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Referenced patient record not found.",
        )

    assessment = ClinicalAssessment(
        patient_id=payload.patient_id,
        demographics_notes=payload.demographics_notes,
        current_symptoms=payload.current_symptoms,
        symptom_duration=payload.symptom_duration,
        previous_conditions=payload.previous_conditions,
        existing_medications=payload.existing_medications,
        medical_history_notes=payload.medical_history_notes,
        systolic_bp=payload.systolic_bp,
        diastolic_bp=payload.diastolic_bp,
        heart_rate=payload.heart_rate,
        body_temperature=payload.body_temperature,
        oxygen_saturation=payload.oxygen_saturation,
        additional_measurements=payload.additional_measurements,
        lab_results=payload.lab_results,
        ehr_summary=payload.ehr_summary,
        previous_reports=payload.previous_reports,
        attached_report_names=payload.attached_report_names,
        attached_images=[img.model_dump() for img in payload.attached_images],
        imaging_notes=payload.imaging_notes,
        genomic_notes=payload.genomic_notes,
        family_history_markers=payload.family_history_markers,
        preprocessing_summary=payload.preprocessing_summary,
        predictive_experiment_result=payload.predictive_experiment_result,
        clinician_reviewed=payload.clinician_reviewed,
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)

    return _get_assessment_or_404(db, assessment.id)


@router.get(
    "",
    response_model=list[ClinicalAssessmentResponse],
    summary="List clinical assessment history",
)
def list_assessments(
    patient_id: Optional[uuid.UUID] = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[ClinicalAssessment]:
    """Return clinical assessments ordered from newest to oldest."""
    stmt = (
        select(ClinicalAssessment)
        .options(joinedload(ClinicalAssessment.patient))
        .order_by(ClinicalAssessment.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    if patient_id is not None:
        stmt = stmt.where(ClinicalAssessment.patient_id == patient_id)
    return list(db.scalars(stmt).all())


@router.get(
    "/{assessment_id}",
    response_model=ClinicalAssessmentResponse,
    summary="Retrieve a clinical assessment by UUID",
)
def get_assessment(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> ClinicalAssessment:
    """Return a single clinical assessment with its linked patient summary."""
    return _get_assessment_or_404(db, assessment_id)


@router.patch(
    "/{assessment_id}/review",
    response_model=ClinicalAssessmentResponse,
    summary="Update clinician review acknowledgment status",
)
def update_assessment_review(
    assessment_id: uuid.UUID,
    payload: ClinicalAssessmentReviewUpdate,
    db: Session = Depends(get_db),
) -> ClinicalAssessment:
    """Persist clinician review status on an existing clinical assessment."""
    assessment = _get_assessment_or_404(db, assessment_id)
    assessment.clinician_reviewed = payload.clinician_reviewed
    db.commit()
    db.refresh(assessment)
    return assessment


@router.post(
    "/{assessment_id}/generate-report",
    response_model=DiagnosticReportResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate and persist a structured GenAI diagnostic report",
)
def generate_assessment_report(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> DiagnosticReportResponse:
    """Analyze a saved clinical assessment via external GenAI and persist the report."""
    assessment = _get_assessment_or_404(db, assessment_id)

    try:
        provider, model_name, content = genai_diagnostic_service.generate_report(
            assessment
        )
    except GenAIUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    record = DiagnosticReport(
        assessment_id=assessment.id,
        provider=provider,
        model_name=model_name,
        report_payload=content.model_dump(),
        clinician_reviewed=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _to_report_response(record)


@router.get(
    "/{assessment_id}/report",
    response_model=DiagnosticReportResponse,
    summary="Retrieve the latest persisted GenAI diagnostic report",
)
def get_assessment_report(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> DiagnosticReportResponse:
    """Return the latest generated diagnostic report for the referenced assessment."""
    _get_assessment_or_404(db, assessment_id)
    record = _get_latest_report_or_404(db, assessment_id)
    return _to_report_response(record)


@router.patch(
    "/{assessment_id}/report/review",
    response_model=DiagnosticReportResponse,
    summary="Record clinician review status and notes on a generated diagnostic report",
)
def review_assessment_report(
    assessment_id: uuid.UUID,
    payload: DiagnosticReportReviewUpdate,
    db: Session = Depends(get_db),
) -> DiagnosticReportResponse:
    """Persist clinician review status and notes on the latest diagnostic report."""
    assessment = _get_assessment_or_404(db, assessment_id)
    record = _get_latest_report_or_404(db, assessment_id)

    cleaned_notes = payload.clinician_notes.strip() if payload.clinician_notes else None
    record.clinician_reviewed = payload.clinician_reviewed
    record.clinician_notes = cleaned_notes or None
    record.reviewed_at = (
        datetime.now(timezone.utc) if payload.clinician_reviewed else None
    )
    assessment.clinician_reviewed = payload.clinician_reviewed

    db.commit()
    db.refresh(record)
    return _to_report_response(record)
