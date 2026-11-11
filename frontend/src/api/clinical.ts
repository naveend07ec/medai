import type {
  ClinicalAssessmentCreatePayload,
  ClinicalAssessmentRecord,
  DiagnosticReportRecord,
  GenAIHealthStatus,
  PatientCreatePayload,
  PatientRecord,
} from '../types/assessment'
import { API_BASE_URL, extractErrorMessage, requestJson } from './client'

export async function fetchPatients(): Promise<PatientRecord[]> {
  return requestJson<PatientRecord[]>('/api/v1/patients', { method: 'GET' })
}

export async function createPatient(
  payload: PatientCreatePayload,
): Promise<PatientRecord> {
  return requestJson<PatientRecord>('/api/v1/patients', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchPatientByCode(
  patientCode: string,
): Promise<PatientRecord> {
  return requestJson<PatientRecord>(
    `/api/v1/patients/by-code/${encodeURIComponent(patientCode.trim())}`,
    { method: 'GET' },
  )
}

export async function fetchAssessments(
  patientId?: string,
): Promise<ClinicalAssessmentRecord[]> {
  const query = patientId
    ? `?patient_id=${encodeURIComponent(patientId)}`
    : ''
  return requestJson<ClinicalAssessmentRecord[]>(
    `/api/v1/assessments${query}`,
    { method: 'GET' },
  )
}

export async function createAssessment(
  payload: ClinicalAssessmentCreatePayload,
): Promise<ClinicalAssessmentRecord> {
  return requestJson<ClinicalAssessmentRecord>('/api/v1/assessments', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateAssessmentReview(
  assessmentId: string,
  clinicianReviewed: boolean,
): Promise<ClinicalAssessmentRecord> {
  return requestJson<ClinicalAssessmentRecord>(
    `/api/v1/assessments/${encodeURIComponent(assessmentId)}/review`,
    {
      method: 'PATCH',
      body: JSON.stringify({ clinician_reviewed: clinicianReviewed }),
    },
  )
}

export async function fetchGenAIHealth(): Promise<GenAIHealthStatus> {
  return requestJson<GenAIHealthStatus>('/api/v1/assessments/genai/health', {
    method: 'GET',
  })
}

export async function generateAssessmentReport(
  assessmentId: string,
): Promise<DiagnosticReportRecord> {
  return requestJson<DiagnosticReportRecord>(
    `/api/v1/assessments/${encodeURIComponent(assessmentId)}/generate-report`,
    { method: 'POST' },
  )
}

export async function fetchAssessmentReport(
  assessmentId: string,
): Promise<DiagnosticReportRecord | null> {
  let response: Response
  try {
    response = await fetch(
      `${API_BASE_URL}/api/v1/assessments/${encodeURIComponent(assessmentId)}/report`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
    )
  } catch {
    throw new Error(
      'Unable to connect to the backend API. Confirm FastAPI is running.',
    )
  }

  if (response.status === 404) {
    return null
  }

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      extractErrorMessage(
        data,
        `Failed to load diagnostic report (HTTP ${response.status}).`,
      ),
    )
  }

  return data as DiagnosticReportRecord
}

export async function reviewAssessmentReport(
  assessmentId: string,
  clinicianReviewed: boolean,
  clinicianNotes?: string,
): Promise<DiagnosticReportRecord> {
  return requestJson<DiagnosticReportRecord>(
    `/api/v1/assessments/${encodeURIComponent(assessmentId)}/report/review`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        clinician_reviewed: clinicianReviewed,
        clinician_notes: clinicianNotes?.trim() || null,
      }),
    },
  )
}
