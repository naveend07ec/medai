import type {
  AppRoute,
  ClinicalAssessmentRecord,
  PatientRecord,
} from '../types/assessment'
import { computeAgeYears } from '../utils/assessmentValidation'

interface DashboardHomeProps {
  patients: PatientRecord[]
  assessments: ClinicalAssessmentRecord[]
  loadingRecords: boolean
  recordsError: string | null
  onRefreshRecords: () => void
  onNavigate: (route: AppRoute) => void
  onStartNewAssessment: (prefillPatient?: PatientRecord) => void
  onViewAssessmentResult: (assessmentId: string) => void
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function DashboardHome({
  patients,
  assessments,
  loadingRecords,
  recordsError,
  onRefreshRecords,
  onNavigate,
  onStartNewAssessment,
  onViewAssessmentResult,
}: DashboardHomeProps) {
  const latestAssessment = assessments[0] ?? null

  return (
    <div className="dashboard-home">
      <section className="hero-workflow-card" aria-labelledby="welcome-heading">
        <div className="hero-workflow-main">
          <span className="hero-eyebrow">Clinical Decision-Support Workspace</span>
          <h2 id="welcome-heading">
            Integrated Patient Assessment &amp; Diagnostic Support
          </h2>
          <p className="hero-summary">
            Enter available patient data across demographics, symptoms, vitals,
            medical records, images, and genomic context. The platform validates and
            preprocesses available inputs, persists records to PostgreSQL, invokes
            connected predictive models, and presents diagnostic insights and
            treatment-support information for clinician review.
          </p>

          <div className="workflow-strip" aria-label="Application workflow">
            <span>1. Healthcare Data Input</span>
            <span aria-hidden="true">→</span>
            <span>2. Data Analysis &amp; Preprocessing</span>
            <span aria-hidden="true">→</span>
            <span>3. GenAI-Based Diagnosis</span>
            <span aria-hidden="true">→</span>
            <span>4. Decision Support &amp; Privacy</span>
            <span aria-hidden="true">→</span>
            <span>5. Clinician-Reviewed Insights</span>
          </div>
        </div>

        <div className="hero-cta-box">
          <button
            type="button"
            className="btn-primary btn-lg"
            onClick={() => onStartNewAssessment()}
          >
            + New Patient Assessment
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onNavigate('research-info')}
          >
            View Research Information
          </button>
        </div>
      </section>

      {recordsError && (
        <div className="alert alert-error db-banner-row" role="alert">
          <div>
            <strong>Database Notice:</strong> {recordsError}
          </div>
          <button
            type="button"
            className="btn-secondary btn-xs"
            onClick={onRefreshRecords}
            disabled={loadingRecords}
          >
            {loadingRecords ? 'Retrying…' : 'Retry Connection'}
          </button>
        </div>
      )}

      <div className="clinical-summary-grid">
        <section className="panel" aria-labelledby="patient-records-card-heading">
          <div className="card-header-row">
            <h3 id="patient-records-card-heading">Patient Records</h3>
            <button
              type="button"
              className="btn-link"
              onClick={() => onNavigate('patient-records')}
            >
              View All ({patients.length})
            </button>
          </div>

          {loadingRecords && patients.length === 0 ? (
            <div className="empty-card-state">
              <p>Loading persisted patient records…</p>
            </div>
          ) : patients.length === 0 ? (
            <div className="empty-card-state">
              <p>
                No persisted patient records yet. Start a patient assessment to save a
                patient record in the database.
              </p>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => onStartNewAssessment()}
              >
                Start First Assessment
              </button>
            </div>
          ) : (
            <ul className="compact-record-list">
              {patients.slice(0, 4).map((patient) => {
                const age = computeAgeYears(patient.date_of_birth)
                return (
                  <li key={patient.id}>
                    <div>
                      <strong>{patient.full_name}</strong>
                      <span className="record-subtext">
                        Code: {patient.patient_code}
                        {age !== null ? ` • Age ${age}` : ''}
                        {patient.sex ? ` • ${patient.sex}` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => onStartNewAssessment(patient)}
                    >
                      New Assessment
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="previous-assessments-card-heading">
          <div className="card-header-row">
            <h3 id="previous-assessments-card-heading">Previous Assessments</h3>
            <button
              type="button"
              className="btn-link"
              onClick={() => onNavigate('assessment-history')}
            >
              History ({assessments.length})
            </button>
          </div>

          {loadingRecords && assessments.length === 0 ? (
            <div className="empty-card-state">
              <p>Loading persisted assessment history…</p>
            </div>
          ) : assessments.length === 0 ? (
            <div className="empty-card-state">
              <p>
                No completed assessments yet. Submitted clinical assessments and their
                analysis outcomes will appear here.
              </p>
            </div>
          ) : (
            <ul className="compact-record-list">
              {assessments.slice(0, 4).map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.patient?.full_name ?? 'Patient'}</strong>
                    <span className="record-subtext">
                      {formatDateTime(item.created_at)} •{' '}
                      {item.preprocessing_summary?.providedModalities?.length ?? 1}{' '}
                      modalities
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={() => onViewAssessmentResult(item.id)}
                  >
                    Results
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="recent-results-card-heading">
          <div className="card-header-row">
            <h3 id="recent-results-card-heading">Recent Assessment Results</h3>
            {latestAssessment && (
              <button
                type="button"
                className="btn-link"
                onClick={() => onViewAssessmentResult(latestAssessment.id)}
              >
                Open Report
              </button>
            )}
          </div>

          {!latestAssessment ? (
            <div className="empty-card-state">
              <p>
                Assessment results appear after completing a patient intake. Only
                connected model outputs are displayed; disconnected AI services are
                explicitly marked unavailable.
              </p>
            </div>
          ) : (
            <div className="recent-result-summary">
              <div className="recent-result-meta">
                <strong>
                  {latestAssessment.patient?.full_name ??
                    latestAssessment.patient_id}
                </strong>
                <span>{formatDateTime(latestAssessment.created_at)}</span>
              </div>

              <div className="recent-result-block">
                <span className="mini-label">Predictive Experiment (Diabetes XGBoost)</span>
                {latestAssessment.predictive_experiment_result?.status ===
                  'completed' &&
                latestAssessment.predictive_experiment_result.result ? (
                  <p>
                    Class{' '}
                    {
                      latestAssessment.predictive_experiment_result.result
                        .predicted_class
                    }{' '}
                    (Class 1 est.{' '}
                    {(
                      latestAssessment.predictive_experiment_result.result
                        .class_1_probability * 100
                    ).toFixed(1)}
                    %) — <em>Research estimate only</em>
                  </p>
                ) : (
                  <p className="muted-text">
                    {latestAssessment.predictive_experiment_result?.message ??
                      'Optional predictive experiment was not run.'}
                  </p>
                )}
              </div>

              <div className="recent-result-block">
                <span className="mini-label">
                  GenAI Diagnostic Insights &amp; Treatment Support
                </span>
                <p className="muted-text">
                  Generative AI synthesis and RAG treatment-support services are not yet
                  connected; clinician review required.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="panel overview-footer-panel" aria-labelledby="platform-overview-heading">
        <h3 id="platform-overview-heading">Platform Overview</h3>
        <p>
          <strong>Healthcare GenAI Platform</strong> (Project Code: <code>27CSPS028</code> —{' '}
          <em>Reimagining Healthcare with Generative AI: Personalized Diagnosis and Treatment</em>)
          connects structured clinical intake, data preprocessing, predictive modeling,
          generative AI research, and privacy-preserving decision support in one unified
          clinician-assisted workflow. Patient demographic records are kept architecturally
          separate from clinical observations and AI outputs, and clinicians retain full
          responsibility for diagnostic and treatment decisions.
        </p>
      </section>
    </div>
  )
}
