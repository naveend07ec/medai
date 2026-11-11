import { useEffect, useState } from 'react'
import {
  fetchAssessmentReport,
  fetchGenAIHealth,
  generateAssessmentReport,
  reviewAssessmentReport,
  updateAssessmentReview,
} from '../api/clinical'
import type {
  ClinicalAssessmentRecord,
  DiagnosticReportRecord,
  GenAIHealthStatus,
} from '../types/assessment'
import { computeAgeYears } from '../utils/assessmentValidation'

interface AssessmentResultsViewProps {
  assessment: ClinicalAssessmentRecord
  justSavedBanner?: string | null
  onAssessmentUpdated: (updated: ClinicalAssessmentRecord) => void
  onStartAnother: () => void
  onBackToDashboard: () => void
}

function formatPercent(probability: number): string {
  return `${(probability * 100).toFixed(2)}%`
}

export function AssessmentResultsView({
  assessment,
  justSavedBanner,
  onAssessmentUpdated,
  onStartAnother,
  onBackToDashboard,
}: AssessmentResultsViewProps) {
  const [updatingReview, setUpdatingReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const [genaiHealth, setGenaiHealth] = useState<GenAIHealthStatus | null>(null)
  const [report, setReport] = useState<DiagnosticReportRecord | null>(null)
  const [loadingReport, setLoadingReport] = useState(true)
  const [generatingReport, setGeneratingReport] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [clinicianNotesDraft, setClinicianNotesDraft] = useState('')
  const [savingReportReview, setSavingReportReview] = useState(false)

  const patient = assessment.patient
  const ageYears = patient ? computeAgeYears(patient.date_of_birth) : null
  const preprocessing = assessment.preprocessing_summary
  const predictiveOutcome = assessment.predictive_experiment_result

  useEffect(() => {
    let active = true

    Promise.all([
      fetchGenAIHealth().catch(() => null),
      fetchAssessmentReport(assessment.id),
    ])
      .then(([healthStatus, existingReport]) => {
        if (!active) return
        setGenaiHealth(healthStatus)
        setReport(existingReport)
        setClinicianNotesDraft(existingReport?.clinician_notes ?? '')
        setReportError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        setReportError(
          err instanceof Error
            ? err.message
            : 'Unable to check existing diagnostic report.',
        )
      })
      .finally(() => {
        if (active) {
          setLoadingReport(false)
        }
      })

    return () => {
      active = false
    }
  }, [assessment.id])

  async function handleToggleAssessmentReview() {
    setUpdatingReview(true)
    setReviewError(null)
    try {
      const updated = await updateAssessmentReview(
        assessment.id,
        !assessment.clinician_reviewed,
      )
      onAssessmentUpdated(updated)
    } catch (err: unknown) {
      setReviewError(
        err instanceof Error
          ? err.message
          : 'Unable to update clinician review status.',
      )
    } finally {
      setUpdatingReview(false)
    }
  }

  async function handleGenerateReport() {
    setGeneratingReport(true)
    setReportError(null)
    try {
      const generated = await generateAssessmentReport(assessment.id)
      setReport(generated)
      setClinicianNotesDraft(generated.clinician_notes ?? '')
      if (assessment.clinician_reviewed) {
        onAssessmentUpdated({ ...assessment, clinician_reviewed: false })
      }
    } catch (err: unknown) {
      setReportError(
        err instanceof Error
          ? err.message
          : 'Unable to generate AI diagnostic report.',
      )
      fetchGenAIHealth()
        .then(setGenaiHealth)
        .catch(() => null)
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
        clinicianNotesDraft,
      )
      setReport(updatedReport)
      onAssessmentUpdated({
        ...assessment,
        clinician_reviewed: updatedReport.clinician_reviewed,
      })
    } catch (err: unknown) {
      setReviewError(
        err instanceof Error
          ? err.message
          : 'Unable to save clinician review on the report.',
      )
    } finally {
      setSavingReportReview(false)
    }
  }

  return (
    <div className="results-workspace">
      {justSavedBanner && (
        <div className="alert alert-success" role="status">
          <strong>Saved:</strong> {justSavedBanner}
        </div>
      )}

      {reviewError && (
        <div className="alert alert-error" role="alert">
          <strong>Review update failed:</strong> {reviewError}
        </div>
      )}

      <div className="results-topbar">
        <div>
          <span className="hero-eyebrow">
            Persisted Assessment Report • Clinician Review Required
          </span>
          <h2>Diagnostic Insights &amp; Treatment Support</h2>
          <p className="results-subtitle">
            Patient: <strong>{patient?.full_name ?? 'Unknown Patient'}</strong> (Code:{' '}
            <code>{patient?.patient_code ?? assessment.patient_id}</code>) •
            Recorded {new Date(assessment.created_at).toLocaleString()}
          </p>
        </div>

        <div className="results-top-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={handleGenerateReport}
            disabled={generatingReport}
          >
            {generatingReport
              ? 'Generating AI Report…'
              : report
                ? 'Regenerate AI Assessment Report'
                : 'Generate AI Assessment Report'}
          </button>
          <button
            type="button"
            className={
              assessment.clinician_reviewed ? 'btn-reviewed' : 'btn-secondary'
            }
            onClick={handleToggleAssessmentReview}
            disabled={updatingReview}
          >
            {updatingReview
              ? 'Updating…'
              : assessment.clinician_reviewed
                ? '✓ Assessment Reviewed'
                : 'Mark Assessment Reviewed'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onStartAnother}
          >
            New Assessment
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onBackToDashboard}
          >
            Dashboard
          </button>
        </div>
      </div>

      {/* GenAI Diagnostic Report Section (Primary Outcome) */}
      <section className="panel genai-report-panel" aria-labelledby="genai-report-heading">
        <div className="card-header-row">
          <div>
            <h3 id="genai-report-heading">
              GenAI Clinical Assessment Report (Structured 8-Section Output)
            </h3>
            <p className="record-subtext">
              {genaiHealth
                ? `Provider: ${genaiHealth.provider} (${genaiHealth.model_name}) • Medical RAG: ${
                    genaiHealth.rag_connected ? 'Connected' : 'Not Connected'
                  }`
                : 'Checking GenAI service configuration…'}
            </p>
          </div>
          <div className="status-controls">
            {genaiHealth?.status === 'ready' ? (
              <span className="status-pill status-ready">GenAI Ready</span>
            ) : (
              <span className="status-pill status-warn">GenAI Unavailable</span>
            )}
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={handleGenerateReport}
              disabled={generatingReport}
            >
              {generatingReport
                ? 'Analyzing…'
                : report
                  ? 'Regenerate Report'
                  : 'Generate AI Assessment Report'}
            </button>
          </div>
        </div>

        {reportError && (
          <div className="alert alert-error" role="alert">
            <strong>GenAI Report Service Unavailable:</strong> {reportError}
          </div>
        )}

        {generatingReport && (
          <div className="info-banner" role="status">
            Analyzing de-identified clinical assessment findings with the configured
            GenAI provider and persisting the structured report…
          </div>
        )}

        {loadingReport ? (
          <div className="empty-card-state">
            <p>Checking for persisted diagnostic report…</p>
          </div>
        ) : !report ? (
          <div className="unavailable-box" role="status">
            <strong>No GenAI Diagnostic Report Generated Yet</strong>
            <p>
              {genaiHealth?.status === 'ready'
                ? 'Click "Generate AI Assessment Report" above to analyze this saved assessment and persist a structured 8-section clinician-reviewable report.'
                : genaiHealth?.detail ??
                  'Configure GENAI_API_KEY in backend/.env to enable AI diagnostic report generation. No fake or fallback AI narrative is generated when credentials are unavailable.'}
            </p>
          </div>
        ) : (
          <div className="report-sections-stack">
            <div className="report-meta-strip">
              <span>
                Generated by <strong>{report.provider}</strong> ({report.model_name})
              </span>
              <span>
                Created: {new Date(report.created_at).toLocaleString()}
              </span>
              <span
                className={
                  report.clinician_reviewed
                    ? 'status-pill status-ready'
                    : 'status-pill status-warn'
                }
              >
                {report.clinician_reviewed
                  ? `Reviewed${report.reviewed_at ? ` (${new Date(report.reviewed_at).toLocaleString()})` : ''}`
                  : 'Pending Clinician Review'}
              </span>
            </div>

            <div className="report-grid-two">
              <div className="report-section-card">
                <h4>1. Patient Clinical Summary</h4>
                <p>{report.report.patient_clinical_summary}</p>
              </div>

              <div className="report-section-card">
                <h4>2. Available Clinical Findings (Observed Data)</h4>
                <ul className="clean-list">
                  {report.report.available_clinical_findings.map((finding) => (
                    <li key={finding}>{finding}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="report-section-card report-ai-card">
              <div className="card-header-row">
                <h4>3. AI-Generated Diagnostic Insights</h4>
                <span className="pill-separate">AI Interpretation (Non-Diagnostic)</span>
              </div>
              <p>{report.report.ai_generated_diagnostic_insights}</p>
            </div>

            <div className="report-section-card">
              <h4>4. Possible Diagnostic Considerations &amp; Supporting Evidence</h4>
              {report.report.possible_diagnostic_considerations.length === 0 ? (
                <p className="muted-text">
                  No specific diagnostic considerations returned for the available data.
                </p>
              ) : (
                <div className="considerations-grid">
                  {report.report.possible_diagnostic_considerations.map((item) => (
                    <div key={item.condition_or_pattern} className="consideration-item">
                      <strong>{item.condition_or_pattern}</strong>
                      <p>{item.rationale}</p>
                      {item.supporting_observed_evidence.length > 0 && (
                        <div className="consideration-meta">
                          <span>Observed Evidence:</span>{' '}
                          {item.supporting_observed_evidence.join('; ')}
                        </div>
                      )}
                      <div className="consideration-uncertainty">
                        <span>Uncertainty:</span> {item.uncertainty_note}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="report-grid-two">
              <div className="report-section-card">
                <h4>5. Missing Information &amp; Uncertainty</h4>
                <ul className="clean-list">
                  {report.report.missing_information_and_uncertainty.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="report-section-card">
                <h4>6. Further Clinical Evaluation Considerations</h4>
                <ul className="clean-list">
                  {report.report.further_clinical_evaluation_considerations.map(
                    (item) => (
                      <li key={item}>{item}</li>
                    ),
                  )}
                </ul>
              </div>
            </div>

            <div className="report-section-card">
              <div className="card-header-row">
                <h4>7. Personalized Treatment-Support Information</h4>
                <span
                  className={
                    report.report.personalized_treatment_support
                      .grounded_in_verified_references
                      ? 'status-pill status-ready'
                      : 'pill-unavailable'
                  }
                >
                  {report.report.personalized_treatment_support
                    .grounded_in_verified_references
                    ? 'Grounded in Verified References'
                    : 'Withheld — RAG Not Connected'}
                </span>
              </div>
              <p>{report.report.personalized_treatment_support.status_note}</p>
              {report.report.personalized_treatment_support.retrieved_references
                .length > 0 && (
                <ul className="clean-list">
                  {report.report.personalized_treatment_support.retrieved_references.map(
                    (ref) => (
                      <li key={ref.title}>
                        <strong>{ref.title}</strong> ({ref.source} —{' '}
                        {ref.guideline_or_citation}): {ref.relevance_note}
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>

            <div className="report-section-card report-review-card">
              <h4>8. Clinician Review &amp; Safety Disclaimer</h4>
              <p className="disclaimer-copy">
                {report.report.clinician_review_and_safety_disclaimer}
              </p>
              <p className="research-note-copy">
                <strong>Predictive &amp; Research Separation:</strong>{' '}
                {report.report.predictive_model_separation_note.summary}{' '}
                {report.report.research_context_note}
              </p>

              <div className="clinician-review-form">
                <label htmlFor="clinician-report-notes" className="field-label">
                  <span>Clinician Review Notes</span>
                </label>
                <textarea
                  id="clinician-report-notes"
                  rows={2}
                  placeholder="Enter clinical verification notes, follow-up plan, or corrections..."
                  value={clinicianNotesDraft}
                  onChange={(e) => setClinicianNotesDraft(e.target.value)}
                />
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => handleSaveReportReview(true)}
                    disabled={savingReportReview}
                  >
                    {savingReportReview
                      ? 'Saving Review…'
                      : 'Approve & Mark Report Reviewed'}
                  </button>
                  {report.clinician_reviewed && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => handleSaveReportReview(false)}
                      disabled={savingReportReview}
                    >
                      Reopen as Pending Review
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="results-two-column">
        <section className="panel" aria-labelledby="patient-summary-heading">
          <h3 id="patient-summary-heading">Recorded Assessment Summary</h3>
          <dl className="summary-kv-list">
            <div>
              <dt>Patient Code</dt>
              <dd>{patient?.patient_code ?? '—'}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{patient?.full_name ?? '—'}</dd>
            </div>
            <div>
              <dt>DOB / Age / Sex</dt>
              <dd>
                {patient?.date_of_birth ?? '—'}
                {ageYears !== null ? ` (${ageYears} yrs)` : ''} •{' '}
                {patient?.sex ?? 'Not specified'}
              </dd>
            </div>
            <div>
              <dt>Data Modalities Provided</dt>
              <dd>
                {preprocessing?.providedModalities?.join(', ') ||
                  'Recorded clinical assessment'}
              </dd>
            </div>
          </dl>

          <div className="subsection-block">
            <h4>Preprocessing &amp; Privacy Pipeline</h4>
            <ul className="clean-list">
              {preprocessing ? (
                <>
                  <li>
                    Validated {preprocessing.validatedMeasurementsCount} structured
                    vital-sign field(s); missing modalities (
                    {preprocessing.missingModalities.join(', ') || 'none'}) were not
                    fabricated.
                  </li>
                  {preprocessing.unusualMeasurementWarnings &&
                    preprocessing.unusualMeasurementWarnings.length > 0 && (
                      <li>
                        <strong>Unusual measurement warnings:</strong>{' '}
                        {preprocessing.unusualMeasurementWarnings.join(' | ')}
                      </li>
                    )}
                  {preprocessing.imputationAppliedNote && (
                    <li>{preprocessing.imputationAppliedNote}</li>
                  )}
                </>
              ) : (
                <li>Structured assessment persisted in PostgreSQL.</li>
              )}
              <li>
                Patient demographic identity (<code>patients</code>) is stored
                separately from clinical observations (<code>clinical_assessments</code>).
              </li>
            </ul>
          </div>
        </section>

        <section className="panel" aria-labelledby="predictive-results-heading">
          <div className="card-header-row">
            <h3 id="predictive-results-heading">
              Separate Disease-Specific Predictive Experiment
            </h3>
            <span className="pill-separate">Pima XGBoost Statistical Model</span>
          </div>

          {predictiveOutcome?.status === 'completed' && predictiveOutcome.result ? (
            <div className="result-content">
              <div className="predicted-class-card">
                <span className="result-label">
                  {predictiveOutcome.result.module_name} (
                  {predictiveOutcome.result.model_name})
                </span>
                <strong className="result-class-value">
                  Predicted Class {predictiveOutcome.result.predicted_class}
                </strong>
                <span className="result-class-note">
                  Model version: {predictiveOutcome.result.model_version}
                </span>
              </div>

              <div className="prob-list">
                <div className="prob-item">
                  <div className="prob-header">
                    <span>Class 0 Model-Estimated Probability</span>
                    <strong>
                      {formatPercent(predictiveOutcome.result.class_0_probability)}
                    </strong>
                  </div>
                  <div className="prob-bar-track" aria-hidden="true">
                    <div
                      className="prob-bar-fill prob-bar-zero"
                      style={{
                        width: `${Math.min(100, Math.max(0, predictiveOutcome.result.class_0_probability * 100))}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="prob-item">
                  <div className="prob-header">
                    <span>Class 1 Model-Estimated Probability</span>
                    <strong>
                      {formatPercent(predictiveOutcome.result.class_1_probability)}
                    </strong>
                  </div>
                  <div className="prob-bar-track" aria-hidden="true">
                    <div
                      className="prob-bar-fill prob-bar-one"
                      style={{
                        width: `${Math.min(100, Math.max(0, predictiveOutcome.result.class_1_probability * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="api-disclaimer">
                <strong>Model Disclaimer:</strong>{' '}
                {predictiveOutcome.result.clinical_disclaimer}
              </div>
            </div>
          ) : (
            <div className="unavailable-box" role="status">
              <strong>
                {predictiveOutcome?.status === 'not-requested' || !predictiveOutcome
                  ? 'Disease-Specific Predictive Experiment Not Run'
                  : 'Predictive Model Analysis Unavailable'}
              </strong>
              <p>
                {predictiveOutcome?.message ??
                  'No predictive experiment was executed for this assessment.'}
              </p>
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="supporting-clinical-heading">
          <h3 id="supporting-clinical-heading">Supporting Clinical Inputs</h3>
          <div className="supporting-sections">
            <div>
              <h4>Symptoms &amp; Medical History</h4>
              <p>
                {[
                  assessment.current_symptoms &&
                    `Symptoms: ${assessment.current_symptoms}`,
                  assessment.symptom_duration &&
                    `Duration: ${assessment.symptom_duration}`,
                  assessment.previous_conditions &&
                    `Conditions: ${assessment.previous_conditions}`,
                  assessment.existing_medications &&
                    `Medications: ${assessment.existing_medications}`,
                  assessment.medical_history_notes,
                ]
                  .filter(Boolean)
                  .join(' • ') || 'No symptoms or history notes entered.'}
              </p>
            </div>

            <div>
              <h4>Clinical Measurements</h4>
              <p>
                {[
                  (assessment.systolic_bp !== null ||
                    assessment.diastolic_bp !== null) &&
                    `BP: ${assessment.systolic_bp ?? '—'}/${assessment.diastolic_bp ?? '—'} mm Hg`,
                  assessment.heart_rate !== null &&
                    `HR: ${assessment.heart_rate} bpm`,
                  assessment.body_temperature !== null &&
                    `Temp: ${assessment.body_temperature} °C`,
                  assessment.oxygen_saturation !== null &&
                    `SpO₂: ${assessment.oxygen_saturation}%`,
                  assessment.additional_measurements,
                ]
                  .filter(Boolean)
                  .join(' • ') || 'No general vital signs entered.'}
              </p>
            </div>

            <div>
              <h4>Medical Records, Images &amp; Genomic Context</h4>
              <p>
                {[
                  assessment.lab_results && `Labs: ${assessment.lab_results}`,
                  assessment.ehr_summary && `EHR: ${assessment.ehr_summary}`,
                  assessment.attached_report_names.length > 0 &&
                    `Attached report metadata (not extracted/analyzed): ${assessment.attached_report_names.join(', ')}`,
                  assessment.attached_images.length > 0 &&
                    `Attached images (unprocessed): ${assessment.attached_images.map((img) => img.name).join(', ')}`,
                  assessment.imaging_notes &&
                    `Imaging notes: ${assessment.imaging_notes}`,
                  assessment.family_history_markers &&
                    `Genetic context: ${assessment.family_history_markers}`,
                  assessment.genomic_notes &&
                    `Genomic notes (unprocessed): ${assessment.genomic_notes}`,
                ]
                  .filter(Boolean)
                  .join(' • ') || 'No records, images, or genomic notes attached.'}
              </p>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="governance-heading">
          <h3 id="governance-heading">Clinical Governance &amp; Platform Scope</h3>
          <div className="clinician-governance-box">
            <strong>Safety &amp; Scope Guardrails:</strong>
            <ul>
              <li>
                Observed clinical inputs are kept separate from AI-generated
                interpretations and disease-specific tabular probabilities.
              </li>
              <li>
                Automated medical image analysis, genomic interpretation, and Medical
                RAG guideline retrieval are not yet connected.
              </li>
              <li>
                Qualified clinicians remain solely responsible for reviewing and
                approving clinical decisions; autonomous prescribing is never
                performed.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  )
}
