import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { fetchGenAIHealth, submitRagQuery } from '../api/clinical'
import {
  fetchKnowledgeDocuments,
  fetchKnowledgeStatus,
  uploadKnowledgeDocument,
} from '../api/knowledge'
import type {
  GenAIHealthStatus,
  KnowledgeBaseStatus,
  KnowledgeDocumentIngestResponse,
  KnowledgeDocumentRecord,
  RagQueryResponse,
} from '../types/assessment'
import { sanitizeClinicalAiText } from '../utils/aiTextSanitizer'
import { DiagnosticReportDisplay } from './DiagnosticReportDisplay'
import { EmergencyAlertBanner } from './EmergencyAlertBanner'

const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md']
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

function getSafeUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function isSupportedDocumentFile(file: File): boolean {
  const lower = file.name.toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function KnowledgeBaseView() {
  const [kbStatus, setKbStatus] = useState<KnowledgeBaseStatus | null>(null)
  const [genaiHealth, setGenaiHealth] = useState<GenAIHealthStatus | null>(null)
  const [documents, setDocuments] = useState<KnowledgeDocumentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [sourcePublisher, setSourcePublisher] = useState('')
  const [publicationDate, setPublicationDate] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadStage, setUploadStage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] =
    useState<KnowledgeDocumentIngestResponse | null>(null)

  // Grounded RAG Clinical Q&A state
  const [question, setQuestion] = useState('')
  const [clinicalContext, setClinicalContext] = useState('')
  const [querying, setQuerying] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [ragResponse, setRagResponse] = useState<RagQueryResponse | null>(null)

  const refreshKnowledgeBase = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [statusData, docsData, healthData] = await Promise.all([
        fetchKnowledgeStatus(),
        fetchKnowledgeDocuments(),
        fetchGenAIHealth().catch(() => null),
      ])
      setKbStatus(statusData)
      setDocuments(docsData)
      setGenaiHealth(healthData)
    } catch (err: unknown) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Unable to load Medical Knowledge Base status and documents.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true

    Promise.all([
      fetchKnowledgeStatus(),
      fetchKnowledgeDocuments(),
      fetchGenAIHealth().catch(() => null),
    ])
      .then(([statusData, docsData, healthData]) => {
        if (!active) return
        setKbStatus(statusData)
        setDocuments(docsData)
        setGenaiHealth(healthData)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Unable to load Medical Knowledge Base status and documents.',
        )
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  async function handleUploadSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setUploadError(null)
    setUploadSuccess(null)

    if (!selectedFile) {
      setUploadError('Select a PDF, TXT, or Markdown medical reference file.')
      return
    }
    if (!isSupportedDocumentFile(selectedFile)) {
      setUploadError(
        'Unsupported file type. Only .pdf, .txt, and .md documents are supported.',
      )
      return
    }
    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setUploadError('Selected file exceeds the 10 MB upload size limit.')
      return
    }
    if (title.trim().length < 2) {
      setUploadError('Enter a document title (at least 2 characters).')
      return
    }
    if (sourcePublisher.trim().length < 2) {
      setUploadError('Enter a source publisher name (at least 2 characters).')
      return
    }

    setUploading(true)
    setUploadStage(
      'Uploading file, extracting text, chunking, and generating vector embeddings…',
    )
    try {
      const result = await uploadKnowledgeDocument({
        file: selectedFile,
        title,
        sourcePublisher,
        publicationDate: publicationDate || undefined,
        sourceUrl: sourceUrl || undefined,
      })
      setUploadSuccess(result)
      setUploadStage('Document indexed and persisted in PostgreSQL.')
      setSelectedFile(null)
      setTitle('')
      setSourcePublisher('')
      setPublicationDate('')
      setSourceUrl('')
      await refreshKnowledgeBase()
    } catch (err: unknown) {
      setUploadStage(null)
      setUploadError(
        err instanceof Error
          ? err.message
          : 'Failed to ingest reference document.',
      )
    } finally {
      setUploading(false)
    }
  }

  async function handleRagQuerySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQueryError(null)
    setRagResponse(null)

    if (question.trim().length < 3) {
      setQueryError('Enter a clinical question of at least 3 characters.')
      return
    }

    setQuerying(true)
    try {
      const response = await submitRagQuery({
        question: question.trim(),
        clinical_context: clinicalContext.trim() || undefined,
      })
      setRagResponse(response)
    } catch (err: unknown) {
      setQueryError(
        err instanceof Error
          ? err.message
          : 'Unable to complete the clinical RAG query.',
      )
    } finally {
      setQuerying(false)
    }
  }

  return (
    <div className="records-container">
      <div className="section-page-header">
        <div>
          <h2>Medical Knowledge Base &amp; Grounded RAG Q&amp;A</h2>
          <p>
            Manage approved PDF, TXT, and Markdown medical guidelines stored in
            PostgreSQL with vector embeddings for citation-verified clinical RAG.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void refreshKnowledgeBase()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh Knowledge Status'}
        </button>
      </div>

      {loadError && (
        <div className="alert alert-error" role="alert">
          <strong>Backend Connection Error:</strong> {loadError}
        </div>
      )}

      {/* Knowledge Base Readiness & Metrics */}
      <section className="panel" aria-labelledby="kb-status-heading">
        <div className="card-header-row">
          <h3 id="kb-status-heading">Knowledge Base &amp; Embedding Status</h3>
          <div className="status-controls">
            {kbStatus?.embedding_service_ready ? (
              <span className="status-pill status-ready">Embeddings Ready</span>
            ) : (
              <span className="status-pill status-warn">
                Embeddings Unavailable
              </span>
            )}
            {genaiHealth?.status === 'ready' ? (
              <span className="status-pill status-ready">Clinical AI Ready</span>
            ) : (
              <span className="status-pill status-warn">Clinical AI Unavailable</span>
            )}
          </div>
        </div>

        <div className="system-readiness-line">
          <span>
            <strong>Documents:</strong> {kbStatus ? kbStatus.document_count : '—'}
          </span>
          <span>
            <strong>Indexed Chunks:</strong> {kbStatus ? kbStatus.chunk_count : '—'}
          </span>
          <span>
            <strong>Embeddings:</strong>{' '}
            {kbStatus
              ? `${sanitizeClinicalAiText(kbStatus.embedding_model)} (${kbStatus.embedding_dimension}d)`
              : '—'}
          </span>
          <span>
            <strong>Backend:</strong>{' '}
            {kbStatus
              ? `${kbStatus.vector_store_backend} • top-${kbStatus.top_k_default} ≥ ${kbStatus.min_similarity_default}`
              : '—'}
          </span>
        </div>

        {genaiHealth?.detail && (
          <p className="record-subtext" style={{ marginTop: '0.65rem' }}>
            {genaiHealth.detail}
          </p>
        )}
      </section>

      <div className="kb-two-column">
        {/* Upload Reference Document */}
        <section className="panel" aria-labelledby="kb-upload-heading">
          <h3 id="kb-upload-heading">Upload Public Medical Reference</h3>
          <p className="record-subtext">
            Accepts PDF, TXT, or Markdown files up to 10 MB. Duplicate content
            hashes are rejected automatically.
          </p>

          <form
            className="kb-upload-form"
            onSubmit={handleUploadSubmit}
            noValidate
          >
            <div className="form-field">
              <label htmlFor="kb-file-input" className="field-label">
                Reference File (.pdf, .txt, .md) *
              </label>
              <input
                id="kb-file-input"
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                onChange={(e) => {
                  const nextFile = e.target.files?.[0] ?? null
                  setSelectedFile(nextFile)
                }}
              />
            </div>

            <div className="form-field">
              <label htmlFor="kb-title-input" className="field-label">
                Document Title *
              </label>
              <input
                id="kb-title-input"
                type="text"
                placeholder="e.g., NIDDK Diabetes Tests & Diagnosis Guidelines"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="form-field">
              <label htmlFor="kb-publisher-input" className="field-label">
                Source Publisher *
              </label>
              <input
                id="kb-publisher-input"
                type="text"
                placeholder="e.g., National Institute of Diabetes and Digestive and Kidney Diseases"
                value={sourcePublisher}
                onChange={(e) => setSourcePublisher(e.target.value)}
              />
            </div>

            <div className="kb-inline-fields">
              <div className="form-field">
                <label htmlFor="kb-date-input" className="field-label">
                  Publication Date (Optional)
                </label>
                <input
                  id="kb-date-input"
                  type="date"
                  value={publicationDate}
                  onChange={(e) => setPublicationDate(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label htmlFor="kb-url-input" className="field-label">
                  Source URL (Optional)
                </label>
                <input
                  id="kb-url-input"
                  type="url"
                  placeholder="https://www.niddk.nih.gov/..."
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
              </div>
            </div>

            {uploading && uploadStage && (
              <div className="info-banner" role="status">
                <div className="upload-progress-bar" aria-hidden="true">
                  <div className="upload-progress-indeterminate" />
                </div>
                <span>{uploadStage}</span>
              </div>
            )}

            {uploadError && (
              <div className="alert alert-error" role="alert">
                <strong>Upload Failed:</strong> {uploadError}
              </div>
            )}

            {uploadSuccess && (
              <div className="alert alert-success" role="status">
                <strong>Document Ingested:</strong>{' '}
                {uploadSuccess.document.title} — created{' '}
                {uploadSuccess.chunks_created} chunk(s) using{' '}
                {sanitizeClinicalAiText(uploadSuccess.embedding_model)} (
                {uploadSuccess.embedding_dimension}d).
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={uploading}
            >
              {uploading
                ? 'Ingesting & Embedding Document…'
                : 'Upload & Index Document'}
            </button>
          </form>
        </section>

        {/* Grounded Clinical RAG Query Panel */}
        <section className="panel" aria-labelledby="kb-qa-heading">
          <h3 id="kb-qa-heading">Clinical RAG Decision-Support Query</h3>
          <p className="record-subtext">
            Queries undergo emergency red-flag screening before external Clinical AI
            calls. Only verified stored chunk IDs are cited.
          </p>

          <form
            className="kb-upload-form"
            onSubmit={handleRagQuerySubmit}
            noValidate
          >
            <div className="form-field">
              <label htmlFor="rag-question-input" className="field-label">
                Clinical Question *
              </label>
              <textarea
                id="rag-question-input"
                rows={3}
                placeholder="e.g., What confirmatory testing is recommended when fasting plasma glucose is 132 mg/dL?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </div>

            <div className="form-field">
              <label htmlFor="rag-context-input" className="field-label">
                De-Identified Clinical Context (Optional — do not enter names/IDs)
              </label>
              <textarea
                id="rag-context-input"
                rows={2}
                placeholder="e.g., Adult with no prior diabetes diagnosis, fasting glucose 132 mg/dL."
                value={clinicalContext}
                onChange={(e) => setClinicalContext(e.target.value)}
              />
            </div>

            {queryError && (
              <div className="alert alert-error" role="alert">
                <strong>Query Failed:</strong> {queryError}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={querying}
            >
              {querying
                ? 'Running Safety Screen & RAG…'
                : 'Run Grounded RAG Query'}
            </button>
          </form>

          {ragResponse && (
            <div className="rag-qa-result">
              {ragResponse.status === 'emergency_warning_only' && (
                <EmergencyAlertBanner
                  alert={ragResponse.emergency_alert}
                  generatedByGemini={ragResponse.generated_by_gemini}
                  notice={sanitizeClinicalAiText(ragResponse.notice)}
                />
              )}

              {ragResponse.report && (
                <DiagnosticReportDisplay
                  report={ragResponse.report}
                  sourceLabel={`Clinical RAG Q&A (${sanitizeClinicalAiText(ragResponse.model_name)})`}
                />
              )}
            </div>
          )}
        </section>
      </div>

      {/* Indexed Knowledge Documents Table */}
      <section className="panel table-panel" aria-labelledby="kb-docs-heading">
        <div className="card-header-row" style={{ padding: '0.5rem 0.25rem' }}>
          <h3 id="kb-docs-heading">
            Indexed Medical Reference Documents ({documents.length})
          </h3>
        </div>

        {loading && documents.length === 0 ? (
          <div className="empty-card-state">
            <p>Loading indexed knowledge documents from PostgreSQL…</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="empty-card-state">
            <p>
              No medical reference documents indexed yet. Upload a PDF, TXT, or
              Markdown clinical guideline above to enable RAG citations.
            </p>
          </div>
        ) : (
          <table className="clinical-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Publisher</th>
                <th>File / Type</th>
                <th>Chunks</th>
                <th>Hash</th>
                <th>Indexed</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const safeLink = getSafeUrl(doc.source_url)
                return (
                  <tr key={doc.id}>
                    <td>
                      <strong>{doc.title}</strong>
                    </td>
                    <td>{doc.source_publisher}</td>
                    <td>
                      {doc.file_name || '—'}{' '}
                      <span className="record-subtext">
                        ({doc.content_type || 'unknown'})
                      </span>
                    </td>
                    <td>{doc.chunk_count}</td>
                    <td>
                      <code>{doc.content_hash.slice(0, 10)}</code>
                    </td>
                    <td>{new Date(doc.created_at).toLocaleString()}</td>
                    <td>
                      {safeLink ? (
                        <a
                          href={safeLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="source-link"
                        >
                          Source
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
