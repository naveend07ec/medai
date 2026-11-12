import type {
  DiabetesPredictionInput,
  DiabetesPredictionResponse,
} from './prediction'

export type AppRoute = 'dashboard' | 'new-assessment' | 'knowledge-base'

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
  plain_language_explanation?: string | null
  why_findings_point_here?: string | null
  supporting_observed_evidence: string[]
  cited_chunk_ids: string[]
  rationale: string
  uncertainty_note: string
}

export interface FindingExplanation {
  finding_name: string
  observed_value: string
  reference_range_note: string
  status_flag:
    | 'within_range'
    | 'outside_range'
    | 'reported_symptom'
    | 'needs_confirmation'
  plain_language_meaning: string
  why_it_matters: string
}

export interface RetrievedSourceItem {
  chunk_id: string
  document_id: string
  document_title: string
  source_publisher: string
  publication_date: string | null
  source_url: string | null
  section_heading: string | null
  page_number: number | null
  similarity_score: number
  excerpt: string
}

export interface TreatmentAndManagementSection {
  grounded_in_verified_references: boolean
  guidance_items: string[]
  cited_chunk_ids: string[]
  status_note: string
  clinician_review_required: boolean
}

export interface EmergencyAlert {
  emergency_detected: boolean
  urgency_level: 'emergency' | 'standard'
  matched_patterns: string[]
  emergency_guidance: string | null
  triage_disclaimer: string
}

export interface PredictiveExperimentReference {
  included: boolean
  module_name: string | null
  summary: string
  limitations: string
}

export interface DocumentExtractionSummary {
  file_name: string
  extraction_status: string
  summary_note: string | null
  extracted_excerpt: string | null
}

export interface MedicalImageObservation {
  image_name: string
  modality: string
  processing_status: 'analyzed' | 'unreadable' | 'not_provided'
  visibly_observed: string[]
  possible_indications: string[]
  uncertainties: string[]
  clinician_verification_needed: string
  limitation_note: string
}

export interface DiagnosticReportContent {
  patient_context_summary: string
  relevant_clinical_findings: string[]
  finding_explanations?: FindingExplanation[]
  extracted_document_summaries?: DocumentExtractionSummary[]
  image_observations?: MedicalImageObservation[]
  possible_diagnostic_considerations: DiagnosticConsideration[]
  supporting_medical_evidence: string
  additional_information_required: string[]
  doctor_discussion_points?: string[]
  risk_indicators_and_safety_warnings: string[]
  treatment_and_management_information: TreatmentAndManagementSection
  clinical_limitations: string[]
  retrieved_sources: RetrievedSourceItem[]
  emergency_alert: EmergencyAlert
  evidence_sufficient: boolean
  generated_by_gemini: boolean
  predictive_ml_output: PredictiveExperimentReference
  research_context_note: string
  clinician_review_disclaimer: string
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
  embedding_model: string
  rag_connected: boolean
  indexed_documents: number
  indexed_chunks: number
  demo_mode: boolean
  detail: string | null
}

export interface RagQueryRequest {
  question: string
  clinical_context?: string
  top_k?: number
  min_similarity?: number
}

export interface RagQueryResponse {
  status: 'completed' | 'emergency_warning_only'
  generated_by_gemini: boolean
  gemini_available: boolean
  provider: string
  model_name: string
  emergency_alert: EmergencyAlert
  report: DiagnosticReportContent | null
  notice: string | null
}

export interface KnowledgeDocumentRecord {
  id: string
  title: string
  source_publisher: string
  publication_date: string | null
  source_url: string | null
  file_name: string | null
  content_type: string | null
  content_hash: string
  chunk_count: number
  created_at: string
  updated_at: string
}

export interface KnowledgeDocumentIngestResponse {
  document: KnowledgeDocumentRecord
  chunks_created: number
  embedding_model: string
  embedding_dimension: number
}

export interface KnowledgeBaseStatus {
  vector_store_backend: string
  document_count: number
  chunk_count: number
  embedding_model: string
  embedding_dimension: number
  embedding_service_ready: boolean
  top_k_default: number
  min_similarity_default: number
}

export interface AssessmentAttachmentRecord {
  id: string
  assessment_id: string
  kind: 'document' | 'image' | string
  original_filename: string
  mime_type: string
  size_bytes: number
  modality: string
  extraction_status: string
  extracted_text: string | null
  extraction_note: string | null
  exif_stripped: boolean
  created_at: string
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
  attachments?: AssessmentAttachmentRecord[]
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
  attached_images?: AttachedImageMetadata[]
  imaging_notes?: string
  genomic_notes?: string
  family_history_markers?: string
  preprocessing_summary?: PreprocessingSummary | null
  predictive_experiment_result?: PredictiveExperimentOutcome | null
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
