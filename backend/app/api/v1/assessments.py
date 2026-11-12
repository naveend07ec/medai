from typing import Optional
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.models.assessment_attachment import AssessmentAttachment
from app.models.clinical_assessment import ClinicalAssessment
from app.models.patient import Patient
from app.schemas.assessment import (
    AssessmentAttachmentResponse,
    ClinicalAssessmentCreate,
    ClinicalAssessmentResponse,
    ClinicalAssessmentReviewUpdate,
)
from app.schemas.report import (
    DiagnosticReportResponse,
    DiagnosticReportReviewUpdate,
    GenAIHealthResponse,
)
from app.services.generative_ai import (
    AssessmentReportEmergencyFallbackError,
    GeminiRateLimitError,
    GeminiServiceError,
    clinical_response_service,
    gemini_service,
)
from app.services.multimodal import (
    DocumentProcessingError,
    ImageProcessingError,
    extract_and_store_clinical_document,
    load_sanitized_image_bytes,
    validate_and_store_medical_image,
)
from app.services.privacy.safety_validation_service import ClinicalSafetyValidationError

router = APIRouter(prefix="/assessments", tags=["Clinical Assessments"])


def _get_assessment_or_404(
    db: Session,
    assessment_id: uuid.UUID,
) -> ClinicalAssessment:
    stmt = (
        select(ClinicalAssessment)
        .options(
            joinedload(ClinicalAssessment.patient),
            joinedload(ClinicalAssessment.attachments),
        )
        .where(ClinicalAssessment.id == assessment_id)
    )
    assessment = db.scalar(stmt)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clinical assessment record not found.",
        )
    return assessment


@router.get(
    "/genai/health",
    response_model=GenAIHealthResponse,
    summary="Check Gemini diagnostic report service readiness",
)
def genai_report_health(db: Session = Depends(get_db)) -> GenAIHealthResponse:
    """Return configuration readiness for Gemini + RAG diagnostic report generation."""
    return gemini_service.health_status(db)


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
        .options(
            joinedload(ClinicalAssessment.patient),
            joinedload(ClinicalAssessment.attachments),
        )
        .order_by(ClinicalAssessment.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    if patient_id is not None:
        stmt = stmt.where(ClinicalAssessment.patient_id == patient_id)
    return list(db.scalars(stmt).unique().all())


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
    summary="Generate and persist a 9-section RAG-grounded Gemini diagnostic report",
)
def generate_assessment_report(
    assessment_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> DiagnosticReportResponse | JSONResponse:
    """Analyze a saved clinical assessment via RAG + Gemini and persist the report."""
    assessment = _get_assessment_or_404(db, assessment_id)

    try:
        return clinical_response_service.generate_and_persist_report(db, assessment)
    except AssessmentReportEmergencyFallbackError as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "detail": str(exc),
                "generated_by_gemini": False,
                "emergency_alert": exc.emergency_alert,
            },
        )
    except GeminiRateLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(exc),
        ) from exc
    except GeminiServiceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except ClinicalSafetyValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc


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
    record = clinical_response_service.get_latest_report(db, assessment_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No diagnostic report has been generated for this assessment yet.",
        )
    return clinical_response_service.to_response(record)


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
    record = clinical_response_service.get_latest_report(db, assessment_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No diagnostic report has been generated for this assessment yet.",
        )

    return clinical_response_service.review_report(
        db,
        assessment,
        record,
        clinician_reviewed=payload.clinician_reviewed,
        clinician_notes=payload.clinician_notes,
    )


@router.post(
    "/{assessment_id}/documents",
    response_model=list[AssessmentAttachmentResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Upload and extract clinical documents (PDF, TXT, MD, CSV, JSON)",
)
async def upload_assessment_documents(
    assessment_id: uuid.UUID,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
) -> list[AssessmentAttachment]:
    """Validate, persist, and extract text from uploaded patient clinical documents."""
    assessment = _get_assessment_or_404(db, assessment_id)
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one clinical document file is required.",
        )

    created: list[AssessmentAttachment] = []
    report_names = list(assessment.attached_report_names or [])

    for upload in files:
        file_bytes = await upload.read()
        try:
            processed = extract_and_store_clinical_document(
                assessment_id=assessment.id,
                file_bytes=file_bytes,
                file_name=upload.filename or "document.txt",
                mime_type=upload.content_type,
            )
        except DocumentProcessingError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        record = AssessmentAttachment(
            assessment_id=assessment.id,
            kind="document",
            original_filename=processed.original_filename,
            mime_type=processed.mime_type,
            size_bytes=processed.size_bytes,
            storage_path=processed.storage_path,
            modality="clinical_document",
            extraction_status=processed.extraction_status,
            extracted_text=processed.extracted_text,
            extraction_note=processed.extraction_note,
            exif_stripped=False,
        )
        db.add(record)
        created.append(record)
        if processed.original_filename not in report_names:
            report_names.append(processed.original_filename)

    assessment.attached_report_names = report_names
    db.commit()
    for item in created:
        db.refresh(item)
    return created


@router.post(
    "/{assessment_id}/images",
    response_model=list[AssessmentAttachmentResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Upload supported medical images (PNG/JPEG X-ray) with EXIF stripping",
)
async def upload_assessment_images(
    assessment_id: uuid.UUID,
    files: list[UploadFile] = File(...),
    modality: str = Form(default="chest_xray"),
    db: Session = Depends(get_db),
) -> list[AssessmentAttachment]:
    """Validate, strip EXIF metadata, and store supported medical image files."""
    assessment = _get_assessment_or_404(db, assessment_id)
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one medical image file is required.",
        )

    created: list[AssessmentAttachment] = []
    existing_images = list(assessment.attached_images or [])

    for upload in files:
        file_bytes = await upload.read()
        try:
            processed = validate_and_store_medical_image(
                assessment_id=assessment.id,
                file_bytes=file_bytes,
                file_name=upload.filename or "medical_image.png",
                modality=modality,
            )
        except ImageProcessingError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        record = AssessmentAttachment(
            assessment_id=assessment.id,
            kind="image",
            original_filename=processed.original_filename,
            mime_type=processed.mime_type,
            size_bytes=processed.size_bytes,
            storage_path=processed.storage_path,
            modality=processed.modality,
            extraction_status="stored_for_vision",
            extracted_text=None,
            extraction_note=None,
            exif_stripped=processed.exif_stripped,
        )
        db.add(record)
        created.append(record)
        existing_images.append(
            {
                "name": processed.original_filename,
                "size_label": f"{max(1, round(processed.size_bytes / 1024))} KB",
                "type": processed.mime_type,
            }
        )

    assessment.attached_images = existing_images
    db.commit()
    for item in created:
        db.refresh(item)
    return created


@router.get(
    "/{assessment_id}/attachments/{attachment_id}/content",
    summary="Retrieve stored medical image bytes for clinician inspection",
)
def get_assessment_image_content(
    assessment_id: uuid.UUID,
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> Response:
    """Serve sanitized stored image bytes for an assessment attachment."""
    _get_assessment_or_404(db, assessment_id)
    stmt = select(AssessmentAttachment).where(
        AssessmentAttachment.id == attachment_id,
        AssessmentAttachment.assessment_id == assessment_id,
    )
    attachment = db.scalar(stmt)
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment not found for this clinical assessment.",
        )
    if attachment.kind != "image":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Binary preview is only available for medical image attachments.",
        )
    raw = load_sanitized_image_bytes(attachment.storage_path)
    if raw is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Stored medical image bytes could not be located on disk.",
        )
    return Response(content=raw, media_type=attachment.mime_type)
