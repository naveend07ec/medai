import type {
  AssessmentAttachmentRecord,
  ClinicalAssessmentCreatePayload,
  ClinicalAssessmentRecord,
  DiagnosticReportRecord,
  GenAIHealthStatus,
  PatientCreatePayload,
  PatientRecord,
  RagQueryRequest,
  RagQueryResponse,
} from '../types/assessment'
import {
  API_BASE_URL,
  ApiRequestError,
  extractErrorMessage,
  requestJson,
} from './client'

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

export async function fetchAssessment(
  assessmentId: string,
): Promise<ClinicalAssessmentRecord> {
  return requestJson<ClinicalAssessmentRecord>(
    `/api/v1/assessments/${encodeURIComponent(assessmentId)}`,
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
  return requestJson<GenAIHealthStatus>('/api/v1/genai/health', {
    method: 'GET',
  })
}

export async function generateAssessmentReport(
  assessmentId: string,
): Promise<DiagnosticReportRecord> {
  return requestJson<DiagnosticReportRecord>(
    `/api/v1/assessments/${encodeURIComponent(assessmentId)}/generate-report`,
    { method: 'POST' },
    'Unable to reach the GenAI diagnostic report endpoint. Confirm FastAPI is running.',
    60000,
  )
}

export async function fetchAssessmentReport(
  assessmentId: string,
): Promise<DiagnosticReportRecord | null> {
  const controller = new AbortController()
  const timerId = setTimeout(() => controller.abort(), 15000)

  let response: Response
  try {
    response = await fetch(
      `${API_BASE_URL}/api/v1/assessments/${encodeURIComponent(assessmentId)}/report`,
      {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      },
    )
  } catch (err: unknown) {
    clearTimeout(timerId)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiRequestError(
        'Timed out while loading the saved diagnostic report.',
        408,
      )
    }
    throw new ApiRequestError(
      'Unable to connect to the backend API. Confirm FastAPI is running.',
      0,
    )
  } finally {
    clearTimeout(timerId)
  }

  if (response.status === 404) {
    return null
  }

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiRequestError(
      extractErrorMessage(
        data,
        `Failed to load diagnostic report (HTTP ${response.status}).`,
      ),
      response.status,
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

export async function submitRagQuery(
  payload: RagQueryRequest,
): Promise<RagQueryResponse> {
  return requestJson<RagQueryResponse>(
    '/api/v1/rag/query',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Unable to reach the clinical RAG query endpoint. Confirm FastAPI is running.',
    60000,
  )
}

export async function uploadAssessmentDocuments(
  assessmentId: string,
  files: File[],
): Promise<AssessmentAttachmentRecord[]> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }

  const response = await fetch(
    `${API_BASE_URL}/api/v1/assessments/${encodeURIComponent(assessmentId)}/documents`,
    {
      method: 'POST',
      body: formData,
    },
  )
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiRequestError(
      extractErrorMessage(
        data,
        `Failed to upload clinical documents (HTTP ${response.status}).`,
      ),
      response.status,
    )
  }
  return data as AssessmentAttachmentRecord[]
}

export async function uploadAssessmentImages(
  assessmentId: string,
  files: File[],
  modality = 'chest_xray',
): Promise<AssessmentAttachmentRecord[]> {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  formData.append('modality', modality)

  const response = await fetch(
    `${API_BASE_URL}/api/v1/assessments/${encodeURIComponent(assessmentId)}/images`,
    {
      method: 'POST',
      body: formData,
    },
  )
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiRequestError(
      extractErrorMessage(
        data,
        `Failed to upload medical images (HTTP ${response.status}).`,
      ),
      response.status,
    )
  }
  return data as AssessmentAttachmentRecord[]
}

export function getAssessmentAttachmentImageUrl(
  assessmentId: string,
  attachmentId: string,
): string {
  return `${API_BASE_URL}/api/v1/assessments/${encodeURIComponent(assessmentId)}/attachments/${encodeURIComponent(attachmentId)}/content`
}

export async function fetchAssessmentAttachmentImageFile(
  assessmentId: string,
  attachment: AssessmentAttachmentRecord,
): Promise<File | null> {
  try {
    const response = await fetch(
      getAssessmentAttachmentImageUrl(assessmentId, attachment.id),
      { method: 'GET' },
    )
    if (!response.ok) {
      return null
    }
    const blob = await response.blob()
    if (!blob || blob.size === 0) {
      return null
    }
    return new File([blob], attachment.original_filename, {
      type: attachment.mime_type || blob.type || 'image/png',
    })
  } catch {
    return null
  }
}
