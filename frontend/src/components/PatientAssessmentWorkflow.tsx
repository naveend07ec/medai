import { useEffect, useState } from 'react'
import {
  createAssessment,
  createPatient,
  fetchAssessment,
  fetchAssessmentAttachmentImageFile,
  uploadAssessmentDocuments,
  uploadAssessmentImages,
} from '../api/clinical'
import type {
  AssessmentAttachmentRecord,
  AssessmentDraft,
  ClinicalAssessmentRecord,
  PatientRecord,
} from '../types/assessment'
import {
  computeAgeYears,
  createEmptyDraft,
  evaluateClinicalMeasurements,
  validateAssessmentDraft,
} from '../utils/assessmentValidation'

interface PatientAssessmentWorkflowProps {
  patients: PatientRecord[]
  prefillPatient: PatientRecord | null
  prefillAssessment?: ClinicalAssessmentRecord | null
  onAssessmentSaved: (
    assessment: ClinicalAssessmentRecord,
    createdPatient: PatientRecord | null,
  ) => void
  onCancel: () => void
}

type WorkflowStage = 'intake' | 'processing'

function parseMedicalHistoryNotes(rawNotes: string | null): {
  knownAllergies: string
  medicalHistoryNotes: string
} {
  if (!rawNotes) {
    return { knownAllergies: '', medicalHistoryNotes: '' }
  }
  const lines = rawNotes.split(/\r?\n/)
  const remaining: string[] = []
  let knownAllergies = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!knownAllergies && /^Known Allergies:/i.test(trimmed)) {
      knownAllergies = trimmed.replace(/^Known Allergies:\s*/i, '').trim()
    } else {
      remaining.push(line)
    }
  }

  return {
    knownAllergies,
    medicalHistoryNotes: remaining.join('\n').trim(),
  }
}

function createDraftFromAssessment(
  assessment: ClinicalAssessmentRecord,
): AssessmentDraft {
  const base = createEmptyDraft()
  const parsedHistory = parseMedicalHistoryNotes(assessment.medical_history_notes)

  return {
    ...base,
    patientInfo: {
      ...base.patientInfo,
      patientMode: 'existing',
      existingPatientId: assessment.patient_id,
      demographicsNotes: assessment.demographics_notes ?? '',
    },
    symptomsHistory: {
      currentSymptoms: assessment.current_symptoms ?? '',
      symptomDuration: assessment.symptom_duration ?? '',
      previousConditions: assessment.previous_conditions ?? '',
      existingMedications: assessment.existing_medications ?? '',
      knownAllergies: parsedHistory.knownAllergies,
      medicalHistoryNotes: parsedHistory.medicalHistoryNotes,
    },
    clinicalMeasurements: {
      systolicBp:
        assessment.systolic_bp != null ? String(assessment.systolic_bp) : '',
      diastolicBp:
        assessment.diastolic_bp != null ? String(assessment.diastolic_bp) : '',
      heartRate:
        assessment.heart_rate != null ? String(assessment.heart_rate) : '',
      bodyTemperature:
        assessment.body_temperature != null
          ? String(assessment.body_temperature)
          : '',
      oxygenSaturation:
        assessment.oxygen_saturation != null
          ? String(assessment.oxygen_saturation)
          : '',
      additionalMeasurements: assessment.additional_measurements ?? '',
    },
    medicalRecords: {
      labResults: assessment.lab_results ?? '',
      ehrSummary: assessment.ehr_summary ?? '',
      previousReports: assessment.previous_reports ?? '',
      attachedReportNames: [],
    },
    medicalImages: {
      attachedImages: [],
      imagingNotes: assessment.imaging_notes ?? '',
    },
  }
}

export function PatientAssessmentWorkflow({
  patients,
  prefillPatient,
  prefillAssessment = null,
  onAssessmentSaved,
  onCancel,
}: PatientAssessmentWorkflowProps) {
  const [draft, setDraft] = useState<AssessmentDraft>(() => {
    if (prefillAssessment) {
      return createDraftFromAssessment(prefillAssessment)
    }
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
  const [selectedDocumentFiles, setSelectedDocumentFiles] = useState<File[]>([])
  const [selectedImageFiles, setSelectedImageFiles] = useState<File[]>([])
  const [imageModality, setImageModality] = useState<'chest_xray' | 'xray'>(() => {
    const firstImg = prefillAssessment?.attachments?.find((a) => a.kind === 'image')
    return firstImg?.modality === 'xray' ? 'xray' : 'chest_xray'
  })
  const [priorDocumentNames, setPriorDocumentNames] = useState<string[]>(() => {
    if (!prefillAssessment) return []
    const attachmentDocs = (prefillAssessment.attachments ?? [])
      .filter((a) => a.kind === 'document')
      .map((a) => a.original_filename)
    return Array.from(
      new Set([...attachmentDocs, ...(prefillAssessment.attached_report_names ?? [])]),
    )
  })
  const [unavailablePriorImages, setUnavailablePriorImages] = useState<string[]>([])
  const [restoringPriorImages, setRestoringPriorImages] = useState(false)

  useEffect(() => {
    if (!prefillAssessment) return
    let active = true

    async function hydratePriorAttachments() {
      if (!prefillAssessment) return
      setRestoringPriorImages(true)

      let sourceAssessment = prefillAssessment
      try {
        sourceAssessment = await fetchAssessment(prefillAssessment.id)
      } catch {
        // Fall back to the assessment record passed from the dashboard if offline/mocked.
      }
      if (!active) return

      const attachmentDocs = (sourceAssessment.attachments ?? [])
        .filter((a) => a.kind === 'document')
        .map((a) => a.original_filename)
      setPriorDocumentNames(
        Array.from(
          new Set([
            ...attachmentDocs,
            ...(sourceAssessment.attached_report_names ?? []),
          ]),
        ),
      )

      const imageAttachments = (sourceAssessment.attachments ?? []).filter(
        (a) => a.kind === 'image',
      )

      if (imageAttachments.length === 0) {
        const legacyImageNames = (sourceAssessment.attached_images ?? []).map(
          (img) => img.name,
        )
        setUnavailablePriorImages(legacyImageNames)
        setRestoringPriorImages(false)
        return
      }

      if (imageAttachments[0]?.modality === 'xray') {
        setImageModality('xray')
      } else if (imageAttachments[0]?.modality === 'chest_xray') {
        setImageModality('chest_xray')
      }

      const restoredFiles: File[] = []
      const missingNames: string[] = []

      for (const att of imageAttachments) {
        const file = await fetchAssessmentAttachmentImageFile(
          sourceAssessment.id,
          att,
        )
        if (!active) return
        if (file) {
          restoredFiles.push(file)
        } else {
          missingNames.push(att.original_filename)
        }
      }

      if (restoredFiles.length > 0) {
        setSelectedImageFiles(restoredFiles)
        setDraft((prev) => ({
          ...prev,
          medicalImages: {
            ...prev.medicalImages,
            attachedImages: restoredFiles.map((file) => ({
              name: file.name,
              size_label: `${Math.max(1, Math.round(file.size / 1024))} KB`,
              type: file.type || 'image/png',
            })),
          },
        }))
      }
      setUnavailablePriorImages(missingNames)
      setRestoringPriorImages(false)
    }

    void hydratePriorAttachments()

    return () => {
      active = false
    }
  }, [prefillAssessment])

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

  function handleReportFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    setSelectedDocumentFiles(files)
    setDraft((prev) => ({
      ...prev,
      medicalRecords: {
        ...prev.medicalRecords,
        attachedReportNames: files.map((file) => file.name),
      },
    }))
  }

  function handleImageFilesChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    setSelectedImageFiles(files)
    setDraft((prev) => ({
      ...prev,
      medicalImages: {
        ...prev.medicalImages,
        attachedImages: files.map((file) => ({
          name: file.name,
          size_label: `${Math.max(1, Math.round(file.size / 1024))} KB`,
          type: file.type || 'image/png',
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

    if (
      validation.generalError ||
      Object.keys(validation.patientErrors).length > 0 ||
      Object.keys(validation.vitalErrors).length > 0
    ) {
      return
    }

    setStage('processing')

    let resolvedPatientId = draft.patientInfo.existingPatientId
    let newlyCreatedPatient: PatientRecord | null = null

    try {
      if (draft.patientInfo.patientMode === 'new') {
        setProcessingMessage('Saving patient record...')
        newlyCreatedPatient = await createPatient({
          full_name: draft.patientInfo.fullName.trim(),
          date_of_birth: draft.patientInfo.dateOfBirth.trim(),
          patient_code: draft.patientInfo.patientCode.trim() || undefined,
          sex: draft.patientInfo.sex.trim() || undefined,
          contact_number: draft.patientInfo.contactNumber.trim() || undefined,
        })
        resolvedPatientId = newlyCreatedPatient.id
      }

      setProcessingMessage('Saving clinical assessment...')
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
        imaging_notes: draft.medicalImages.imagingNotes.trim() || undefined,
        clinician_reviewed: false,
      })

      const uploadedAttachments: AssessmentAttachmentRecord[] = []
      if (selectedDocumentFiles.length > 0) {
        setProcessingMessage('Extracting and storing clinical documents...')
        const docs = await uploadAssessmentDocuments(
          savedAssessment.id,
          selectedDocumentFiles,
        )
        uploadedAttachments.push(...docs)
      }
      if (selectedImageFiles.length > 0) {
        setProcessingMessage('Stripping EXIF metadata and storing medical images...')
        const imgs = await uploadAssessmentImages(
          savedAssessment.id,
          selectedImageFiles,
          imageModality,
        )
        uploadedAttachments.push(...imgs)
      }

      const finalAssessment: ClinicalAssessmentRecord =
        uploadedAttachments.length > 0
          ? {
              ...savedAssessment,
              attachments: uploadedAttachments,
              attached_report_names: [
                ...new Set([
                  ...savedAssessment.attached_report_names,
                  ...uploadedAttachments
                    .filter((a) => a.kind === 'document')
                    .map((a) => a.original_filename),
                ]),
              ],
            }
          : savedAssessment

      onAssessmentSaved(finalAssessment, newlyCreatedPatient)
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
          <h2>Saving Clinical Assessment…</h2>
          <p className="processing-status-text">{processingMessage}</p>
        </section>
      ) : (
        <form onSubmit={handleAnalyzeSubmit} className="intake-form" noValidate>
          <div className="intake-intro-bar">
            <div>
              <span className="section-kicker">
                {prefillAssessment ? 'Re-assessment' : 'Patient Input'}
              </span>
              <h2>New Healthcare Analysis</h2>
              <p>
                Enter patient details, symptoms, history, and vital measurements.
              </p>
            </div>
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          </div>

          {prefillAssessment && (
            <div className="alert alert-info" role="status">
              <strong>Re-assessing from saved assessment</strong> (
              {new Date(prefillAssessment.created_at).toLocaleDateString()}).
              Available clinical details have been pre-populated. Saving will
              create a new assessment linked to this patient and preserve the
              original record.
            </div>
          )}

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

          <div className="intake-workspace-grid">
            <div className="intake-main-column">
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
              Optional — enter values from healthcare records, clinical devices, or
              authorized manual entry using the indicated units. Unusual readings display a
              non-blocking warning while physically invalid values are rejected.
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

          {/* Section D: Clinical Notes & Records (Optional) */}
          <section className="panel intake-section" aria-labelledby="sec-d-heading">
            <h3 id="sec-d-heading">D. Clinical Notes &amp; Records (Optional)</h3>
            <div className="fields-grid">
              <div className="field-group">
                <label htmlFor="mr-labs" className="field-label">
                  <span>Laboratory Results</span>
                </label>
                <textarea
                  id="mr-labs"
                  rows={2}
                  placeholder="Enter from lab reports or healthcare records (e.g., CBC, WBC, CRP, HbA1c)..."
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
                  <span>Previous Clinical Notes / EHR Summary</span>
                </label>
                <textarea
                  id="mr-ehr"
                  rows={2}
                  placeholder="Summary of prior clinical notes or reports..."
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
            </div>

            <div className="field-group">
              <label htmlFor="mr-files" className="field-label">
                <span>Upload Clinical Reports / EHR Files (Optional)</span>
                <span className="field-unit">PDF, TXT, MD, CSV, JSON</span>
              </label>
              <input
                id="mr-files"
                type="file"
                multiple
                accept=".pdf,.txt,.md,.markdown,.csv,.json"
                onChange={handleReportFilesChange}
              />
              <span className="help-text">
                Readable text is extracted, PII-filtered, and combined into the AI diagnostic
                analysis.
              </span>
              {draft.medicalRecords.attachedReportNames.length > 0 && (
                <span className="help-text">
                  Selected: {draft.medicalRecords.attachedReportNames.join(', ')}
                </span>
              )}
              {priorDocumentNames.length > 0 && (
                <span className="help-text">
                  Previous assessment document reference(s):{' '}
                  {priorDocumentNames.join(', ')} — re-upload file(s) above if
                  needed for fresh extraction.
                </span>
              )}
            </div>
          </section>

          {/* Section E: Medical Image Input (Optional — Chest / X-Ray) */}
          <section className="panel intake-section" aria-labelledby="sec-e-heading">
            <h3 id="sec-e-heading">E. Medical Image Input (Optional — Chest / X-Ray)</h3>
            <div className="fields-grid">
              <div className="field-group">
                <label htmlFor="mi-modality" className="field-label">
                  <span>Image Modality</span>
                </label>
                <select
                  id="mi-modality"
                  value={imageModality}
                  onChange={(e) =>
                    setImageModality(e.target.value as 'chest_xray' | 'xray')
                  }
                >
                  <option value="chest_xray">Chest X-Ray</option>
                  <option value="xray">Other X-Ray</option>
                </select>
                <span className="help-text">
                  MRI and CT volumetric formats are not yet supported.
                </span>
              </div>

              <div className="field-group">
                <label htmlFor="mi-files" className="field-label">
                  <span>Upload Medical Image</span>
                  <span className="field-unit">PNG / JPEG (max 10 MB)</span>
                </label>
                <input
                  id="mi-files"
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  onChange={handleImageFilesChange}
                />
                <span className="help-text">
                  EXIF metadata is stripped automatically before AI vision observation.
                </span>
                {restoringPriorImages && (
                  <span className="help-text">
                    Checking prior assessment medical image(s)…
                  </span>
                )}
                {selectedImageFiles.length > 0 && (
                  <span className="help-text">
                    Selected: {selectedImageFiles.map((f) => f.name).join(', ')}
                  </span>
                )}
                {unavailablePriorImages.length > 0 && (
                  <span className="warning-text" role="status">
                    Previous image(s) no longer available and need to be uploaded
                    again: {unavailablePriorImages.join(', ')}.
                  </span>
                )}
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="mi-notes" className="field-label">
                <span>Imaging Context Notes (Optional)</span>
              </label>
              <input
                id="mi-notes"
                type="text"
                placeholder="e.g., Portable PA chest X-ray taken after 3 days of fever and cough"
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

          <div className="submit-bar">
            <button type="submit" className="btn-primary btn-lg">
              Save &amp; Continue to Diagnostic Output →
            </button>
            <span className="submit-note">
              Saved securely in PostgreSQL. Diagnostic output requires clinician review.
            </span>
          </div>
            </div>

            {/* Digcy-Inspired Clinical Profile & Live Anatomy Sidebar */}
            <aside className="intake-summary-aside" aria-label="Live patient profile preview">
              <div className="panel clinical-profile-preview">
                <div className="clinical-profile-head">
                  <div className="patient-monogram" aria-hidden="true">
                    {(
                      (selectedExistingPatient
                        ? selectedExistingPatient.full_name
                        : draft.patientInfo.fullName
                      ).trim() || 'P'
                    )
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div>
                    <span className="section-kicker">Patient Profile</span>
                    <h3>
                      {(selectedExistingPatient
                        ? selectedExistingPatient.full_name
                        : draft.patientInfo.fullName
                      ).trim() || 'New Patient Entry'}
                    </h3>
                    <p className="clinical-profile-meta">
                      {(selectedExistingPatient
                        ? selectedExistingPatient.sex
                        : draft.patientInfo.sex
                      ) || 'Sex unspecified'}
                      {' · '}
                      DOB:{' '}
                      {(selectedExistingPatient
                        ? selectedExistingPatient.date_of_birth
                        : draft.patientInfo.dateOfBirth
                      ) || 'Not entered'}
                    </p>
                  </div>
                </div>

                <div className="live-vitals-chips" aria-label="Entered measurements summary">
                  <div className="vital-chip">
                    <span>Blood Pressure</span>
                    <strong>
                      {draft.clinicalMeasurements.systolicBp ||
                      draft.clinicalMeasurements.diastolicBp
                        ? `${draft.clinicalMeasurements.systolicBp || '—'}/${draft.clinicalMeasurements.diastolicBp || '—'} mm Hg`
                        : 'Not entered'}
                    </strong>
                  </div>
                  <div className="vital-chip">
                    <span>Heart Rate</span>
                    <strong>
                      {draft.clinicalMeasurements.heartRate
                        ? `${draft.clinicalMeasurements.heartRate} bpm`
                        : 'Not entered'}
                    </strong>
                  </div>
                  <div className="vital-chip">
                    <span>Temperature</span>
                    <strong>
                      {draft.clinicalMeasurements.bodyTemperature
                        ? `${draft.clinicalMeasurements.bodyTemperature} °C`
                        : 'Not entered'}
                    </strong>
                  </div>
                  <div className="vital-chip">
                    <span>SpO₂</span>
                    <strong>
                      {draft.clinicalMeasurements.oxygenSaturation
                        ? `${draft.clinicalMeasurements.oxygenSaturation}%`
                        : 'Not entered'}
                    </strong>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </form>
      )}
    </div>
  )
}
