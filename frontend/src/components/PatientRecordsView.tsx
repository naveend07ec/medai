import type {
  ClinicalAssessmentRecord,
  PatientRecord,
} from '../types/assessment'
import { computeAgeYears } from '../utils/assessmentValidation'

interface PatientRecordsViewProps {
  patients: PatientRecord[]
  assessments: ClinicalAssessmentRecord[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onStartNewAssessment: (prefillPatient?: PatientRecord) => void
}

export function PatientRecordsView({
  patients,
  assessments,
  loading,
  error,
  onRefresh,
  onStartNewAssessment,
}: PatientRecordsViewProps) {
  function getAssessmentCount(patientId: string): number {
    return assessments.filter((a) => a.patient_id === patientId).length
  }

  return (
    <div className="records-container">
      <div className="section-page-header">
        <div>
          <h2>Patient Records</h2>
          <p>
            Persisted patient demographic records stored separately from clinical
            assessments and AI model outputs.
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
            onClick={() => onStartNewAssessment()}
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

      {loading && patients.length === 0 ? (
        <section className="panel empty-page-panel">
          <p>Loading patient records from backend…</p>
        </section>
      ) : patients.length === 0 ? (
        <section className="panel empty-page-panel">
          <h3>No Persisted Patient Records Found</h3>
          <p>
            Start a new patient assessment to register a patient identity record and
            linked clinical assessment.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onStartNewAssessment()}
          >
            Start New Patient Assessment
          </button>
        </section>
      ) : (
        <section className="panel table-panel">
          <table className="clinical-table">
            <thead>
              <tr>
                <th>Patient Code</th>
                <th>Name</th>
                <th>DOB (Age)</th>
                <th>Sex</th>
                <th>Assessments</th>
                <th>Registered</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((patient) => {
                const age = computeAgeYears(patient.date_of_birth)
                return (
                  <tr key={patient.id}>
                    <td>
                      <code>{patient.patient_code}</code>
                    </td>
                    <td>{patient.full_name}</td>
                    <td>
                      {patient.date_of_birth}
                      {age !== null ? ` (${age} yrs)` : ''}
                    </td>
                    <td>{patient.sex || '—'}</td>
                    <td>{getAssessmentCount(patient.id)}</td>
                    <td>{new Date(patient.created_at).toLocaleString()}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary btn-xs"
                        onClick={() => onStartNewAssessment(patient)}
                      >
                        New Assessment
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
