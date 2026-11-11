import type {
  DiabetesPredictionInput,
  DiabetesPredictionResponse,
} from './prediction'

export type AppRoute =
  | 'dashboard'
  | 'new-assessment'
  | 'patient-records'
  | 'assessment-history'
  | 'research-info'

export interface PatientRecord {
  id: string
  patient_code: string
  full_name: string
  date_of_birth: string
  sex: string | null
  contact_number: string | null
  created_at: string
  updated_at: string | null
}

export interface PatientCreatePayload {
  full_name: string
  date_of_birth: string
  patient_code?: string
  sex?: string
  contact_number?: string
}

export interface AttachedImageMetadata {
  name: string
  size_label: string
  type: string
}

export interface PreprocessingSummary {
  providedModalities: string[]
  missingModalities: string[]
  validatedMeasurementsCount: number
  unusualMeasurementWarnings?: string[]
  imputationAppliedNote: string | null
}

export interface PredictiveExperimentOutcome {
  executed: boolean
  status: 'completed' | 'not-requested' | 'unavailable' | 'error'
  result: DiabetesPredictionResponse | null
  message: string
}

export interface DiagnosticConsideration {
  condition_or_pattern: string
  supporting_observed_evidence: string[]
  rationale: string
  uncertainty_note: string
}

export interface MedicalReferenceItem {
  title: string
  source: string
  guideline_or_citation: string
  relevance_note: string
}

export interface TreatmentSupportSection {
  grounded_in_verified_references: boolean
  retrieved_references: MedicalReferenceItem[]
  guidance_items: string[]
  status_note: string
}

export interface PredictiveExperimentReference {
  included: boolean
  module_name: string | null
  summary: string
}

export interface DiagnosticReportContent {
  patient_clinical_summary: string
  available_clinical_findings: string[]
  ai_generated_diagnostic_insights: string
  possible_diagnostic_considerations: DiagnosticConsideration[]
  missing_information_and_uncertainty: string[]
  further_clinical_evaluation_considerations: string[]
  personalized_treatment_support: TreatmentSupportSection
  clinician_review_and_safety_disclaimer: string
  predictive_model_separation_note: PredictiveExperimentReference
  research_context_note: string
}

export interface DiagnosticReportRecord {
  id: string
  assessment_id: string
  provider: string
  model_name: string
  report: DiagnosticReportContent
  clinician_reviewed: boolean
  clinician_notes: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface GenAIHealthStatus {
  status: 'ready' | 'unavailable'
  provider: string
  model_name: string
  rag_connected: boolean
  detail: string | null
}

export interface ClinicalAssessmentRecord {
  id: string
  patient_id: string
  demographics_notes: string | null
  current_symptoms: string | null
  symptom_duration: string | null
  previous_conditions: string | null
  existing_medications: string | null
  medical_history_notes: string | null
  systolic_bp: number | null
  diastolic_bp: number | null
  heart_rate: number | null
  body_temperature: number | null
  oxygen_saturation: number | null
  additional_measurements: string | null
  lab_results: string | null
  ehr_summary: string | null
  previous_reports: string | null
  attached_report_names: string[]
  attached_images: AttachedImageMetadata[]
  imaging_notes: string | null
  genomic_notes: string | null
  family_history_markers: string | null
  preprocessing_summary: PreprocessingSummary | null
  predictive_experiment_result: PredictiveExperimentOutcome | null
  clinician_reviewed: boolean
  created_at: string
  updated_at: string
  patient: PatientRecord | null
}

export interface ClinicalAssessmentCreatePayload {
  patient_id: string
  demographics_notes?: string
  current_symptoms?: string
  symptom_duration?: string
  previous_conditions?: string
  existing_medications?: string
  medical_history_notes?: string
  systolic_bp?: number
  diastolic_bp?: number
  heart_rate?: number
  body_temperature?: number
  oxygen_saturation?: number
  additional_measurements?: string
  lab_results?: string
  ehr_summary?: string
  previous_reports?: string
  attached_report_names: string[]
  attached_images: AttachedImageMetadata[]
  imaging_notes?: string
  genomic_notes?: string
  family_history_markers?: string
  preprocessing_summary: PreprocessingSummary
  predictive_experiment_result: PredictiveExperimentOutcome
  clinician_reviewed: boolean
}

export interface PatientInfoInput {
  patientMode: 'new' | 'existing'
  existingPatientId: string
  patientCode: string
  fullName: string
  dateOfBirth: string
  sex: string
  contactNumber: string
  demographicsNotes: string
}

export interface SymptomsHistoryInput {
  currentSymptoms: string
  symptomDuration: string
  previousConditions: string
  existingMedications: string
  knownAllergies: string
  medicalHistoryNotes: string
}

export interface ClinicalMeasurementsInput {
  systolicBp: string
  diastolicBp: string
  heartRate: string
  bodyTemperature: string
  oxygenSaturation: string
  additionalMeasurements: string
}

export interface MedicalRecordsInput {
  labResults: string
  ehrSummary: string
  previousReports: string
  attachedReportNames: string[]
}

export interface MedicalImagesInput {
  attachedImages: AttachedImageMetadata[]
  imagingNotes: string
}

export interface GenomicInfoInput {
  genomicNotes: string
  familyHistoryMarkers: string
}

export interface AssessmentDraft {
  patientInfo: PatientInfoInput
  symptomsHistory: SymptomsHistoryInput
  clinicalMeasurements: ClinicalMeasurementsInput
  medicalRecords: MedicalRecordsInput
  medicalImages: MedicalImagesInput
  genomicInfo: GenomicInfoInput
  includeDiabetesExperiment: boolean
  diabetesFeatures: Record<keyof DiabetesPredictionInput, string>
}
