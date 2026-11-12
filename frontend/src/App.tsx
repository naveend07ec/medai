import { useCallback, useEffect, useState } from 'react'
import { fetchAssessments, fetchGenAIHealth, fetchPatients } from './api/clinical'
import './App.css'
import { AssessmentResultsView } from './components/AssessmentResultsView'
import { DashboardHome } from './components/DashboardHome'
import { KnowledgeBaseView } from './components/KnowledgeBaseView'
import { MedAiWordmark } from './components/MedAiWordmark'
import { PatientAssessmentWorkflow } from './components/PatientAssessmentWorkflow'
import type {
  AppRoute,
  ClinicalAssessmentRecord,
  GenAIHealthStatus,
  PatientRecord,
} from './types/assessment'

const PRIMARY_NAV_ITEMS: Array<{
  id: AppRoute
  label: string
}> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'new-assessment', label: 'New Analysis' },
  { id: 'knowledge-base', label: 'Knowledge Base' },
]

function App() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>('dashboard')
  const [patients, setPatients] = useState<PatientRecord[]>([])
  const [assessments, setAssessments] = useState<ClinicalAssessmentRecord[]>([])
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)

  const [activeAssessmentId, setActiveAssessmentId] = useState<string | null>(null)
  const [prefillPatient, setPrefillPatient] = useState<PatientRecord | null>(null)
  const [prefillAssessment, setPrefillAssessment] =
    useState<ClinicalAssessmentRecord | null>(null)
  const [justSavedBanner, setJustSavedBanner] = useState<string | null>(null)

  const [genaiHealth, setGenaiHealth] = useState<GenAIHealthStatus | null>(null)
  const [genaiHealthError, setGenaiHealthError] = useState<string | null>(null)

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
      if (showSpinner) {
        setLoadingRecords(false)
      }
    }

    fetchGenAIHealth()
      .then((status) => {
        setGenaiHealth(status)
        setGenaiHealthError(null)
      })
      .catch((err: unknown) => {
        setGenaiHealth(null)
        setGenaiHealthError(
          err instanceof Error
            ? err.message
            : 'Unable to reach Clinical AI health check.',
        )
      })
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

    fetchGenAIHealth()
      .then((status) => {
        if (!active) return
        setGenaiHealth(status)
        setGenaiHealthError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        setGenaiHealth(null)
        setGenaiHealthError(
          err instanceof Error
            ? err.message
            : 'Unable to reach Clinical AI health check.',
        )
      })

    return () => {
      active = false
    }
  }, [])

  const handleRefreshRecords = useCallback(() => {
    void loadClinicalRecords(true)
  }, [loadClinicalRecords])

  function handleStartNewAssessment(
    patient?: PatientRecord,
    sourceAssessment?: ClinicalAssessmentRecord,
  ) {
    setPrefillPatient(patient ?? sourceAssessment?.patient ?? null)
    setPrefillAssessment(sourceAssessment ?? null)
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
    setPrefillAssessment(null)
    setActiveAssessmentId(savedAssessment.id)
    setJustSavedBanner(
      createdPatient
        ? `Saved patient ${createdPatient.full_name} and clinical assessment.`
        : 'Clinical assessment saved.',
    )
    setActiveRoute('dashboard')
  }

  function handleAssessmentUpdated(updated: ClinicalAssessmentRecord) {
    setAssessments((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    )
  }

  function handleViewAssessmentResult(assessmentId: string) {
    setJustSavedBanner(null)
    setActiveAssessmentId(assessmentId)
    setActiveRoute('dashboard')
  }

  function handleSelectRoute(route: AppRoute) {
    if (route === 'new-assessment') {
      setPrefillPatient(null)
      setPrefillAssessment(null)
    }
    setJustSavedBanner(null)
    setActiveAssessmentId(null)
    setActiveRoute(route)
  }

  const activeAssessment =
    activeAssessmentId !== null
      ? assessments.find((item) => item.id === activeAssessmentId) ?? null
      : null

  return (
    <div className="app-shell">
      <header className="platform-header">
        <div className="header-inner">
          <div className="header-topbar">
            <button
              type="button"
              className="header-brand-btn"
              onClick={() => handleSelectRoute('dashboard')}
              aria-label="MedAI Home"
            >
              <MedAiWordmark />
            </button>
            <nav className="primary-nav" aria-label="Application navigation">
              {PRIMARY_NAV_ITEMS.map((item) => {
                const isSelected = activeRoute === item.id && !activeAssessment
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`nav-tab ${isSelected ? 'nav-tab-active' : ''}`}
                    onClick={() => handleSelectRoute(item.id)}
                  >
                    {item.label}
                  </button>
                )
              })}
            </nav>
          </div>
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
                genaiHealth={genaiHealth}
                genaiHealthError={genaiHealthError}
                onRefreshRecords={handleRefreshRecords}
                onNavigate={handleSelectRoute}
                onStartNewAssessment={handleStartNewAssessment}
                onViewAssessmentResult={handleViewAssessmentResult}
              />
            )}

            {activeRoute === 'new-assessment' && (
              <PatientAssessmentWorkflow
                key={prefillAssessment?.id ?? prefillPatient?.id ?? 'new'}
                patients={patients}
                prefillPatient={prefillPatient}
                prefillAssessment={prefillAssessment}
                onAssessmentSaved={handleAssessmentSaved}
                onCancel={() => handleSelectRoute('dashboard')}
              />
            )}

            {activeRoute === 'knowledge-base' && <KnowledgeBaseView />}
          </>
        )}
      </main>
    </div>
  )
}

export default App
