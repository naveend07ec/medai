import type { ClinicalAssessmentRecord } from '../types/assessment'

interface AssessmentHistoryViewProps {
  assessments: ClinicalAssessmentRecord[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onViewAssessmentResult: (assessmentId: string) => void
  onStartNewAssessment: () => void
}

export function AssessmentHistoryView({
  assessments,
  loading,
  error,
  onRefresh,
  onViewAssessmentResult,
  onStartNewAssessment,
}: AssessmentHistoryViewProps) {
  return (
    <div className="records-container">
      <div className="section-page-header">
        <div>
          <h2>Assessment History</h2>
          <p>
            Review persisted clinical assessments, predictive model outputs, and
            clinician review statuses.
          </p>
        </div>
        <div className="header-actions-inline">
          <button
            type="button"
            className="btn-secondary"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onStartNewAssessment}
          >
            + New Patient Assessment
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <strong>Database Unavailable:</strong> {error}
        </div>
      )}

      {loading && assessments.length === 0 ? (
        <section className="panel empty-page-panel">
          <p>Loading assessment history from backend…</p>
        </section>
      ) : assessments.length === 0 ? (
        <section className="panel empty-page-panel">
          <h3>No Persisted Assessments Found</h3>
          <p>
            Completed patient intake workflows and their diagnostic result reports will
            appear here for clinician review.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={onStartNewAssessment}
          >
            Start New Patient Assessment
          </button>
        </section>
      ) : (
        <section className="panel table-panel">
          <table className="clinical-table">
            <thead>
              <tr>
                <th>Assessment ID</th>
                <th>Patient</th>
                <th>Modalities Provided</th>
                <th>Predictive Experiment</th>
                <th>Clinician Review</th>
                <th>Recorded</th>
                <th>Report</th>
              </tr>
            </thead>
            <tbody>
              {assessments.map((item) => {
                const predictive = item.predictive_experiment_result
                const modalities =
                  item.preprocessing_summary?.providedModalities?.join(', ') ||
                  'Recorded intake'
                return (
                  <tr key={item.id}>
                    <td>
                      <code>{item.id.slice(0, 8)}</code>
                    </td>
                    <td>
                      <strong>{item.patient?.full_name ?? 'Unknown'}</strong>
                      <div className="record-subtext">
                        {item.patient?.patient_code ?? item.patient_id}
                      </div>
                    </td>
                    <td>{modalities}</td>
                    <td>
                      {predictive?.status === 'completed' && predictive.result
                        ? `Class ${predictive.result.predicted_class} (${(predictive.result.class_1_probability * 100).toFixed(1)}%)`
                        : predictive?.status === 'not-requested' || !predictive
                          ? 'Not run'
                          : 'Unavailable'}
                    </td>
                    <td>
                      <span
                        className={
                          item.clinician_reviewed
                            ? 'status-pill status-ready'
                            : 'status-pill status-warn'
                        }
                      >
                        {item.clinician_reviewed ? 'Reviewed' : 'Pending Review'}
                      </span>
                    </td>
                    <td>{new Date(item.created_at).toLocaleString()}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-primary btn-xs"
                        onClick={() => onViewAssessmentResult(item.id)}
                      >
                        View Results
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
