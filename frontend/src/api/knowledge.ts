import type {
  KnowledgeBaseStatus,
  KnowledgeDocumentIngestResponse,
  KnowledgeDocumentRecord,
} from '../types/assessment'
import { requestFormData, requestJson } from './client'

export interface KnowledgeUploadInput {
  file: File
  title: string
  sourcePublisher: string
  publicationDate?: string
  sourceUrl?: string
}

export async function fetchKnowledgeStatus(): Promise<KnowledgeBaseStatus> {
  return requestJson<KnowledgeBaseStatus>('/api/v1/knowledge/status', {
    method: 'GET',
  })
}

export async function fetchKnowledgeDocuments(): Promise<
  KnowledgeDocumentRecord[]
> {
  return requestJson<KnowledgeDocumentRecord[]>('/api/v1/knowledge/documents', {
    method: 'GET',
  })
}

export async function uploadKnowledgeDocument(
  input: KnowledgeUploadInput,
): Promise<KnowledgeDocumentIngestResponse> {
  const formData = new FormData()
  formData.append('file', input.file)
  formData.append('title', input.title.trim())
  formData.append('source_publisher', input.sourcePublisher.trim())

  if (input.publicationDate && input.publicationDate.trim()) {
    formData.append('publication_date', input.publicationDate.trim())
  }
  if (input.sourceUrl && input.sourceUrl.trim()) {
    formData.append('source_url', input.sourceUrl.trim())
  }

  return requestFormData<KnowledgeDocumentIngestResponse>(
    '/api/v1/knowledge/documents',
    formData,
    'Unable to upload medical reference document. Confirm FastAPI is running.',
    90000,
  )
}

