import { useCallback, useEffect, useState } from 'react'
import { fetchAssessments, fetchPatients } from './api/clinical'
import { fetchDiabetesModelHealth } from './api/predictions'
import './App.css'
import { AssessmentHistoryView } from './components/AssessmentHistoryView'
import { AssessmentResultsView } from './components/AssessmentResultsView'
import { DashboardHome } from './components/DashboardHome'
import { PatientAssessmentWorkflow } from './components/PatientAssessmentWorkflow'
import { PatientRecordsView } from './components/PatientRecordsView'
import { ResearchInformationView } from './components/ResearchInformationView'
import type {
  AppRoute,
  ClinicalAssessmentRecord,
  PatientRecord,
} from './types/assessment'
import type {
  DiabetesPredictionResponse,
  PredictiveModelHealth,
} from './types/prediction'

const PRIMARY_NAV_ITEMS: Array<{
  id: AppRoute
  label: string
  secondary?: boolean
}> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'new-assessment', label: 'New Patient Assessment' },
  { id: 'patient-records', label: 'Patient Records' },
  { id: 'assessment-history', label: 'Assessment History' },
  { id: 'research-info', label: 'Research Information', secondary: true },
]

function App() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>('dashboard')
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [assessments, setAssessments] = useState<ClinicalAssessmentRecord[]>([])
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)

  const [activeAssessmentId, setActiveAssessmentId] = useState<string | null>(null)
  const [justSavedBanner, setJustSavedBanner] = useState<string | null>(null)
  const [prefillPatient, setPrefillPatient] = useState<PatientRecord | null>(null)

  const [health, setHealth] = useState<PredictiveModelHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [checkingHealth, setCheckingHealth] = useState(true)
  const [standalonePredictionResult, setStandalonePredictionResult] =
    useState<DiabetesPredictionResponse | null>(null)

  const loadClinicalRecords = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) {
      setLoadingRecords(true)
    }
    try {
      const [loadedPatients, loadedAssessments] = await Promise.all([
        fetchPatients(),
        fetchAssessments(),
      ])
      setPatients(loadedPatients)
      setAssessments(loadedAssessments)
      setRecordsError(null)
    } catch (err: unknown) {
      setRecordsError(
        err instanceof Error
          ? err.message
          : 'Unable to load patient and assessment records from the database.',
      )
    } finally {
      setLoadingRecords(false)
    }
  }, [])

  const applyHealthCheck = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) {
      setCheckingHealth(true)
    }
    try {
      const status = await fetchDiabetesModelHealth()
      setHealth(status)
      setHealthError(null)
      if (status.status !== 'ready') {
        setStandalonePredictionResult(null)
      }
    } catch (err: unknown) {
      setHealth(null)
      setStandalonePredictionResult(null)
      setHealthError(
        err instanceof Error
          ? err.message
          : 'Unable to reach predictive model health check.',
      )
    } finally {
      setCheckingHealth(false)
    }
  }, [])

  useEffect(() => {
    let active = true

    Promise.all([fetchPatients(), fetchAssessments()])
      .then(([loadedPatients, loadedAssessments]) => {
        if (!active) return
        setPatients(loadedPatients)
        setAssessments(loadedAssessments)
        setRecordsError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        setRecordsError(
          err instanceof Error
            ? err.message
            : 'Unable to load patient and assessment records from the database.',
        )
      })
      .finally(() => {
        if (active) {
          setLoadingRecords(false)
        }
      })

    fetchDiabetesModelHealth()
      .then((status) => {
        if (!active) return
        setHealth(status)
        setHealthError(null)
        if (status.status !== 'ready') {
          setStandalonePredictionResult(null)
        }
      })
      .catch((err: unknown) => {
        if (!active) return
        setHealth(null)
        setStandalonePredictionResult(null)
        setHealthError(
          err instanceof Error
            ? err.message
            : 'Unable to reach predictive model health check.',
        )
      })
      .finally(() => {
        if (active) {
          setCheckingHealth(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const handleRefreshHealth = useCallback(() => {
    void applyHealthCheck(true)
  }, [applyHealthCheck])

  const handleRefreshRecords = useCallback(() => {
    void loadClinicalRecords(true)
  }, [loadClinicalRecords])

  function handleStartNewAssessment(patient?: PatientRecord) {
    setPrefillPatient(patient ?? null)
    setActiveAssessmentId(null)
    setJustSavedBanner(null)
    setActiveRoute('new-assessment')
  }

  function handleAssessmentSaved(
    savedAssessment: ClinicalAssessmentRecord,
    createdPatient: PatientRecord | null,
  ) {
    if (createdPatient) {
      setPatients((prev) => [createdPatient, ...prev])
    }
    setAssessments((prev) => [savedAssessment, ...prev])
    setPrefillPatient(null)
    setActiveAssessmentId(savedAssessment.id)
    setJustSavedBanner(
      createdPatient
        ? `Registered patient ${createdPatient.full_name} (${createdPatient.patient_code}) and saved clinical assessment.`
        : 'Clinical assessment saved to database.',
    )
    setActiveRoute('assessment-history')
  }

  function handleAssessmentUpdated(updated: ClinicalAssessmentRecord) {
    setAssessments((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    )
  }

  function handleViewAssessmentResult(assessmentId: string) {
    setJustSavedBanner(null)
    setActiveAssessmentId(assessmentId)
    setActiveRoute('assessment-history')
  }

  function handleSelectRoute(route: AppRoute) {
    if (route === 'new-assessment') {
      setPrefillPatient(null)
    }
    setJustSavedBanner(null)
    setActiveAssessmentId(null)
    setActiveRoute(route)
  }

  const activeAssessment = activeAssessmentId
    ? assessments.find((item) => item.id === activeAssessmentId) ?? null
    : null

  return (
    <div className="app-shell">
      <header className="platform-header">
        <div className="header-inner">
          <div className="header-identity">
            <div className="project-meta-row">
              <span className="project-code-badge">Project Code: 27CSPS028</span>
              <span className="academic-tag">Healthcare Decision-Support Platform</span>
            </div>
            <h1>Healthcare GenAI Platform</h1>
            <p className="project-subtitle">
              Reimagining Healthcare with Generative AI: Personalized Diagnosis and Treatment
            </p>
            <p className="header-description">
              A privacy-aware healthcare application integrating clinical intake,
              data preprocessing, predictive and generative AI analysis, and
              clinician-reviewed treatment support.
            </p>
          </div>

          <nav className="primary-nav" aria-label="Application navigation">
            {PRIMARY_NAV_ITEMS.map((item) => {
              const isSelected = activeRoute === item.id
              const classes = [
                'nav-tab',
                isSelected ? 'nav-tab-active' : '',
                item.secondary ? 'nav-tab-secondary' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <button
                  key={item.id}
                  type="button"
                  className={classes}
                  onClick={() => handleSelectRoute(item.id)}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="main-content">
        {activeAssessment ? (
          <AssessmentResultsView
            assessment={activeAssessment}
            justSavedBanner={justSavedBanner}
            onAssessmentUpdated={handleAssessmentUpdated}
            onStartAnother={() => handleStartNewAssessment()}
            onBackToDashboard={() => handleSelectRoute('dashboard')}
          />
        ) : (
          <>
            {activeRoute === 'dashboard' && (
              <DashboardHome
                patients={patients}
                assessments={assessments}
                loadingRecords={loadingRecords}
                recordsError={recordsError}
                onRefreshRecords={handleRefreshRecords}
                onNavigate={handleSelectRoute}
                onStartNewAssessment={handleStartNewAssessment}
                onViewAssessmentResult={handleViewAssessmentResult}
              />
            )}

            {activeRoute === 'new-assessment' && (
              <PatientAssessmentWorkflow
                patients={patients}
                health={health}
                healthError={healthError}
                prefillPatient={prefillPatient}
                onRefreshHealth={handleRefreshHealth}
                onAssessmentSaved={handleAssessmentSaved}
                onCancel={() => handleSelectRoute('dashboard')}
              />
            )}

            {activeRoute === 'patient-records' && (
              <PatientRecordsView
                patients={patients}
                assessments={assessments}
                loading={loadingRecords}
                error={recordsError}
                onRefresh={handleRefreshRecords}
                onStartNewAssessment={handleStartNewAssessment}
              />
            )}

            {activeRoute === 'assessment-history' && (
              <AssessmentHistoryView
                assessments={assessments}
                loading={loadingRecords}
                error={recordsError}
                onRefresh={handleRefreshRecords}
                onViewAssessmentResult={handleViewAssessmentResult}
                onStartNewAssessment={() => handleStartNewAssessment()}
              />
            )}

            {activeRoute === 'research-info' && (
              <ResearchInformationView
                health={health}
                healthError={healthError}
                checkingHealth={checkingHealth}
                predictionResult={standalonePredictionResult}
                onPredictionResultChange={setStandalonePredictionResult}
                onRefreshHealth={handleRefreshHealth}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default App
