import { useEffect, useState } from 'react'
import {
  fetchAssessmentReport,
  fetchGenAIHealth,
  generateAssessmentReport,
  reviewAssessmentReport,
} from '../api/clinical'
import { ApiRequestError } from '../api/client'
import type {
  ClinicalAssessmentRecord,
  DiagnosticReportRecord,
  EmergencyAlert,
  GenAIHealthStatus,
} from '../types/assessment'
import { computeAgeYears } from '../utils/assessmentValidation'
import { sanitizeClinicalAiText } from '../utils/aiTextSanitizer'
import { DiagnosticReportDisplay } from './DiagnosticReportDisplay'
import { EmergencyAlertBanner } from './EmergencyAlertBanner'

interface AssessmentResultsViewProps {
  assessment: ClinicalAssessmentRecord
  justSavedBanner?: string | null
  onAssessmentUpdated: (updated: ClinicalAssessmentRecord) => void
  onStartAnother: () => void
  onBackToDashboard: () => void
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function AssessmentResultsView({
  assessment,
  justSavedBanner,
  onAssessmentUpdated,
  onStartAnother,
  onBackToDashboard,
}: AssessmentResultsViewProps) {
  const [reviewError, setReviewError] = useState<string | null>(null)

  const [genaiHealth, setGenaiHealth] = useState<GenAIHealthStatus | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [report, setReport] = useState<DiagnosticReportRecord | null>(null)
  const [loadedAssessmentId, setLoadedAssessmentId] = useState<string | null>(null)
  const [generatingReport, setGeneratingReport] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [fallbackEmergencyAlert, setFallbackEmergencyAlert] =
    useState<EmergencyAlert | null>(null)
  const [clinicianNotesDraft, setClinicianNotesDraft] = useState('')
  const [savingReportReview, setSavingReportReview] = useState(false)

  const loadingReport = loadedAssessmentId !== assessment.id
  const patient = assessment.patient
  const ageYears = patient ? computeAgeYears(patient.date_of_birth) : null

  useEffect(() => {
    let active = true

    Promise.allSettled([
      fetchGenAIHealth(),
      fetchAssessmentReport(assessment.id),
    ]).then(([healthRes, reportRes]) => {
      if (!active) return

      if (healthRes.status === 'fulfilled') {
        setGenaiHealth(healthRes.value)
        setHealthError(null)
      } else {
        const msg =
          healthRes.reason instanceof Error
            ? healthRes.reason.message
            : 'Unable to check Clinical AI health status.'
        setGenaiHealth(null)
        setHealthError(msg)
      }

      if (reportRes.status === 'fulfilled') {
        setReport(reportRes.value)
        setClinicianNotesDraft(reportRes.value?.clinician_notes ?? '')
      } else {
        setReport(null)
      }
      setReportError(null)
      setFallbackEmergencyAlert(null)
      setLoadedAssessmentId(assessment.id)
    })

    return () => {
      active = false
    }
  }, [assessment.id])

  async function handleGenerateReport() {
    setGeneratingReport(true)
    setReportError(null)
    setFallbackEmergencyAlert(null)

    try {
      const generated = await generateAssessmentReport(assessment.id)
      setReport(generated)
      setClinicianNotesDraft(generated.clinician_notes ?? '')
    } catch (err) {
      if (err instanceof ApiRequestError && err.emergencyAlert) {
        setFallbackEmergencyAlert(err.emergencyAlert)
      }
      setReportError(
        err instanceof Error
          ? err.message
          : 'Unable to generate diagnostic output via Clinical AI.',
      )
    } finally {
      setGeneratingReport(false)
    }
  }

  async function handleSaveReportReview(nextReviewed: boolean) {
    setSavingReportReview(true)
    setReviewError(null)
    try {
      const updatedReport = await reviewAssessmentReport(
        assessment.id,
        nextReviewed,
        clinicianNotesDraft.trim() || undefined,
      )
      setReport(updatedReport)
      onAssessmentUpdated({
        ...assessment,
        clinician_reviewed: updatedReport.clinician_reviewed,
      })
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : 'Unable to save clinician review.',
      )
    } finally {
      setSavingReportReview(false)
    }
  }

  const displayName = patient?.full_name || 'Patient Record'
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div className="results-view">
      {/* Top Action & Breadcrumb Header */}
      <div className="results-topbar">
        <div className="results-topbar-left">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={onBackToDashboard}
          >
            ← Patient Records
          </button>
          <span className="topbar-divider" aria-hidden="true" />
          <span className="topbar-crumb">
            Assessment ID: <code>{assessment.id.slice(0, 8)}</code> · Recorded{' '}
            {formatDateTime(assessment.created_at)}
          </span>
        </div>

        <div className="results-topbar-right">
          <span
            className={`status-pill ${
              assessment.clinician_reviewed ? 'pill-ready' : 'pill-warn'
            }`}
          >
            {assessment.clinician_reviewed ? 'Reviewed' : 'Pending Review'}
          </span>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={onStartAnother}
          >
            + New Analysis
          </button>
        </div>
      </div>

      {justSavedBanner && (
        <div className="alert alert-info" role="status">
          {justSavedBanner}
        </div>
      )}

      {fallbackEmergencyAlert?.emergency_detected && (
        <EmergencyAlertBanner
          alert={fallbackEmergencyAlert}
          generatedByGemini={false}
          notice="Emergency red-flag screening operated independently without calling the Clinical AI engine. Because AI report generation could not complete, no AI report was persisted."
        />
      )}

      {/* Digcy-Inspired Clinical Profile & Vitals Snapshot */}
      <section className="clinical-snapshot-grid" aria-label="Patient clinical overview">
        <div className="panel clinical-patient-card">
          <div className="clinical-profile-head">
            <div className="patient-monogram patient-monogram-lg" aria-hidden="true">
              {initials || 'PT'}
            </div>
            <div>
              <span className="section-kicker">Patient Clinical Summary</span>
              <h2>{displayName}</h2>
              <p className="clinical-profile-meta">
                {patient ? (
                  <>
                    Code <code>{patient.patient_code}</code> ·{' '}
                    {ageYears !== null ? `${ageYears} yrs · ` : ''}
                    {patient.sex || 'Sex N/A'} · DOB {patient.date_of_birth}
                  </>
                ) : (
                  `Patient ID: ${assessment.patient_id}`
                )}
              </p>
            </div>
          </div>

          {/* Recorded Vitals Strip (real data only, never invented) */}
          <div className="vitals-grid-strip" aria-label="Recorded vital measurements">
            <div className="vital-metric-card">
              <span className="vital-metric-label">Blood Pressure</span>
              <strong className="vital-metric-value">
                {assessment.systolic_bp != null || assessment.diastolic_bp != null
                  ? `${assessment.systolic_bp ?? '—'}/${assessment.diastolic_bp ?? '—'}`
                  : 'Not recorded'}
              </strong>
              <span className="vital-metric-unit">mm Hg</span>
            </div>

            <div className="vital-metric-card">
              <span className="vital-metric-label">Heart Rate</span>
              <strong className="vital-metric-value">
                {assessment.heart_rate != null ? assessment.heart_rate : 'Not recorded'}
              </strong>
              <span className="vital-metric-unit">bpm</span>
            </div>

            <div className="vital-metric-card">
              <span className="vital-metric-label">Temperature</span>
              <strong className="vital-metric-value">
                {assessment.body_temperature != null
                  ? assessment.body_temperature
                  : 'Not recorded'}
              </strong>
              <span className="vital-metric-unit">°C</span>
            </div>

            <div className="vital-metric-card">
              <span className="vital-metric-label">SpO₂</span>
              <strong className="vital-metric-value">
                {assessment.oxygen_saturation != null
                  ? `${assessment.oxygen_saturation}%`
                  : 'Not recorded'}
              </strong>
              <span className="vital-metric-unit">Oxygen saturation</span>
            </div>
          </div>

          <div className="recorded-context-grid">
            <div className="recorded-context-item">
              <span>Presenting Symptoms</span>
              <p>{assessment.current_symptoms || 'None entered'}</p>
              {assessment.symptom_duration && (
                <small>Duration: {assessment.symptom_duration}</small>
              )}
            </div>
            <div className="recorded-context-item">
              <span>History &amp; Medications</span>
              <p>{assessment.previous_conditions || 'No prior history entered'}</p>
              {assessment.existing_medications && (
                <small>Medications: {assessment.existing_medications}</small>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Centerpiece: Clinical AI + RAG Diagnostic Output */}
      <section
        className="panel diagnostic-centerpiece-panel"
        aria-labelledby="diagnostic-output-heading"
      >
        <div className="diagnostic-header-bar">
          <div>
            <span className="section-kicker">Diagnostic Support</span>
            <h2 id="diagnostic-output-heading">Diagnostic Output</h2>
            <p className="diagnostic-header-sub">
              Clear explanations grounded in verified medical references and reviewed by a
              clinician.
            </p>
          </div>

          <div className="diagnostic-controls">
            {genaiHealth ? (
              <span
                className={`status-pill ${
                  genaiHealth.status === 'ready' ? 'pill-ready' : 'pill-warn'
                }`}
              >
                {genaiHealth.status === 'ready'
                  ? 'Clinical AI Ready'
                  : 'Clinical AI Unavailable'}
              </span>
            ) : healthError ? (
              <span className="status-pill pill-warn">Status Unknown</span>
            ) : null}

            <button
              type="button"
              className="btn-primary"
              disabled={generatingReport}
              onClick={handleGenerateReport}
            >
              {generatingReport
                ? 'Generating Diagnostic Output…'
                : report
                  ? 'Regenerate Diagnostic Output'
                  : 'Generate Diagnostic Output'}
            </button>
          </div>
        </div>

        {genaiHealth?.detail && (
          <div
            className={`alert ${genaiHealth.status === 'ready' ? 'alert-info' : 'alert-warn'}`}
            role="status"
          >
            {sanitizeClinicalAiText(genaiHealth.detail)}
          </div>
        )}

        {healthError && !genaiHealth && (
          <div className="alert alert-warn" role="status">
            {sanitizeClinicalAiText(healthError)}
          </div>
        )}

        {reportError && (
          <div className="alert alert-error" role="alert">
            <strong>Diagnostic Generation Error:</strong>{' '}
            {sanitizeClinicalAiText(reportError)}
          </div>
        )}

        {generatingReport && (
          <div className="generating-status-box" role="status">
            <div className="upload-progress-bar">
              <div className="upload-progress-indeterminate" />
            </div>
            <p>
              Running safety screening, retrieving verified medical references, and
              preparing diagnostic output…
            </p>
          </div>
        )}

        {loadingReport ? (
          <p className="empty-state">Checking for an existing diagnostic report…</p>
        ) : !report ? (
          <div className="empty-state-box">
            <p>
              {genaiHealth?.status === 'ready'
                ? 'Click "Generate Diagnostic Output" above to analyze this patient assessment and create a diagnostic report.'
                : 'Configure the AI service credentials in backend/.env to enable diagnostic report generation.'}
            </p>
          </div>
        ) : (
          <div className="report-body-wrapper">
            <DiagnosticReportDisplay report={report.report} />

            {/* 08. Clinician Review & Sign-Off */}
            <section
              className="report-editorial-block report-review-block"
              aria-labelledby="rep-clinician-review-heading"
            >
              <div className="report-block-header">
                <span className="report-section-num">08</span>
                <div className="report-block-title-row">
                  <div>
                    <h4 id="rep-clinician-review-heading">
                      Clinician Review &amp; Approval
                    </h4>
                    <p className="report-block-subtitle">
                      Verify diagnostic considerations and sign off before clinical use.
                    </p>
                  </div>
                  <span
                    className={`status-pill ${
                      report.clinician_reviewed ? 'pill-ready' : 'pill-warn'
                    }`}
                  >
                    {report.clinician_reviewed ? 'Report Reviewed' : 'Awaiting Sign-Off'}
                  </span>
                </div>
              </div>

              <div className="clinician-review-form">
                <label htmlFor="clinician-report-notes" className="field-label">
                  <span>Clinician Review Notes</span>
                </label>
                <textarea
                  id="clinician-report-notes"
                  rows={3}
                  placeholder="Document clinical impression, verification against physical exam, or modifications to suggested considerations..."
                  value={clinicianNotesDraft}
                  onChange={(e) => setClinicianNotesDraft(e.target.value)}
                />

                {reviewError && (
                  <div className="alert alert-error" role="alert">
                    {reviewError}
                  </div>
                )}

                <div className="clinician-review-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={savingReportReview}
                    onClick={() => handleSaveReportReview(true)}
                  >
                    {savingReportReview
                      ? 'Saving Review…'
                      : 'Approve & Mark Report Reviewed'}
                  </button>

                  {report.clinician_reviewed && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={savingReportReview}
                      onClick={() => handleSaveReportReview(false)}
                    >
                      Mark Pending Review
                    </button>
                  )}

                  {report.reviewed_at && (
                    <span className="review-timestamp">
                      Signed off {formatDateTime(report.reviewed_at)}
                    </span>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  )
}
