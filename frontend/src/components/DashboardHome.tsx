import { useState } from 'react'
import type {
  AppRoute,
  ClinicalAssessmentRecord,
  GenAIHealthStatus,
  PatientRecord,
} from '../types/assessment'
import { HumanAnatomyVisual } from './HumanAnatomyVisual'

interface DashboardHomeProps {
  patients: PatientRecord[]
  assessments: ClinicalAssessmentRecord[]
  loadingRecords: boolean
  recordsError: string | null
  genaiHealth?: GenAIHealthStatus | null
  genaiHealthError?: string | null
  onRefreshRecords: () => void
  onNavigate: (route: AppRoute) => void
  onStartNewAssessment: (
    prefillPatient?: PatientRecord,
    sourceAssessment?: ClinicalAssessmentRecord,
  ) => void
  onViewAssessmentResult: (assessmentId: string) => void
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

export function DashboardHome({
  patients,
  assessments,
  loadingRecords,
  recordsError,
  onRefreshRecords,
  onStartNewAssessment,
  onViewAssessmentResult,
}: DashboardHomeProps) {
  const [reviewFilter, setReviewFilter] = useState<'all' | 'pending' | 'reviewed'>('all')

  const pendingAssessments = assessments.filter((a) => !a.clinician_reviewed)
  const reviewedAssessments = assessments.filter((a) => a.clinician_reviewed)

  const filteredAssessments = assessments.filter((item) => {
    if (reviewFilter === 'pending') return !item.clinician_reviewed
    if (reviewFilter === 'reviewed') return item.clinician_reviewed
    return true
  })

  const scrollToPatientRecords = () => {
    const el = document.getElementById('previous-assessments-section')
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className="dashboard-home">
      {/* Minimal Editorial Hero */}
      <section className="hero-editorial-grid" aria-label="Platform overview">
        <div className="hero-copy-column">
          <h1 className="hero-display-title">
            Understanding Health.
            <br />
            Supporting Better Decisions.
          </h1>

          <p className="hero-lead-copy">
            Enter patient symptoms and vital measurements to generate plain-language
            diagnostic support backed by medical references and saved patient records.
          </p>

          <div className="hero-cta-row">
            <button
              type="button"
              className="btn-pill-dark"
              onClick={() => onStartNewAssessment()}
            >
              <span>Start Healthcare Analysis</span>
              <span className="btn-arrow-circle" aria-hidden="true">
                →
              </span>
            </button>

            <button
              type="button"
              className="btn-pill-soft"
              onClick={scrollToPatientRecords}
            >
              View Patient Records
            </button>
          </div>
        </div>

        <div className="hero-visual-column">
          <div className="hero-anatomy-frame">
            <HumanAnatomyVisual mode="hero" />
          </div>
        </div>
      </section>

      {/* Patient Records */}
      <section
        id="previous-assessments-section"
        className="assessments-overview-section"
        aria-labelledby="previous-assessments-heading"
      >
        <div className="overview-header-bar">
          <div>
            <h2 id="previous-assessments-heading">Patient Records</h2>
            <p className="overview-subcopy">
              Saved patient assessments and diagnostic reports.
            </p>
          </div>

          <div className="overview-header-actions">
            <div className="overview-counters" aria-label="Assessment status counts">
              <span className="counter-chip">
                <strong>{patients.length}</strong> Patients
              </span>
              <span className="counter-chip counter-chip-pending">
                <strong>{pendingAssessments.length}</strong> Pending
              </span>
              <span className="counter-chip counter-chip-reviewed">
                <strong>{reviewedAssessments.length}</strong> Reviewed
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={onRefreshRecords}
            >
              Refresh
            </button>
          </div>
        </div>

        <div
          className="overview-filter-bar"
          role="group"
          aria-label="Filter assessments by review status"
        >
          <button
            type="button"
            className={`filter-pill ${reviewFilter === 'all' ? 'filter-pill-active' : ''}`}
            onClick={() => setReviewFilter('all')}
          >
            All ({assessments.length})
          </button>
          <button
            type="button"
            className={`filter-pill ${reviewFilter === 'pending' ? 'filter-pill-active' : ''}`}
            onClick={() => setReviewFilter('pending')}
          >
            Pending Review ({pendingAssessments.length})
          </button>
          <button
            type="button"
            className={`filter-pill ${reviewFilter === 'reviewed' ? 'filter-pill-active' : ''}`}
            onClick={() => setReviewFilter('reviewed')}
          >
            Reviewed ({reviewedAssessments.length})
          </button>
        </div>

        {recordsError && (
          <div className="alert alert-error" role="alert">
            {recordsError}
          </div>
        )}

        {loadingRecords ? (
          <p className="empty-state">Loading patient records…</p>
        ) : filteredAssessments.length === 0 ? (
          <div className="empty-state-box">
            <p>
              {assessments.length === 0
                ? 'No patient records yet. Click "Start Healthcare Analysis" to create the first assessment.'
                : 'No records match this filter.'}
            </p>
            {assessments.length === 0 && (
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => onStartNewAssessment()}
              >
                Start First Analysis
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Symptoms / Notes</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssessments.map((item) => {
                  const patientObj =
                    item.patient ??
                    patients.find((p) => p.id === item.patient_id) ??
                    null
                  const summaryText =
                    item.current_symptoms ||
                    item.previous_conditions ||
                    'General clinical assessment'
                  const hasVitals =
                    item.systolic_bp != null ||
                    item.heart_rate != null ||
                    item.body_temperature != null ||
                    item.oxygen_saturation != null
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="patient-cell">
                          <strong>{patientObj?.full_name || 'Patient Record'}</strong>
                          {patientObj && (
                            <span className="patient-cell-meta">
                              {patientObj.patient_code} · {patientObj.sex || 'Sex N/A'} ·
                              DOB {patientObj.date_of_birth}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="summary-cell">
                        <span className="summary-clamp">{summaryText}</span>
                        {hasVitals && (
                          <span className="patient-cell-meta">
                            {[
                              item.systolic_bp != null || item.diastolic_bp != null
                                ? `BP ${item.systolic_bp ?? '—'}/${item.diastolic_bp ?? '—'}`
                                : null,
                              item.heart_rate != null ? `HR ${item.heart_rate}` : null,
                              item.body_temperature != null
                                ? `${item.body_temperature}°C`
                                : null,
                              item.oxygen_saturation != null
                                ? `SpO₂ ${item.oxygen_saturation}%`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="status-stack">
                          <span
                            className={`status-pill ${
                              item.clinician_reviewed ? 'pill-ready' : 'pill-warn'
                            }`}
                          >
                            {item.clinician_reviewed ? 'Reviewed' : 'Pending Review'}
                          </span>
                        </div>
                      </td>
                      <td className="tabular-cell">{formatDate(item.created_at)}</td>
                      <td>
                        <div className="record-actions">
                          <button
                            type="button"
                            className="btn-primary btn-xs"
                            onClick={() => onViewAssessmentResult(item.id)}
                          >
                            Open Report
                          </button>
                          {patientObj && (
                            <button
                              type="button"
                              className="btn-secondary btn-xs"
                              onClick={() => onStartNewAssessment(patientObj, item)}
                            >
                              Re-assess
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="disclaimer-footnote">
          Decision-support tool only. All AI outputs require clinician verification.
        </p>
      </section>
    </div>
  )
}
