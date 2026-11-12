import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssessmentResultsView } from '../components/AssessmentResultsView'
import { DashboardHome } from '../components/DashboardHome'
import { DiagnosticReportDisplay } from '../components/DiagnosticReportDisplay'
import { PatientAssessmentWorkflow } from '../components/PatientAssessmentWorkflow'
import type {
  ClinicalAssessmentRecord,
  DiagnosticReportRecord,
  GenAIHealthStatus,
  PatientRecord,
} from '../types/assessment'

function makeSamplePatient(): PatientRecord {
  return {
    id: 'pat-1111',
    patient_code: 'PT-SYNTH-001',
    full_name: 'Synthetic Patient One',
    date_of_birth: '1980-05-14',
    sex: 'Female',
    contact_number: null,
    created_at: '2026-11-11T08:00:00Z',
    updated_at: null,
  }
}

function makeSampleAssessment(
  overrides: Partial<ClinicalAssessmentRecord> = {},
): ClinicalAssessmentRecord {
  return {
    id: 'asm-2222',
    patient_id: 'pat-1111',
    demographics_notes: null,
    current_symptoms: 'Persistent fatigue and frequent urination',
    symptom_duration: '2 weeks',
    previous_conditions: 'None reported',
    existing_medications: null,
    medical_history_notes: null,
    systolic_bp: 132,
    diastolic_bp: 84,
    heart_rate: 80,
    body_temperature: 36.8,
    oxygen_saturation: 98,
    additional_measurements: null,
    lab_results: 'Fasting glucose 132 mg/dL',
    ehr_summary: null,
    previous_reports: null,
    attached_report_names: [],
    attached_images: [],
    imaging_notes: null,
    genomic_notes: null,
    family_history_markers: null,
    preprocessing_summary: {
      providedModalities: ['Symptoms & Medical History', 'Clinical Measurements', 'Laboratory Results'],
      missingModalities: ['Medical Images', 'Genomic Information'],
      validatedMeasurementsCount: 5,
      imputationAppliedNote: null,
    },
    predictive_experiment_result: {
      executed: true,
      status: 'completed',
      result: {
        predicted_class: 1,
        class_0_probability: 0.31,
        class_1_probability: 0.69,
        model_name: 'xgboost_diabetes_model',
        model_version: 'pima-colab-v1',
        module_name: 'Diabetes prediction experiment',
        clinical_disclaimer: 'Experimental statistical output only.',
      },
      message: 'Completed',
    },
    clinician_reviewed: false,
    created_at: '2026-11-11T08:10:00Z',
    updated_at: '2026-11-11T08:10:00Z',
    patient: makeSamplePatient(),
    ...overrides,
  }
}

function makeSampleReportRecord(
  overrides: Partial<DiagnosticReportRecord['report']> = {},
): DiagnosticReportRecord {
  const chunkId = 'ea3c5bf2-e684-4ccb-8ec0-e43b9714314a'
  return {
    id: 'rep-3333',
    assessment_id: 'asm-2222',
    provider: 'gemini',
    model_name: 'gemini-3.1-flash-lite',
    clinician_reviewed: false,
    clinician_notes: null,
    reviewed_at: null,
    created_at: '2026-11-11T08:15:00Z',
    updated_at: '2026-11-11T08:15:00Z',
    report: {
      patient_context_summary:
        'You reported 2 weeks of feeling unusually tired and urinating more often, along with a fasting blood sugar of 132 mg/dL.',
      relevant_clinical_findings: [
        'Current symptoms: Persistent fatigue and frequent urination.',
        'Laboratory results: Fasting glucose 132 mg/dL.',
      ],
      finding_explanations: [
        {
          finding_name: 'Fasting Blood Sugar',
          observed_value: '132 mg/dL',
          reference_range_note: 'Typical normal fasting sugar is 99 mg/dL or below.',
          status_flag: 'outside_range',
          plain_language_meaning:
            'Measures blood sugar after at least 8 hours without eating.',
          why_it_matters:
            'Values above typical limits can be linked with tiredness and frequent urination.',
        },
      ],
      possible_diagnostic_considerations: [
        {
          condition_or_pattern: 'High Blood Sugar Pattern (Dysglycemia)',
          plain_language_explanation:
            'Sugar may be staying higher in your bloodstream than usual.',
          why_findings_point_here:
            'Your tiredness, frequent urination, and fasting glucose of 132 mg/dL point toward checking blood sugar.',
          supporting_observed_evidence: ['Fasting glucose 132 mg/dL'],
          cited_chunk_ids: [chunkId],
          rationale:
            'Fasting plasma glucose >= 126 mg/dL warrants confirmatory repeat or A1C testing.',
          uncertainty_note: 'Single fasting reading requires clinical confirmation.',
        },
      ],
      supporting_medical_evidence:
        'NIDDK diagnostic guidelines indicate fasting glucose >= 126 mg/dL meets threshold criteria pending confirmation.',
      additional_information_required: ['Confirmatory HbA1c test result'],
      doctor_discussion_points: [
        'Ask your doctor whether a repeat fasting test or 3-month HbA1c test is needed.',
      ],
      risk_indicators_and_safety_warnings: ['Monitor for worsening osmotic symptoms.'],
      treatment_and_management_information: {
        grounded_in_verified_references: true,
        guidance_items: [
          'Discuss confirmatory A1C or repeat fasting glucose test on a separate day.',
        ],
        cited_chunk_ids: [chunkId],
        status_note: 'Grounded in retrieved NIDDK medical guideline chunks.',
        clinician_review_required: true,
      },
      clinical_limitations: [
        'Automated image and genomic analysis are not implemented.',
      ],
      retrieved_sources: [
        {
          chunk_id: chunkId,
          document_id: '4f901561-0b07-4481-8d4a-9f157fa42ea7',
          document_title: 'NIDDK Diabetes Tests & Diagnosis Guidelines',
          source_publisher: 'NIDDK',
          publication_date: null,
          source_url:
            'https://www.niddk.nih.gov/health-information/diabetes/overview/tests-diagnosis',
          section_heading: 'Fasting Plasma Glucose (FPG) Test',
          page_number: 1,
          similarity_score: 0.7628,
          excerpt: 'Diabetes is 126 mg/dL or above after an 8-hour fast.',
        },
      ],
      emergency_alert: {
        emergency_detected: false,
        urgency_level: 'standard',
        matched_patterns: [],
        emergency_guidance: null,
        triage_disclaimer:
          'Automated keyword and vital-sign red-flag screening is not a validated triage system.',
      },
      evidence_sufficient: true,
      generated_by_gemini: true,
      predictive_ml_output: {
        included: true,
        module_name: 'Diabetes prediction experiment',
        summary: 'Separate XGBoost Pima model class 1 (69.0%).',
        limitations:
          'Tabular Pima experiment output is separate from Gemini RAG synthesis.',
      },
      research_context_note:
        'GAN synthetic data and Paillier encryption are preserved research modules.',
      clinician_review_disclaimer:
        'Clinician review required; this output is not a confirmed medical diagnosis.',
      ...overrides,
    },
  }
}

describe('Simplified Patient Input -> Diagnostic Output -> Patient Records Workflows', () => {
  it('submits a new patient assessment cleanly without XGBoost or extra experiment sections', async () => {
    const createdPatient = makeSamplePatient()
    const createdAssessment = makeSampleAssessment({
      predictive_experiment_result: null,
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/patients') && init?.method === 'POST') {
        return new Response(JSON.stringify(createdPatient), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/api/v1/assessments') && init?.method === 'POST') {
        return new Response(JSON.stringify(createdAssessment), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onAssessmentSaved = vi.fn()
    render(
      <PatientAssessmentWorkflow
        patients={[]}
        prefillPatient={null}
        onAssessmentSaved={onAssessmentSaved}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByText(/XGBoost/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Genomic/i)).not.toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/gemini/i)

    fireEvent.change(screen.getByLabelText(/Full Name/i), {
      target: { value: 'Synthetic Patient One' },
    })
    fireEvent.change(screen.getByLabelText(/Date of Birth/i), {
      target: { value: '1980-05-14' },
    })
    fireEvent.change(screen.getByLabelText(/Current Symptoms/i), {
      target: { value: 'Persistent fatigue and frequent urination' },
    })

    fireEvent.click(
      screen.getByRole('button', { name: /Save & Continue to Diagnostic Output/i }),
    )

    await waitFor(() => {
      expect(onAssessmentSaved).toHaveBeenCalledTimes(1)
    })
    expect(onAssessmentSaved).toHaveBeenCalledWith(
      createdAssessment,
      createdPatient,
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/patients'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/assessments'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('generates and displays clean Diagnostic Output, verified references, and clinician review without XGBoost or Gemini branding', async () => {
    const readyHealth: GenAIHealthStatus = {
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
    const generatedReport = makeSampleReportRecord()
    const reviewedReport: DiagnosticReportRecord = {
      ...generatedReport,
      clinician_reviewed: true,
      clinician_notes: 'Confirmed HbA1c order.',
      reviewed_at: '2026-11-11T08:20:00Z',
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/genai/health')) {
        return new Response(JSON.stringify(readyHealth), { status: 200 })
      }
      if (url.endsWith('/report') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ detail: 'Not found' }), {
          status: 404,
        })
      }
      if (url.endsWith('/generate-report') && init?.method === 'POST') {
        return new Response(JSON.stringify(generatedReport), { status: 201 })
      }
      if (url.endsWith('/report/review') && init?.method === 'PATCH') {
        return new Response(JSON.stringify(reviewedReport), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onAssessmentUpdated = vi.fn()
    render(
      <AssessmentResultsView
        assessment={makeSampleAssessment()}
        onAssessmentUpdated={onAssessmentUpdated}
        onStartAnother={vi.fn()}
        onBackToDashboard={vi.fn()}
      />,
    )

    expect(await screen.findByText('Clinical AI Ready')).toBeInTheDocument()
    expect(screen.queryByText(/XGBoost/i)).not.toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/gemini/i)

    const generateBtn = screen.getByRole('button', {
      name: /Generate Diagnostic Output/i,
    })
    fireEvent.click(generateBtn)

    expect(
      await screen.findByRole('heading', { name: /Patient Summary/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Clinical Findings/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: /Possible Conditions & Simple Explanations/i,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Fasting Blood Sugar')).toBeInTheDocument()
    expect(
      screen.getByText(/Sugar may be staying higher in your bloodstream than usual\./i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: /Supporting Medical References/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Questions & Topics to Discuss with a Clinician/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText('NIDDK Diabetes Tests & Diagnosis Guidelines'),
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(/ea3c5bf2-e684-4ccb-8ec0-e43b9714314a/i).length,
    ).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/System Mapping/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('human-anatomy-visual')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Clinician Review Notes/i), {
      target: { value: 'Confirmed HbA1c order.' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: /Approve & Mark Report Reviewed/i }),
    )

    await waitFor(() => {
      expect(onAssessmentUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ clinician_reviewed: true }),
      )
    })
  })

  it('displays withheld treatment notice cleanly when retrieved medical evidence is insufficient', async () => {
    const insufficientReport = makeSampleReportRecord({
      evidence_sufficient: false,
      retrieved_sources: [],
      possible_diagnostic_considerations: [],
      treatment_and_management_information: {
        grounded_in_verified_references: false,
        guidance_items: [],
        cited_chunk_ids: [],
        status_note:
          'Insufficient verified medical guideline chunks were retrieved; treatment guidance withheld.',
        clinician_review_required: true,
      },
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/v1/genai/health')) {
          return new Response(
            JSON.stringify({
              status: 'ready',
              provider: 'gemini',
              model_name: 'gemini-3.1-flash-lite',
              embedding_model: 'gemini-embedding-001',
              rag_connected: false,
              indexed_documents: 0,
              indexed_chunks: 0,
              demo_mode: false,
              detail: null,
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify(insufficientReport), { status: 200 })
      }),
    )

    render(
      <AssessmentResultsView
        assessment={makeSampleAssessment()}
        onAssessmentUpdated={vi.fn()}
        onStartAnother={vi.fn()}
        onBackToDashboard={vi.fn()}
      />,
    )

    expect(
      await screen.findByText(
        /Treatment Guidance Withheld Due to Insufficient Verified Evidence/i,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/No matching verified medical documents were retrieved/i),
    ).toBeInTheDocument()
  })

  it('handles Gemini unavailable state without displaying mock output and renders emergency fallback alerts from 503', async () => {
    const unavailableHealth: GenAIHealthStatus = {
      status: 'unavailable',
      provider: 'gemini',
      model_name: 'gemini-3.1-flash-lite',
      embedding_model: 'gemini-embedding-001',
      rag_connected: false,
      indexed_documents: 0,
      indexed_chunks: 0,
      demo_mode: false,
      detail: 'GEMINI_API_KEY is not configured.',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/v1/genai/health')) {
          return new Response(JSON.stringify(unavailableHealth), { status: 200 })
        }
        if (url.endsWith('/report')) {
          return new Response(JSON.stringify({ detail: 'Not found' }), {
            status: 404,
          })
        }
        if (url.endsWith('/generate-report') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              detail: 'Gemini unavailable on emergency case.',
              generated_by_gemini: false,
              emergency_alert: {
                emergency_detected: true,
                urgency_level: 'emergency',
                matched_patterns: ['Chest pain accompanied by breathlessness'],
                emergency_guidance:
                  'URGENT SAFETY WARNING: Seek immediate emergency medical evaluation.',
                triage_disclaimer: 'Preliminary safety check only.',
              },
            }),
            { status: 503 },
          )
        }
        return new Response('{}', { status: 404 })
      }),
    )

    render(
      <AssessmentResultsView
        assessment={makeSampleAssessment({
          current_symptoms: 'Chest pain and shortness of breath',
        })}
        onAssessmentUpdated={vi.fn()}
        onStartAnother={vi.fn()}
        onBackToDashboard={vi.fn()}
      />,
    )

    expect(await screen.findByText('Clinical AI Unavailable')).toBeInTheDocument()
    expect(
      screen.getByText(/AI service configuration is not configured/i),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/gemini/i)

    fireEvent.click(
      screen.getByRole('button', {
        name: /Generate Diagnostic Output/i,
      }),
    )

    expect(
      await screen.findByText(/URGENT EMERGENCY RED-FLAG ALERT/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Independent Rule-Based Safety Check/i),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/gemini/i)
    expect(
      screen.getByText(/Chest pain accompanied by breathlessness/i),
    ).toBeInTheDocument()
  })

  it('renders simplified Patient Input, Diagnostic Output, and Patient Records dashboard without XGBoost or Research Experiments', () => {
    const onStartNewAssessment = vi.fn()
    const onViewAssessmentResult = vi.fn()
    const sampleAssessment = makeSampleAssessment()

    render(
      <DashboardHome
        patients={[makeSamplePatient()]}
        assessments={[sampleAssessment]}
        loadingRecords={false}
        recordsError={null}
        genaiHealth={{
          status: 'ready',
          provider: 'gemini',
          model_name: 'gemini-3.1-flash-lite',
          embedding_model: 'gemini-embedding-001',
          rag_connected: true,
          indexed_documents: 1,
          indexed_chunks: 3,
          demo_mode: false,
          detail: null,
        }}
        genaiHealthError={null}
        onRefreshRecords={vi.fn()}
        onNavigate={vi.fn()}
        onStartNewAssessment={onStartNewAssessment}
        onViewAssessmentResult={onViewAssessmentResult}
      />,
    )

    expect(
      screen.getByRole('heading', {
        name: /Understanding Health\.\s*Supporting Better Decisions\./i,
      }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('human-anatomy-visual')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Patient Records/i }),
    ).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(
      /xgboost|research experiments|gemini/i,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /Start Healthcare Analysis/i }),
    )
    expect(onStartNewAssessment).toHaveBeenCalledTimes(1)

    expect(
      screen.getByRole('button', { name: /View Patient Records/i }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Open Report/i }))
    expect(onViewAssessmentResult).toHaveBeenCalledWith('asm-2222')
  })

  it('uploads clinical documents and X-ray images and renders multimodal findings cleanly', async () => {
    const createdPatient = makeSamplePatient()
    const createdAssessment = makeSampleAssessment()
    const multimodalReport = makeSampleReportRecord({
      extracted_document_summaries: [
        {
          file_name: 'cbc_lab.pdf',
          extraction_status: 'extracted',
          summary_note: 'Text extracted and PII-filtered.',
          extracted_excerpt: 'WBC 14.2 elevated',
        },
      ],
      image_observations: [
        {
          image_name: 'chest_xray.png',
          modality: 'chest_xray',
          processing_status: 'analyzed',
          visibly_observed: ['Right lower zone hazy opacity.'],
          possible_indications: ['May indicate localized pulmonary infection.'],
          uncertainties: ['Single view cannot confirm exact cause.'],
          clinician_verification_needed: 'Radiologist must review full-resolution X-ray.',
          limitation_note: 'Preliminary decision support only.',
        },
      ],
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v1/patients') && init?.method === 'POST') {
        return new Response(JSON.stringify(createdPatient), { status: 201 })
      }
      if (url.endsWith('/api/v1/assessments') && init?.method === 'POST') {
        return new Response(JSON.stringify(createdAssessment), { status: 201 })
      }
      if (url.endsWith('/documents') && init?.method === 'POST') {
        return new Response(
          JSON.stringify([
            {
              id: 'att-doc-1',
              assessment_id: createdAssessment.id,
              kind: 'document',
              original_filename: 'cbc_lab.pdf',
              mime_type: 'application/pdf',
              size_bytes: 1200,
              modality: 'clinical_document',
              extraction_status: 'extracted',
              extracted_text: 'WBC 14.2 elevated',
              extraction_note: null,
              exif_stripped: false,
              created_at: '2026-11-12T10:00:00Z',
            },
          ]),
          { status: 201 },
        )
      }
      if (url.endsWith('/images') && init?.method === 'POST') {
        return new Response(
          JSON.stringify([
            {
              id: 'att-img-1',
              assessment_id: createdAssessment.id,
              kind: 'image',
              original_filename: 'chest_xray.png',
              mime_type: 'image/png',
              size_bytes: 2048,
              modality: 'chest_xray',
              extraction_status: 'stored_for_vision',
              extracted_text: null,
              extraction_note: null,
              exif_stripped: true,
              created_at: '2026-11-12T10:00:00Z',
            },
          ]),
          { status: 201 },
        )
      }
      if (url.endsWith('/api/v1/genai/health')) {
        return new Response(
          JSON.stringify({
            status: 'ready',
            provider: 'gemini',
            model_name: 'gemini-3.1-flash-lite',
            embedding_model: 'gemini-embedding-001',
            rag_connected: true,
            indexed_documents: 1,
            indexed_chunks: 3,
            demo_mode: false,
            detail: null,
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify(multimodalReport), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onAssessmentSaved = vi.fn()
    render(
      <PatientAssessmentWorkflow
        patients={[]}
        prefillPatient={null}
        onAssessmentSaved={onAssessmentSaved}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText(/Full Name/i), {
      target: { value: 'Synthetic Patient One' },
    })
    fireEvent.change(screen.getByLabelText(/Date of Birth/i), {
      target: { value: '1980-05-14' },
    })
    fireEvent.change(screen.getByLabelText(/Current Symptoms/i), {
      target: { value: 'Fever and cough' },
    })

    const docFile = new File(['WBC 14.2'], 'cbc_lab.pdf', { type: 'application/pdf' })
    const imgFile = new File([new Uint8Array([137, 80, 78, 71])], 'chest_xray.png', {
      type: 'image/png',
    })
    fireEvent.change(screen.getByLabelText(/Upload Clinical Reports \/ EHR Files/i), {
      target: { files: [docFile] },
    })
    fireEvent.change(screen.getByLabelText(/Upload Medical Image/i), {
      target: { files: [imgFile] },
    })

    fireEvent.click(
      screen.getByRole('button', { name: /Save & Continue to Diagnostic Output/i }),
    )

    await waitFor(() => {
      expect(onAssessmentSaved).toHaveBeenCalledTimes(1)
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/documents'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/images'),
      expect.objectContaining({ method: 'POST' }),
    )

    render(
      <AssessmentResultsView
        assessment={createdAssessment}
        onAssessmentUpdated={vi.fn()}
        onStartAnother={vi.fn()}
        onBackToDashboard={vi.fn()}
      />,
    )

    expect(
      await screen.findByRole('heading', {
        name: /Extracted Clinical Document Information/i,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('cbc_lab.pdf')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Observed Medical Image Findings/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('Right lower zone hazy opacity.')).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toMatch(/gemini/i)
  })

  it('passes the exact selected assessment when clicking Re-assess on a patient with multiple assessments', () => {
    const patient = makeSamplePatient()
    const newerAssessment = makeSampleAssessment({
      id: 'asm-newer',
      current_symptoms: 'Mild headache and dry cough',
      created_at: '2026-11-12T09:00:00Z',
    })
    const olderAssessment = makeSampleAssessment({
      id: 'asm-older',
      current_symptoms: 'High fever and chest discomfort',
      created_at: '2026-11-10T09:00:00Z',
    })
    const onStartNewAssessment = vi.fn()

    render(
      <DashboardHome
        patients={[patient]}
        assessments={[newerAssessment, olderAssessment]}
        loadingRecords={false}
        recordsError={null}
        onRefreshRecords={vi.fn()}
        onNavigate={vi.fn()}
        onStartNewAssessment={onStartNewAssessment}
        onViewAssessmentResult={vi.fn()}
      />,
    )

    const reassessButtons = screen.getAllByRole('button', { name: 'Re-assess' })
    expect(reassessButtons).toHaveLength(2)

    fireEvent.click(reassessButtons[1])
    expect(onStartNewAssessment).toHaveBeenCalledTimes(1)
    expect(onStartNewAssessment).toHaveBeenCalledWith(patient, olderAssessment)
  })

  it('prepopulates Re-assess form from the selected assessment, preserves missing fields as empty, flags missing prior images, and creates a new record', async () => {
    const patient = makeSamplePatient()
    const sourceAssessment = makeSampleAssessment({
      id: 'asm-reassess-1',
      demographics_notes: 'Non-smoker',
      current_symptoms: 'Fever and productive cough',
      symptom_duration: '4 days',
      previous_conditions: 'Mild asthma',
      existing_medications: 'Salbutamol inhaler PRN',
      medical_history_notes: 'Known Allergies: Penicillin\nChildhood bronchitis',
      systolic_bp: 128,
      diastolic_bp: null,
      heart_rate: 102,
      body_temperature: null,
      oxygen_saturation: 93,
      additional_measurements: 'Respiratory rate 22 /min',
      lab_results: 'CRP 68 mg/L',
      ehr_summary: null,
      attached_report_names: ['prior_lab.pdf'],
      imaging_notes: 'PA chest X-ray',
      clinician_reviewed: true,
      attachments: [
        {
          id: 'att-doc-1',
          assessment_id: 'asm-reassess-1',
          kind: 'document',
          original_filename: 'prior_lab.pdf',
          mime_type: 'application/pdf',
          size_bytes: 2048,
          modality: 'document',
          extraction_status: 'extracted',
          extracted_text: 'CRP 68 mg/L',
          extraction_note: null,
          exif_stripped: false,
          created_at: '2026-11-11T08:11:00Z',
        },
        {
          id: 'att-img-1',
          assessment_id: 'asm-reassess-1',
          kind: 'image',
          original_filename: 'missing_xray.png',
          mime_type: 'image/png',
          size_bytes: 4096,
          modality: 'chest_xray',
          extraction_status: 'analyzed',
          extracted_text: null,
          extraction_note: null,
          exif_stripped: true,
          created_at: '2026-11-11T08:12:00Z',
        },
      ],
    })

    const newlyCreatedAssessment = makeSampleAssessment({
      id: 'asm-new-999',
      clinician_reviewed: false,
    })

    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/assessments/asm-reassess-1')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => sourceAssessment,
        })
      }
      if (url.includes('/attachments/att-img-1/content')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ detail: 'Not found' }),
        })
      }
      if (url.endsWith('/api/v1/assessments') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => newlyCreatedAssessment,
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchMock)

    const onAssessmentSaved = vi.fn()

    render(
      <PatientAssessmentWorkflow
        patients={[patient]}
        prefillPatient={patient}
        prefillAssessment={sourceAssessment}
        onAssessmentSaved={onAssessmentSaved}
        onCancel={vi.fn()}
      />,
    )

    expect(
      screen.getByText(/Re-assessing from saved assessment/i),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Current Symptoms/i)).toHaveValue(
      'Fever and productive cough',
    )
    expect(screen.getByLabelText(/Duration of Symptoms/i)).toHaveValue('4 days')
    expect(screen.getByLabelText(/Previous Medical Conditions/i)).toHaveValue(
      'Mild asthma',
    )
    expect(screen.getByLabelText(/Existing Medications/i)).toHaveValue(
      'Salbutamol inhaler PRN',
    )
    expect(screen.getByLabelText(/Known Allergies/i)).toHaveValue('Penicillin')
    expect(screen.getByLabelText(/Systolic Blood Pressure/i)).toHaveValue(128)
    expect(screen.getByLabelText(/Diastolic Blood Pressure/i)).toHaveValue(null)
    expect(screen.getByLabelText(/Heart Rate/i)).toHaveValue(102)
    expect(screen.getByLabelText(/Body Temperature/i)).toHaveValue(null)
    expect(screen.getByLabelText(/Oxygen Saturation/i)).toHaveValue(93)
    expect(screen.getByLabelText(/Other Measurements/i)).toHaveValue(
      'Respiratory rate 22 /min',
    )
    expect(screen.getByLabelText(/Laboratory Results/i)).toHaveValue(
      'CRP 68 mg/L',
    )
    expect(screen.getByLabelText(/Previous Clinical Notes \/ EHR Summary/i)).toHaveValue(
      '',
    )
    expect(screen.getByLabelText(/Imaging Context Notes/i)).toHaveValue(
      'PA chest X-ray',
    )

    expect(
      await screen.findByText(/Previous image\(s\) no longer available and need to be uploaded again: missing_xray\.png/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Previous assessment document reference\(s\): prior_lab\.pdf/i),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /Save & Continue to Diagnostic Output/i }),
    )

    await waitFor(() => {
      expect(onAssessmentSaved).toHaveBeenCalledWith(newlyCreatedAssessment, null)
    })
    expect(sourceAssessment.id).toBe('asm-reassess-1')
    expect(sourceAssessment.clinician_reviewed).toBe(true)
  })

  it('starts fresh with empty clinical fields when selecting an existing patient in normal New Analysis mode', () => {
    const patient = makeSamplePatient()

    render(
      <PatientAssessmentWorkflow
        patients={[patient]}
        prefillPatient={null}
        prefillAssessment={null}
        onAssessmentSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /Existing Patient/i }),
    )
    fireEvent.change(screen.getByLabelText(/Select Registered Patient/i), {
      target: { value: patient.id },
    })

    expect(screen.queryByText(/Re-assessing from saved assessment/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Current Symptoms/i)).toHaveValue('')
    expect(screen.getByLabelText(/Systolic Blood Pressure/i)).toHaveValue(null)
    expect(screen.getByLabelText(/Laboratory Results/i)).toHaveValue('')
  })

  it('omits empty clinical finding bullets and avoids duplicating finding cards', () => {
    const report = makeSampleReportRecord({
      relevant_clinical_findings: [
        '',
        '   ',
        'Clinical measurements: BP 128/84 mm Hg, HR 104 bpm, Temp 38.6 °C, SpO2 93%.',
        'Existing medications: Paracetamol 500 mg PRN.',
      ],
      finding_explanations: [
        {
          finding_name: 'Oxygen Saturation (SpO2)',
          observed_value: '93%',
          reference_range_note: 'Typical resting adult levels are usually 95% or higher.',
          status_flag: 'outside_range',
          plain_language_meaning: 'Measures oxygen saturation in the blood.',
          why_it_matters: 'A single reading below typical range warrants clinical correlation.',
        },
      ],
    }).report

    render(<DiagnosticReportDisplay report={report} />)

    expect(
      screen.getByText(/View concise recorded clinical finding bullets/i),
    ).toBeInTheDocument()
    const bullets = document.querySelectorAll('.recorded-raw-details .report-bullet-list li')
    expect(bullets).toHaveLength(1)
    expect(bullets[0].textContent).toBe('Existing medications: Paracetamol 500 mg PRN.')

    const emptyBulletsReport = makeSampleReportRecord({
      relevant_clinical_findings: ['', '   '],
      finding_explanations: [
        {
          finding_name: 'Oxygen Saturation (SpO2)',
          observed_value: '93%',
          reference_range_note: 'Typical resting adult levels are usually 95% or higher.',
          status_flag: 'outside_range',
          plain_language_meaning: 'Measures oxygen saturation in the blood.',
          why_it_matters: 'A single reading below typical range warrants clinical correlation.',
        },
      ],
    }).report

    const { container } = render(<DiagnosticReportDisplay report={emptyBulletsReport} />)
    expect(container.querySelector('.recorded-raw-details')).toBeNull()
  })
})
