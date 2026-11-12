from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.clinical_assessment import ClinicalAssessment
from app.models.diagnostic_report import DiagnosticReport
from app.schemas.report import (
    DiagnosticReportContent,
    DiagnosticReportResponse,
)
from app.services.generative_ai.gemini_service import GeminiServiceUnavailableError

if TYPE_CHECKING:
    from app.services.medical_rag.rag_service import RAGService


class AssessmentReportEmergencyFallbackError(GeminiServiceUnavailableError):
    """Raised when Gemini is unavailable on an assessment with active emergency flags."""

    def __init__(self, message: str, emergency_alert: dict) -> None:
        super().__init__(message)
        self.emergency_alert = emergency_alert


class ClinicalResponseService:
    """Builds, persists, retrieves, and records clinician reviews on 9-section reports."""

    def __init__(self, rag_svc: Optional["RAGService"] = None) -> None:
        self._rag_service = rag_svc

    def _get_rag_service(self) -> "RAGService":
        if self._rag_service is not None:
            return self._rag_service
        from app.services.medical_rag.rag_service import rag_service as default_rag_service

        return default_rag_service

    @staticmethod
    def to_response(record: DiagnosticReport) -> DiagnosticReportResponse:
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

    def generate_and_persist_report(
        self,
        db: Session,
        assessment: ClinicalAssessment,
    ) -> DiagnosticReportResponse:
        """Execute RAG + Gemini pipeline and persist the validated 9-section report."""
        pipeline_result = self._get_rag_service().run_assessment_rag(db, assessment)

        if not pipeline_result.generated_by_gemini or pipeline_result.report is None:
            raise AssessmentReportEmergencyFallbackError(
                pipeline_result.notice
                or "Emergency red-flag warning triggered; Gemini report service is unavailable.",
                emergency_alert=pipeline_result.emergency_alert.model_dump(),
            )

        record = DiagnosticReport(
            assessment_id=assessment.id,
            provider=pipeline_result.provider,
            model_name=pipeline_result.model_name,
            report_payload=pipeline_result.report.model_dump(mode="json"),
            clinician_reviewed=False,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return self.to_response(record)

    def get_latest_report(
        self,
        db: Session,
        assessment_id: uuid.UUID,
    ) -> Optional[DiagnosticReport]:
        stmt = (
            select(DiagnosticReport)
            .where(DiagnosticReport.assessment_id == assessment_id)
            .order_by(DiagnosticReport.created_at.desc())
            .limit(1)
        )
        return db.scalar(stmt)

    def review_report(
        self,
        db: Session,
        assessment: ClinicalAssessment,
        report: DiagnosticReport,
        *,
        clinician_reviewed: bool,
        clinician_notes: Optional[str] = None,
    ) -> DiagnosticReportResponse:
        cleaned_notes = clinician_notes.strip() if clinician_notes else None
        report.clinician_reviewed = clinician_reviewed
        report.clinician_notes = cleaned_notes or None
        report.reviewed_at = (
            datetime.now(timezone.utc) if clinician_reviewed else None
        )
        assessment.clinician_reviewed = clinician_reviewed

        db.commit()
        db.refresh(report)
        return self.to_response(report)


clinical_response_service = ClinicalResponseService()

