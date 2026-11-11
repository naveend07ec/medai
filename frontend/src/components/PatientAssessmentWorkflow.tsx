import { useState } from 'react'
import { createAssessment, createPatient } from '../api/clinical'
import { submitDiabetesPrediction } from '../api/predictions'
import type {
  AssessmentDraft,
  ClinicalAssessmentRecord,
  PatientRecord,
  PredictiveExperimentOutcome,
} from '../types/assessment'
import type { PredictiveModelHealth } from '../types/prediction'
import {
  buildPreprocessingSummary,
  computeAgeYears,
  createEmptyDraft,
  evaluateClinicalMeasurements,
  PIMA_FEATURE_FIELDS,
  type PimaFeatureKey,
  validateAssessmentDraft,
} from '../utils/assessmentValidation'

interface PatientAssessmentWorkflowProps {
  patients: PatientRecord[]
  health: PredictiveModelHealth | null
  healthError: string | null
  prefillPatient: PatientRecord | null
  onRefreshHealth: () => void
  onAssessmentSaved: (
    assessment: ClinicalAssessmentRecord,
    createdPatient: PatientRecord | null,
  ) => void
  onCancel: () => void
}

type WorkflowStage = 'intake' | 'processing'

export function PatientAssessmentWorkflow({
  patients,
  health,
  healthError,
  prefillPatient,
  onRefreshHealth,
  onAssessmentSaved,
  onCancel,
}: PatientAssessmentWorkflowProps) {
  const [draft, setDraft] = useState<AssessmentDraft>(() => {
    const initial = createEmptyDraft()
    if (prefillPatient) {
      initial.patientInfo.patientMode = 'existing'
      initial.patientInfo.existingPatientId = prefillPatient.id
    }
    return initial
  })

  const [stage, setStage] = useState<WorkflowStage>('intake')
  const [processingMessage, setProcessingMessage] = useState<string>('')
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [patientErrors, setPatientErrors] = useState<Record<string, string>>({})
  const [vitalErrors, setVitalErrors] = useState<Record<string, string>>({})
  const [pimaErrors, setPimaErrors] = useState<
    Partial<Record<PimaFeatureKey, string>>
  >({})

  const isDiabetesModelReady = Boolean(
    health && health.status === 'ready' && !healthError,
  )

  const liveVitalEvaluation = evaluateClinicalMeasurements(
    draft.clinicalMeasurements,
  )
  const displayedVitalErrors =
    Object.keys(vitalErrors).length > 0
      ? vitalErrors
      : liveVitalEvaluation.vitalErrors
  const liveVitalWarnings = liveVitalEvaluation.vitalWarnings
  const warningMessages = Object.values(liveVitalWarnings)

  const selectedExistingPatient =
    draft.patientInfo.patientMode === 'existing'
      ? patients.find((p) => p.id === draft.patientInfo.existingPatientId) ?? null
      : null

  function syncAvailableVitalsToPima() {
    const dobForAge =
      draft.patientInfo.patientMode === 'existing'
        ? selectedExistingPatient?.date_of_birth ?? ''
        : draft.patientInfo.dateOfBirth
    const computedAge = computeAgeYears(dobForAge)

    setDraft((prev) => ({
      ...prev,
      diabetesFeatures: {
        ...prev.diabetesFeatures,
        Age:
          computedAge !== null ? String(computedAge) : prev.diabetesFeatures.Age,
        BloodPressure:
          prev.clinicalMeasurements.diastolicBp.trim() ||
          prev.diabetesFeatures.BloodPressure,
      },
    }))
  }

  function handleReportFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    setDraft((prev) => ({
      ...prev,
      medicalRecords: {
        ...prev.medicalRecords,
        attachedReportNames: files.map((file) => file.name),
      },
    }))
  }

  function handleMedicalImagesChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    setDraft((prev) => ({
      ...prev,
      medicalImages: {
        ...prev.medicalImages,
        attachedImages: files.map((file) => ({
          name: file.name,
          size_label: `${Math.max(1, Math.round(file.size / 1024))} KB`,
          type: file.type || 'image',
        })),
      },
    }))
  }

  async function handleAnalyzeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError(null)

    const validation = validateAssessmentDraft(draft)
    setGeneralError(validation.generalError)
    setPatientErrors(validation.patientErrors)
    setVitalErrors(validation.vitalErrors)
    setPimaErrors(validation.pimaErrors)

    if (
      validation.generalError ||
      Object.keys(validation.patientErrors).length > 0 ||
      Object.keys(validation.vitalErrors).length > 0 ||
      Object.keys(validation.pimaErrors).length > 0
    ) {
      return
    }

    setStage('processing')

    let resolvedPatientId = draft.patientInfo.existingPatientId
    let newlyCreatedPatient: PatientRecord | null = null

    try {
      if (draft.patientInfo.patientMode === 'new') {
        setProcessingMessage('Persisting new patient identity record...')
        newlyCreatedPatient = await createPatient({
          full_name: draft.patientInfo.fullName.trim(),
          date_of_birth: draft.patientInfo.dateOfBirth.trim(),
          patient_code: draft.patientInfo.patientCode.trim() || undefined,
          sex: draft.patientInfo.sex.trim() || undefined,
          contact_number: draft.patientInfo.contactNumber.trim() || undefined,
        })
        resolvedPatientId = newlyCreatedPatient.id
      }

      const unusualWarnings = Object.values(validation.vitalWarnings)
      const preprocessing = buildPreprocessingSummary(draft, unusualWarnings)
      let predictiveOutcome: PredictiveExperimentOutcome

      if (!draft.includeDiabetesExperiment) {
        predictiveOutcome = {
          executed: false,
          status: 'not-requested',
          result: null,
          message:
            'The optional Pima diabetes predictive experiment was not selected for this assessment.',
        }
      } else if (!isDiabetesModelReady || !validation.parsedPima) {
        predictiveOutcome = {
          executed: false,
          status: 'unavailable',
          result: null,
          message:
            healthError ||
            health?.detail ||
            'The diabetes predictive model service is currently unavailable.',
        }
      } else {
        setProcessingMessage('Running Pima predictive experiment via FastAPI...')
        try {
          const result = await submitDiabetesPrediction(validation.parsedPima)
          predictiveOutcome = {
            executed: true,
            status: 'completed',
            result,
            message: 'Diabetes predictive experiment completed via FastAPI backend.',
          }
        } catch (err: unknown) {
          onRefreshHealth()
          predictiveOutcome = {
            executed: false,
            status: 'error',
            result: null,
            message:
              err instanceof Error
                ? err.message
                : 'Predictive model request failed.',
          }
        }
      }

      setProcessingMessage('Saving clinical assessment record to database...')
      const parseOptionalNumber = (raw: string): number | undefined => {
        const trimmed = raw.trim()
        return trimmed === '' ? undefined : Number(trimmed)
      }

      const formattedMedicalHistoryNotes = [
        draft.symptomsHistory.knownAllergies.trim() &&
          `Known Allergies: ${draft.symptomsHistory.knownAllergies.trim()}`,
        draft.symptomsHistory.medicalHistoryNotes.trim(),
      ]
        .filter(Boolean)
        .join('\n')

      const savedAssessment = await createAssessment({
        patient_id: resolvedPatientId,
        demographics_notes: draft.patientInfo.demographicsNotes.trim() || undefined,
        current_symptoms: draft.symptomsHistory.currentSymptoms.trim() || undefined,
        symptom_duration: draft.symptomsHistory.symptomDuration.trim() || undefined,
        previous_conditions:
          draft.symptomsHistory.previousConditions.trim() || undefined,
        existing_medications:
          draft.symptomsHistory.existingMedications.trim() || undefined,
        medical_history_notes: formattedMedicalHistoryNotes || undefined,
        systolic_bp: parseOptionalNumber(draft.clinicalMeasurements.systolicBp),
        diastolic_bp: parseOptionalNumber(draft.clinicalMeasurements.diastolicBp),
        heart_rate: parseOptionalNumber(draft.clinicalMeasurements.heartRate),
        body_temperature: parseOptionalNumber(
          draft.clinicalMeasurements.bodyTemperature,
        ),
        oxygen_saturation: parseOptionalNumber(
          draft.clinicalMeasurements.oxygenSaturation,
        ),
        additional_measurements:
          draft.clinicalMeasurements.additionalMeasurements.trim() || undefined,
        lab_results: draft.medicalRecords.labResults.trim() || undefined,
        ehr_summary: draft.medicalRecords.ehrSummary.trim() || undefined,
        previous_reports: draft.medicalRecords.previousReports.trim() || undefined,
        attached_report_names: draft.medicalRecords.attachedReportNames,
        attached_images: draft.medicalImages.attachedImages,
        imaging_notes: draft.medicalImages.imagingNotes.trim() || undefined,
        genomic_notes: draft.genomicInfo.genomicNotes.trim() || undefined,
        family_history_markers:
          draft.genomicInfo.familyHistoryMarkers.trim() || undefined,
        preprocessing_summary: preprocessing,
        predictive_experiment_result: predictiveOutcome,
        clinician_reviewed: false,
      })

      onAssessmentSaved(savedAssessment, newlyCreatedPatient)
    } catch (err: unknown) {
      setStage('intake')
      setProcessingMessage('')
      if (newlyCreatedPatient) {
        // Switch to existing patient mode so user can retry saving the assessment without duplicating patient creation.
        setDraft((prev) => ({
          ...prev,
          patientInfo: {
            ...prev.patientInfo,
            patientMode: 'existing',
            existingPatientId: newlyCreatedPatient?.id ?? '',
          },
        }))
      }
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Unable to save assessment to the backend database.',
      )
    }
  }

  return (
    <div className="workflow-container">
      <div className="assessment-progress-bar" aria-label="Assessment progress">
        <div
          className={
            stage === 'intake' ? 'step-pill step-active' : 'step-pill step-done'
          }
        >
          1. Patient Healthcare Information Input
        </div>
        <div
          className={stage === 'processing' ? 'step-pill step-active' : 'step-pill'}
        >
          2. Preprocessing, Persistence &amp; AI Analysis
        </div>
        <div className="step-pill">3. Diagnostic Results &amp; Treatment Support</div>
      </div>

      {stage === 'processing' ? (
        <section className="panel processing-panel" aria-live="polite">
          <h2>Running Integrated Healthcare Analysis Pipeline…</h2>
          <p className="processing-status-text">{processingMessage}</p>
          <ul className="pipeline-status-list">
            <li>
              <strong>Component 1 — Data Analysis &amp; Preprocessing:</strong>{' '}
              Validating entered clinical fields and persisting structured intake.
            </li>
            <li>
              <strong>Component 2 — GenAI-Based Diagnosis:</strong>{' '}
              {draft.includeDiabetesExperiment
                ? 'Running optional Pima predictive experiment via FastAPI…'
                : 'Recording assessment without optional Pima diabetes screening.'}
            </li>
            <li>
              <strong>Component 3 — Decision Support &amp; Privacy:</strong> Keeping
              patient identity separate from clinical observations in PostgreSQL.
            </li>
          </ul>
        </section>
      ) : (
        <form onSubmit={handleAnalyzeSubmit} className="intake-form" noValidate>
          <div className="intake-intro-bar">
            <div>
              <h2>New Patient Assessment</h2>
              <p>
                Select an existing patient or register a new patient, then enter available
                clinical information. Only provided modalities are stored.
              </p>
            </div>
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>

          {submitError && (
            <div className="alert alert-error" role="alert">
              <strong>Save Failed:</strong> {submitError}
            </div>
          )}

          {generalError && (
            <div className="alert alert-error" role="alert">
              {generalError}
            </div>
          )}

          {/* Section A */}
          <section className="panel intake-section" aria-labelledby="sec-a-heading">
            <div className="section-header-inline">
              <h3 id="sec-a-heading">A. Patient Information</h3>
              <div className="mode-toggle-group" role="group" aria-label="Patient selection mode">
                <button
                  type="button"
                  className={
                    draft.patientInfo.patientMode === 'new'
                      ? 'mode-btn mode-btn-active'
                      : 'mode-btn'
                  }
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      patientInfo: { ...prev.patientInfo, patientMode: 'new' },
                    }))
                  }
                >
                  New Patient
                </button>
                <button
                  type="button"
                  className={
                    draft.patientInfo.patientMode === 'existing'
                      ? 'mode-btn mode-btn-active'
                      : 'mode-btn'
                  }
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      patientInfo: { ...prev.patientInfo, patientMode: 'existing' },
                    }))
                  }
                >
                  Existing Patient ({patients.length})
                </button>
              </div>
            </div>

            {draft.patientInfo.patientMode === 'existing' ? (
              <div className="fields-grid">
                <div className="field-group">
                  <label htmlFor="pi-existing" className="field-label">
                    <span>Select Registered Patient *</span>
                  </label>
                  <select
                    id="pi-existing"
                    value={draft.patientInfo.existingPatientId}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        patientInfo: {
                          ...prev.patientInfo,
                          existingPatientId: e.target.value,
                        },
                      }))
                    }
                    className={
                      patientErrors.existingPatientId ? 'input-error' : undefined
                    }
                  >
                    <option value="">
                      {patients.length === 0
                        ? 'No saved patients available — switch to New Patient'
                        : 'Select a patient record...'}
                    </option>
                    {patients.map((patient) => (
                      <option key={patient.id} value={patient.id}>
                        {patient.full_name} ({patient.patient_code}) — DOB{' '}
                        {patient.date_of_birth}
                      </option>
                    ))}
                  </select>
                  {patientErrors.existingPatientId && (
                    <span className="error-text">
                      {patientErrors.existingPatientId}
                    </span>
                  )}
                </div>

                {selectedExistingPatient && (
                  <div className="selected-patient-card">
                    <strong>{selectedExistingPatient.full_name}</strong>
                    <span>
                      Code: <code>{selectedExistingPatient.patient_code}</code> • DOB:{' '}
                      {selectedExistingPatient.date_of_birth}
                      {selectedExistingPatient.sex
                        ? ` • ${selectedExistingPatient.sex}`
                        : ''}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="fields-grid">
                <div className="field-group">
                  <label htmlFor="pi-name" className="field-label">
                    <span>Full Name *</span>
                    <span className="field-unit">required</span>
                  </label>
                  <input
                    id="pi-name"
                    type="text"
                    placeholder="Patient full name"
                    value={draft.patientInfo.fullName}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        patientInfo: {
                          ...prev.patientInfo,
                          fullName: e.target.value,
                        },
                      }))
                    }
                    className={patientErrors.fullName ? 'input-error' : undefined}
                  />
                  {patientErrors.fullName && (
                    <span className="error-text">{patientErrors.fullName}</span>
                  )}
                </div>

                <div className="field-group">
                  <label htmlFor="pi-dob" className="field-label">
                    <span>Date of Birth *</span>
                    <span className="field-unit">required</span>
                  </label>
                  <input
                    id="pi-dob"
                    type="date"
                    value={draft.patientInfo.dateOfBirth}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        patientInfo: {
                          ...prev.patientInfo,
                          dateOfBirth: e.target.value,
                        },
                      }))
                    }
                    className={
                      patientErrors.dateOfBirth ? 'input-error' : undefined
                    }
                  />
                  {patientErrors.dateOfBirth ? (
                    <span className="error-text">{patientErrors.dateOfBirth}</span>
                  ) : (
                    draft.patientInfo.dateOfBirth && (
                      <span className="help-text">
                        Computed age:{' '}
                        {computeAgeYears(draft.patientInfo.dateOfBirth) ?? '—'} years
                      </span>
                    )
                  )}
                </div>

                <div className="field-group">
                  <label htmlFor="pi-code" className="field-label">
                    <span>Patient Code</span>
                    <span className="field-unit">optional (auto-generated)</span>
                  </label>
                  <input
                    id="pi-code"
                    type="text"
                    placeholder="Leave blank to auto-assign (e.g. PT-1A2B3C4D)"
                    value={draft.patientInfo.patientCode}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        patientInfo: {
                          ...prev.patientInfo,
                          patientCode: e.target.value,
                        },
                      }))
                    }
                    className={
                      patientErrors.patientCode ? 'input-error' : undefined
                    }
                  />
                  {patientErrors.patientCode && (
                    <span className="error-text">{patientErrors.patientCode}</span>
                  )}
                </div>

                <div className="field-group">
                  <label htmlFor="pi-sex" className="field-label">
                    <span>Sex</span>
                    <span className="field-unit">optional</span>
                  </label>
                  <select
                    id="pi-sex"
                    value={draft.patientInfo.sex}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        patientInfo: { ...prev.patientInfo, sex: e.target.value },
                      }))
                    }
                  >
                    <option value="">Select if available</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Other">Other / Prefer not to say</option>
                  </select>
                </div>

                <div className="field-group">
                  <label htmlFor="pi-contact" className="field-label">
                    <span>Contact Number</span>
                    <span className="field-unit">optional</span>
                  </label>
                  <input
                    id="pi-contact"
                    type="text"
                    maxLength={20}
                    placeholder="Optional contact number"
                    value={draft.patientInfo.contactNumber}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        patientInfo: {
                          ...prev.patientInfo,
                          contactNumber: e.target.value,
                        },
                      }))
                    }
                    className={
                      patientErrors.contactNumber ? 'input-error' : undefined
                    }
                  />
                  {patientErrors.contactNumber && (
                    <span className="error-text">{patientErrors.contactNumber}</span>
                  )}
                </div>
              </div>
            )}

            <div className="field-group">
              <label htmlFor="pi-notes" className="field-label">
                <span>Relevant Assessment Context Notes</span>
                <span className="field-unit">optional</span>
              </label>
              <textarea
                id="pi-notes"
                rows={2}
                placeholder="Visit reason or relevant baseline context..."
                value={draft.patientInfo.demographicsNotes}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    patientInfo: {
                      ...prev.patientInfo,
                      demographicsNotes: e.target.value,
                    },
                  }))
                }
              />
            </div>
          </section>

          {/* Section B */}
          <section className="panel intake-section" aria-labelledby="sec-b-heading">
            <h3 id="sec-b-heading">B. Symptoms and Medical History</h3>
            <div className="fields-grid">
              <div className="field-group">
                <label htmlFor="sh-symptoms" className="field-label">
                  <span>Current Symptoms</span>
                </label>
                <textarea
                  id="sh-symptoms"
                  rows={2}
                  placeholder="Primary presenting symptoms..."
                  value={draft.symptomsHistory.currentSymptoms}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      symptomsHistory: {
                        ...prev.symptomsHistory,
                        currentSymptoms: e.target.value,
                      },
                    }))
                  }
                />
              </div>

              <div className="field-group">
                <label htmlFor="sh-duration" className="field-label">
                  <span>Duration of Symptoms</span>
                </label>
                <input
                  id="sh-duration"
                  type="text"
                  placeholder="e.g., 5 days, 3 weeks"
                  value={draft.symptomsHistory.symptomDuration}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      symptomsHistory: {
                        ...prev.symptomsHistory,
                        symptomDuration: e.target.value,
                      },
                    }))
                  }
                />
              </div>

              <div className="field-group">
                <label htmlFor="sh-conditions" className="field-label">
                  <span>Previous Medical Conditions</span>
                </label>
                <textarea
                  id="sh-conditions"
                  rows={2}
                  placeholder="Prior diagnoses, chronic conditions, surgeries..."
                  value={draft.symptomsHistory.previousConditions}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      symptomsHistory: {
                        ...prev.symptomsHistory,
                        previousConditions: e.target.value,
                      },
                    }))
                  }
                />
              </div>

              <div className="field-group">
                <label htmlFor="sh-meds" className="field-label">
                  <span>Existing Medications</span>
                  <span className="field-unit">medications &amp; dosages</span>
                </label>
                <textarea
                  id="sh-meds"
                  rows={2}
                  placeholder="Current medications and dosages (e.g., Metformin 500 mg twice daily)..."
                  value={draft.symptomsHistory.existingMedications}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      symptomsHistory: {
                        ...prev.symptomsHistory,
                        existingMedications: e.target.value,
                      },
                    }))
                  }
                />
              </div>

              <div className="field-group">
                <label htmlFor="sh-allergies" className="field-label">
                  <span>Known Allergies</span>
                  <span className="field-unit">optional</span>
                </label>
                <textarea
                  id="sh-allergies"
                  rows={2}
                  placeholder="Drug, food, or environmental allergies (or 'None known')..."
                  value={draft.symptomsHistory.knownAllergies}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      symptomsHistory: {
                        ...prev.symptomsHistory,
                        knownAllergies: e.target.value,
                      },
                    }))
                  }
                />
              </div>
            </div>
          </section>

          {/* Section C */}
          <section className="panel intake-section" aria-labelledby="sec-c-heading">
            <h3 id="sec-c-heading">C. Clinical Measurements</h3>
            <p className="modality-note">
              Enter measurements using the indicated units. Broad technical entry limits
              allow unusual or critical clinical readings to be recorded; unusual values
              display a non-blocking warning while physically invalid values are rejected.
            </p>

            {warningMessages.length > 0 && (
              <div className="alert alert-warn" role="status">
                <strong>Unusual Clinical Reading Notice (Non-Blocking):</strong>{' '}
                {warningMessages.length} measurement(s) fall outside typical resting
                reference patterns and have been flagged below for clinician attention.
              </div>
            )}

            <div className="fields-grid fields-grid-3">
              <div className="field-group">
                <label htmlFor="cm-sbp" className="field-label">
                  <span>Systolic Blood Pressure</span>
                  <span className="field-unit">mm Hg</span>
                </label>
                <input
                  id="cm-sbp"
                  type="number"
                  min={50}
                  max={280}
                  step="any"
                  placeholder="e.g. 120 (mm Hg)"
                  value={draft.clinicalMeasurements.systolicBp}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      clinicalMeasurements: {
                        ...prev.clinicalMeasurements,
                        systolicBp: e.target.value,
                      },
                    }))
                  }
                  className={
                    displayedVitalErrors.systolicBp
                      ? 'input-error'
                      : liveVitalWarnings.systolicBp
                        ? 'input-warning'
                        : undefined
                  }
                />
                {displayedVitalErrors.systolicBp ? (
                  <span className="error-text" role="alert">
                    {displayedVitalErrors.systolicBp}
                  </span>
                ) : liveVitalWarnings.systolicBp ? (
                  <span className="warning-text" role="status">
                    {liveVitalWarnings.systolicBp}
                  </span>
                ) : (
                  <span className="help-text">
                    Unit: mm Hg (technical entry limit: 50–280 mm Hg)
                  </span>
                )}
              </div>

              <div className="field-group">
                <label htmlFor="cm-dbp" className="field-label">
                  <span>Diastolic Blood Pressure</span>
                  <span className="field-unit">mm Hg</span>
                </label>
                <input
                  id="cm-dbp"
                  type="number"
                  min={30}
                  max={180}
                  step="any"
                  placeholder="e.g. 80 (mm Hg)"
                  value={draft.clinicalMeasurements.diastolicBp}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      clinicalMeasurements: {
                        ...prev.clinicalMeasurements,
                        diastolicBp: e.target.value,
                      },
                    }))
                  }
                  className={
                    displayedVitalErrors.diastolicBp
                      ? 'input-error'
                      : liveVitalWarnings.diastolicBp
                        ? 'input-warning'
                        : undefined
                  }
                />
                {displayedVitalErrors.diastolicBp ? (
                  <span className="error-text" role="alert">
                    {displayedVitalErrors.diastolicBp}
                  </span>
                ) : liveVitalWarnings.diastolicBp ? (
                  <span className="warning-text" role="status">
                    {liveVitalWarnings.diastolicBp}
                  </span>
                ) : (
                  <span className="help-text">
                    Unit: mm Hg (technical entry limit: 30–180 mm Hg)
                  </span>
                )}
              </div>

              <div className="field-group">
                <label htmlFor="cm-hr" className="field-label">
                  <span>Heart Rate</span>
                  <span className="field-unit">bpm</span>
                </label>
                <input
                  id="cm-hr"
                  type="number"
                  min={25}
                  max={250}
                  step="any"
                  placeholder="e.g. 72 (bpm)"
                  value={draft.clinicalMeasurements.heartRate}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      clinicalMeasurements: {
                        ...prev.clinicalMeasurements,
                        heartRate: e.target.value,
                      },
                    }))
                  }
                  className={
                    displayedVitalErrors.heartRate
                      ? 'input-error'
                      : liveVitalWarnings.heartRate
                        ? 'input-warning'
                        : undefined
                  }
                />
                {displayedVitalErrors.heartRate ? (
                  <span className="error-text" role="alert">
                    {displayedVitalErrors.heartRate}
                  </span>
                ) : liveVitalWarnings.heartRate ? (
                  <span className="warning-text" role="status">
                    {liveVitalWarnings.heartRate}
                  </span>
                ) : (
                  <span className="help-text">
                    Unit: beats per minute (technical entry limit: 25–250 bpm)
                  </span>
                )}
              </div>

              <div className="field-group">
                <label htmlFor="cm-temp" className="field-label">
                  <span>Body Temperature</span>
                  <span className="field-unit">°C</span>
                </label>
                <input
                  id="cm-temp"
                  type="number"
                  min={30}
                  max={45}
                  step="0.1"
                  placeholder="e.g. 36.8 (°C)"
                  value={draft.clinicalMeasurements.bodyTemperature}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      clinicalMeasurements: {
                        ...prev.clinicalMeasurements,
                        bodyTemperature: e.target.value,
                      },
                    }))
                  }
                  className={
                    displayedVitalErrors.bodyTemperature
                      ? 'input-error'
                      : liveVitalWarnings.bodyTemperature
                        ? 'input-warning'
                        : undefined
                  }
                />
                {displayedVitalErrors.bodyTemperature ? (
                  <span className="error-text" role="alert">
                    {displayedVitalErrors.bodyTemperature}
                  </span>
                ) : liveVitalWarnings.bodyTemperature ? (
                  <span className="warning-text" role="status">
                    {liveVitalWarnings.bodyTemperature}
                  </span>
                ) : (
                  <span className="help-text">
                    Unit: °C (technical entry limit: 30–45 °C)
                  </span>
                )}
              </div>

              <div className="field-group">
                <label htmlFor="cm-spo2" className="field-label">
                  <span>Oxygen Saturation (SpO₂)</span>
                  <span className="field-unit">%</span>
                </label>
                <input
                  id="cm-spo2"
                  type="number"
                  min={40}
                  max={100}
                  step="any"
                  placeholder="e.g. 98 (%)"
                  value={draft.clinicalMeasurements.oxygenSaturation}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      clinicalMeasurements: {
                        ...prev.clinicalMeasurements,
                        oxygenSaturation: e.target.value,
                      },
                    }))
                  }
                  className={
                    displayedVitalErrors.oxygenSaturation
                      ? 'input-error'
                      : liveVitalWarnings.oxygenSaturation
                        ? 'input-warning'
                        : undefined
                  }
                />
                {displayedVitalErrors.oxygenSaturation ? (
                  <span className="error-text" role="alert">
                    {displayedVitalErrors.oxygenSaturation}
                  </span>
                ) : liveVitalWarnings.oxygenSaturation ? (
                  <span className="warning-text" role="status">
                    {liveVitalWarnings.oxygenSaturation}
                  </span>
                ) : (
                  <span className="help-text">
                    Unit: % (technical entry limit: 40–100 %)
                  </span>
                )}
              </div>

              <div className="field-group">
                <label htmlFor="cm-other" className="field-label">
                  <span>Other Measurements</span>
                  <span className="field-unit">include units</span>
                </label>
                <input
                  id="cm-other"
                  type="text"
                  placeholder="e.g., Respiratory rate 16 /min, Weight 68 kg, HbA1c 6.4%"
                  value={draft.clinicalMeasurements.additionalMeasurements}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      clinicalMeasurements: {
                        ...prev.clinicalMeasurements,
                        additionalMeasurements: e.target.value,
                      },
                    }))
                  }
                />
                <span className="help-text">
                  Specify units when recording additional clinical measurements
                </span>
              </div>
            </div>
          </section>

          {/* Section D, E, F */}
          <div className="modalities-grid">
            <section className="panel intake-section" aria-labelledby="sec-d-heading">
              <h3 id="sec-d-heading">D. Medical Records and Reports</h3>
              <p className="modality-note">
                Stores entered laboratory/EHR text and uploaded report file metadata
                (file names only). Automated report parsing, text extraction, and document
                analysis are not yet implemented.
              </p>
              <div className="field-group">
                <label htmlFor="mr-labs" className="field-label">
                  <span>Laboratory Results</span>
                </label>
                <textarea
                  id="mr-labs"
                  rows={2}
                  placeholder="CBC, metabolic panel, lipid profile, HbA1c..."
                  value={draft.medicalRecords.labResults}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      medicalRecords: {
                        ...prev.medicalRecords,
                        labResults: e.target.value,
                      },
                    }))
                  }
                />
              </div>

              <div className="field-group">
                <label htmlFor="mr-ehr" className="field-label">
                  <span>Electronic Health Records / Previous Reports</span>
                </label>
                <textarea
                  id="mr-ehr"
                  rows={2}
                  placeholder="EHR notes or summary of prior clinical reports..."
                  value={draft.medicalRecords.ehrSummary}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      medicalRecords: {
                        ...prev.medicalRecords,
                        ehrSummary: e.target.value,
                      },
                    }))
                  }
                />
              </div>

              <div className="field-group">
                <label htmlFor="mr-files" className="field-label">
                  <span>Attach Report Files (Metadata Only)</span>
                  <span className="field-unit">not parsed</span>
                </label>
                <input
                  id="mr-files"
                  type="file"
                  multiple
                  accept=".pdf,.txt,.csv,.json"
                  onChange={handleReportFilesChange}
                />
                {draft.medicalRecords.attachedReportNames.length > 0 && (
                  <span className="help-text">
                    File metadata recorded (content not extracted):{' '}
                    {draft.medicalRecords.attachedReportNames.join(', ')}
                  </span>
                )}
              </div>
            </section>

            <section className="panel intake-section" aria-labelledby="sec-e-heading">
              <h3 id="sec-e-heading">E. Medical Images (Optional)</h3>
              <p className="modality-note">
                Persists image file metadata references in the assessment record. Automated
                medical image analysis is not operational yet.
              </p>
              <div className="field-group">
                <label htmlFor="mi-files" className="field-label">
                  <span>Attach Medical Images (Metadata Only)</span>
                  <span className="field-unit">optional</span>
                </label>
                <input
                  id="mi-files"
                  type="file"
                  multiple
                  accept="image/*,.dcm"
                  onChange={handleMedicalImagesChange}
                />
                {draft.medicalImages.attachedImages.length > 0 && (
                  <ul className="attached-file-list">
                    {draft.medicalImages.attachedImages.map((img) => (
                      <li key={img.name}>
                        {img.name} ({img.size_label})
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="field-group">
                <label htmlFor="mi-notes" className="field-label">
                  <span>Imaging Notes / Modality</span>
                  <span className="field-unit">optional</span>
                </label>
                <input
                  id="mi-notes"
                  type="text"
                  placeholder="e.g., Chest X-ray, MRI study notes"
                  value={draft.medicalImages.imagingNotes}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      medicalImages: {
                        ...prev.medicalImages,
                        imagingNotes: e.target.value,
                      },
                    }))
                  }
                />
              </div>
            </section>

            <section className="panel intake-section" aria-labelledby="sec-f-heading">
              <h3 id="sec-f-heading">F. Genomic Information (Optional)</h3>
              <p className="modality-note">
                Optional input slot storing genomic reference notes in the assessment
                schema. Automated genomic variant analysis is not operational yet.
              </p>
              <div className="field-group">
                <label htmlFor="gi-markers" className="field-label">
                  <span>Family / Genetic Risk Context</span>
                </label>
                <input
                  id="gi-markers"
                  type="text"
                  placeholder="Relevant hereditary history or marker notes..."
                  value={draft.genomicInfo.familyHistoryMarkers}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      genomicInfo: {
                        ...prev.genomicInfo,
                        familyHistoryMarkers: e.target.value,
                      },
                    }))
                  }
                />
              </div>

              <div className="field-group">
                <label htmlFor="gi-notes" className="field-label">
                  <span>Genomic Report Reference</span>
                </label>
                <textarea
                  id="gi-notes"
                  rows={2}
                  placeholder="Optional reference to external genomic test summary..."
                  value={draft.genomicInfo.genomicNotes}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      genomicInfo: {
                        ...prev.genomicInfo,
                        genomicNotes: e.target.value,
                      },
                    }))
                  }
                />
              </div>
            </section>
          </div>

          {/* Optional Disease-Specific Predictive AI Experiment */}
          <section
            className="panel intake-section experiment-optin-panel"
            aria-labelledby="optin-pima-heading"
          >
            <div className="optin-header">
              <div>
                <h3 id="optin-pima-heading">
                  Optional Predictive AI Screening: Pima Diabetes XGBoost Experiment
                </h3>
                <p>
                  Include our existing disease-specific 8-feature Pima predictive model
                  during AI analysis. This is one targeted research model—not the general
                  patient assessment form.
                </p>
              </div>
              <label className="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={draft.includeDiabetesExperiment}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      includeDiabetesExperiment: e.target.checked,
                    }))
                  }
                />
                <span>Include Diabetes Predictive Experiment</span>
              </label>
            </div>

            {draft.includeDiabetesExperiment && (
              <div className="optin-body">
                <div className="optin-toolbar">
                  <span className="help-text">
                    Model status:{' '}
                    <strong>
                      {isDiabetesModelReady
                        ? 'Ready (POST /api/v1/predictions/diabetes)'
                        : 'Unavailable (assessment will still save and mark this model unavailable)'}
                    </strong>
                  </span>
                  <button
                    type="button"
                    className="btn-secondary btn-xs"
                    onClick={syncAvailableVitalsToPima}
                  >
                    Sync Age &amp; Diastolic BP from Intake
                  </button>
                </div>

                <div className="fields-grid fields-grid-4">
                  {PIMA_FEATURE_FIELDS.map((field) => {
                    const error = pimaErrors[field.key]
                    const inputId = `intake-pima-${field.key}`
                    return (
                      <div key={field.key} className="field-group">
                        <label htmlFor={inputId} className="field-label">
                          <span>{field.label}</span>
                          <span className="field-unit">{field.unit}</span>
                        </label>
                        <input
                          id={inputId}
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={draft.diabetesFeatures[field.key]}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              diabetesFeatures: {
                                ...prev.diabetesFeatures,
                                [field.key]: e.target.value,
                              },
                            }))
                          }
                          placeholder={
                            field.zeroAsMissing && field.plausibleMin !== undefined
                              ? `0 or ${field.plausibleMin}–${field.max}`
                              : `${field.min}–${field.max}`
                          }
                          className={error ? 'input-error' : undefined}
                        />
                        {error ? (
                          <span className="error-text">{error}</span>
                        ) : (
                          <span className="help-text">{field.hint}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </section>

          <div className="submit-bar">
            <button type="submit" className="btn-primary btn-lg">
              Save &amp; Run Integrated AI Assessment →
            </button>
            <span className="submit-note">
              Patient identity and clinical assessment are persisted separately in
              PostgreSQL. All outputs require clinician review.
            </span>
          </div>
        </form>
      )}
    </div>
  )
}
