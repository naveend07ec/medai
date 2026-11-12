import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { KnowledgeBaseView } from '../components/KnowledgeBaseView'
import type {
  GenAIHealthStatus,
  KnowledgeBaseStatus,
  KnowledgeDocumentRecord,
  RagQueryResponse,
} from '../types/assessment'

const SAMPLE_KB_STATUS: KnowledgeBaseStatus = {
  vector_store_backend: 'postgres_numpy',
  document_count: 1,
  chunk_count: 3,
  embedding_model: 'gemini-embedding-001',
  embedding_dimension: 768,
  embedding_service_ready: true,
  top_k_default: 5,
  min_similarity_default: 0.35,
}

const SAMPLE_GENAI_HEALTH: GenAIHealthStatus = {
  status: 'ready',
  provider: 'gemini',
  model_name: 'gemini-3.1-flash-lite',
  embedding_model: 'gemini-embedding-001',
  rag_connected: true,
  indexed_documents: 1,
  indexed_chunks: 3,
  demo_mode: false,
  detail: null,
}

const SAMPLE_DOCS: KnowledgeDocumentRecord[] = [
  {
    id: 'doc-1',
    title: 'NIDDK Diabetes Tests & Diagnosis Guidelines',
    source_publisher: 'NIDDK',
    publication_date: null,
    source_url:
      'https://www.niddk.nih.gov/health-information/diabetes/overview/tests-diagnosis',
    file_name: 'niddk_diabetes.md',
    content_type: 'text/markdown',
    content_hash: '6a97b220f6496244',
    chunk_count: 3,
    created_at: '2026-11-11T07:10:00Z',
    updated_at: '2026-11-11T07:10:00Z',
  },
]

describe('Phase 4 Knowledge Base & Clinical RAG Q&A', () => {
  it('loads status and document list, and uploads a Markdown guideline via FormData', async () => {
    let currentDocs = [...SAMPLE_DOCS]
    let currentStatus = { ...SAMPLE_KB_STATUS }

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/knowledge/status')) {
        return new Response(JSON.stringify(currentStatus), { status: 200 })
      }
      if (url.endsWith('/api/v1/knowledge/documents') && init?.method === 'GET') {
        return new Response(JSON.stringify(currentDocs), { status: 200 })
      }
      if (url.endsWith('/api/v1/genai/health')) {
        return new Response(JSON.stringify(SAMPLE_GENAI_HEALTH), { status: 200 })
      }
      if (url.endsWith('/api/v1/knowledge/documents') && init?.method === 'POST') {
        const uploadedDoc: KnowledgeDocumentRecord = {
          id: 'doc-2',
          title: 'Hypertension Screening Guide',
          source_publisher: 'NHLBI',
          publication_date: null,
          source_url: 'https://www.nhlbi.nih.gov/',
          file_name: 'htn.md',
          content_type: 'text/markdown',
          content_hash: '9988776655',
          chunk_count: 2,
          created_at: '2026-11-11T09:00:00Z',
          updated_at: '2026-11-11T09:00:00Z',
        }
        currentDocs = [uploadedDoc, ...currentDocs]
        currentStatus = { ...currentStatus, document_count: 2, chunk_count: 5 }
        return new Response(
          JSON.stringify({
            document: uploadedDoc,
            chunks_created: 2,
            embedding_model: 'gemini-embedding-001',
            embedding_dimension: 768,
          }),
          { status: 201 },
        )
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<KnowledgeBaseView />)

    expect(
      await screen.findByText('NIDDK Diabetes Tests & Diagnosis Guidelines'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Vector Embedding Index \(768d\)/i),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/gemini/i)

    const fileInput = screen.getByLabelText(/Reference File/i)
    const mdFile = new File(['# BP Screening\nConfirm elevated readings.'], 'htn.md', {
      type: 'text/markdown',
    })
    fireEvent.change(fileInput, { target: { files: [mdFile] } })
    fireEvent.change(screen.getByLabelText(/Document Title/i), {
      target: { value: 'Hypertension Screening Guide' },
    })
    fireEvent.change(screen.getByLabelText(/Source Publisher/i), {
      target: { value: 'NHLBI' },
    })

    fireEvent.click(
      screen.getByRole('button', { name: /Upload & Index Document/i }),
    )

    expect(
      await screen.findByText(/created 2 chunk\(s\) using Vector Embedding Index/i),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/gemini/i)
    await waitFor(() => {
      expect(
        screen.getByText('Hypertension Screening Guide'),
      ).toBeInTheDocument()
    })
  })

  it('rejects unsupported file extensions client-side and renders emergency-only RAG responses without Gemini', async () => {
    const emergencyRagResponse: RagQueryResponse = {
      status: 'emergency_warning_only',
      generated_by_gemini: false,
      gemini_available: false,
      provider: 'gemini',
      model_name: 'gemini-3.1-flash-lite',
      emergency_alert: {
        emergency_detected: true,
        urgency_level: 'emergency',
        matched_patterns: ['Chest pain accompanied by breathlessness'],
        emergency_guidance:
          'URGENT SAFETY WARNING: Seek immediate emergency care.',
        triage_disclaimer: 'Preliminary safety check only.',
      },
      report: null,
      notice:
        'Emergency warning returned independently; Gemini AI generation is currently unavailable.',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/v1/knowledge/status')) {
          return new Response(JSON.stringify(SAMPLE_KB_STATUS), { status: 200 })
        }
        if (url.endsWith('/api/v1/knowledge/documents')) {
          return new Response(JSON.stringify(SAMPLE_DOCS), { status: 200 })
        }
        if (url.endsWith('/api/v1/genai/health')) {
          return new Response(
            JSON.stringify({ ...SAMPLE_GENAI_HEALTH, status: 'unavailable' }),
            { status: 200 },
          )
        }
        if (url.endsWith('/api/v1/rag/query') && init?.method === 'POST') {
          return new Response(JSON.stringify(emergencyRagResponse), {
            status: 200,
          })
        }
        return new Response('{}', { status: 404 })
      }),
    )

    render(<KnowledgeBaseView />)
    expect(await screen.findByText('Clinical AI Unavailable')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/gemini/i)

    // Verify unsupported file extension is rejected cleanly client-side
    const fileInput = screen.getByLabelText(/Reference File/i)
    const badFile = new File(['binary'], 'scan.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [badFile] } })
    fireEvent.change(screen.getByLabelText(/Document Title/i), {
      target: { value: 'Bad File Test' },
    })
    fireEvent.change(screen.getByLabelText(/Source Publisher/i), {
      target: { value: 'Test Pub' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: /Upload & Index Document/i }),
    )
    expect(
      await screen.findByText(/Only \.pdf, \.txt, and \.md documents are supported/i),
    ).toBeInTheDocument()

    // Test emergency RAG Q&A response when Gemini is unavailable
    fireEvent.change(screen.getByLabelText(/Clinical Question/i), {
      target: { value: 'Severe chest pain and shortness of breath' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: /Run Grounded RAG Query/i }),
    )

    expect(
      await screen.findByText(/URGENT EMERGENCY RED-FLAG ALERT/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Independent Rule-Based Safety Check/i),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/gemini/i)
  })
})
