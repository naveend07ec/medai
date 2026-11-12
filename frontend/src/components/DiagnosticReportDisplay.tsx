import type {
  DiagnosticReportContent,
  FindingExplanation,
  RetrievedSourceItem,
} from '../types/assessment'
import { sanitizeClinicalAiText } from '../utils/aiTextSanitizer'
import { EmergencyAlertBanner } from './EmergencyAlertBanner'

interface DiagnosticReportDisplayProps {
  report: DiagnosticReportContent
  sourceLabel?: string
}

function getSafeExternalUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString()
    }
    return null
  } catch {
    return null
  }
}

function formatFindingFlag(flag: FindingExplanation['status_flag']): {
  label: string
  className: string
} {
  switch (flag) {
    case 'within_range':
      return { label: 'Within Typical Range', className: 'pill-ready' }
    case 'outside_range':
      return { label: 'Outside Typical Range', className: 'pill-error' }
    case 'needs_confirmation':
      return { label: 'Needs Confirmation', className: 'pill-warn' }
    case 'reported_symptom':
    default:
      return { label: 'Reported Symptom', className: 'pill-proto' }
  }
}

function getAdditionalClinicalFindings(
  findings: string[] | undefined,
  explanations: FindingExplanation[],
): string[] {
  const cleaned = (findings ?? [])
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)

  if (explanations.length === 0) {
    return cleaned
  }

  const normalizedExplanationTokens = explanations
    .flatMap((exp) => [exp.observed_value, exp.finding_name])
    .map((val) => val.trim().toLowerCase())
    .filter((val) => val.length >= 3)

  return cleaned.filter((finding) => {
    const lower = finding.toLowerCase()
    return !normalizedExplanationTokens.some((token) => lower.includes(token))
  })
}

export function DiagnosticReportDisplay({
  report,
  sourceLabel = 'AI Health Decision Support',
}: DiagnosticReportDisplayProps) {
  const sourceByChunkId = new Map<string, RetrievedSourceItem>(
    report.retrieved_sources.map((src) => [src.chunk_id, src]),
  )

  const treatment = report.treatment_and_management_information
  const findingExplanations = report.finding_explanations ?? []
  const additionalClinicalFindings = getAdditionalClinicalFindings(
    report.relevant_clinical_findings,
    findingExplanations,
  )
  const discussionPoints = report.doctor_discussion_points ?? []
  const extractedDocs = report.extracted_document_summaries ?? []
  const imageObservations = report.image_observations ?? []

  return (
    <div className="diagnostic-report-display">
      {report.emergency_alert.emergency_detected && (
        <EmergencyAlertBanner
          alert={report.emergency_alert}
          generatedByGemini={report.generated_by_gemini}
        />
      )}

      <div className="report-provenance-bar">
        <div className="report-provenance-left">
          <span className="status-pill pill-proto">
            {sanitizeClinicalAiText(sourceLabel)}
          </span>
          <span
            className={`status-pill ${
              report.evidence_sufficient ? 'pill-ready' : 'pill-warn'
            }`}
          >
            {report.evidence_sufficient
              ? 'Grounded in Retrieved Literature'
              : 'Limited Verified Literature Match'}
          </span>
        </div>
        <span className="report-provenance-note">
          Clinician Review Required · Informational Decision Support Only
        </span>
      </div>

      {/* 1. Patient Summary */}
      <section className="report-editorial-block" aria-labelledby="rep-summary-heading">
        <div className="report-block-header">
          <span className="report-section-num">01</span>
          <div>
            <h4 id="rep-summary-heading">Patient Summary</h4>
            <p className="report-block-subtitle">
              Overview of presenting symptoms, history, and clinical context.
            </p>
          </div>
        </div>
        <p className="report-lead-paragraph">
          {sanitizeClinicalAiText(report.patient_context_summary)}
        </p>
      </section>

      {/* 2. Important Clinical Findings */}
      <section className="report-editorial-block" aria-labelledby="rep-findings-heading">
        <div className="report-block-header">
          <span className="report-section-num">02</span>
          <div>
            <h4 id="rep-findings-heading">Clinical Findings</h4>
            <p className="report-block-subtitle">
              Recorded vitals and symptoms compared with normal reference ranges.
            </p>
          </div>
        </div>

        {findingExplanations.length > 0 ? (
          <div className="finding-explanation-grid">
            {findingExplanations.map((item, idx) => {
              const badge = formatFindingFlag(item.status_flag)
              return (
                <article key={`${item.finding_name}-${idx}`} className="finding-explanation-card">
                  <div className="finding-card-top">
                    <h5>{item.finding_name}</h5>
                    <span className={`status-pill ${badge.className}`}>{badge.label}</span>
                  </div>
                  <div className="finding-reading-row">
                    <span className="finding-observed-value">{item.observed_value}</span>
                    {item.reference_range_note && (
                      <span className="finding-range-note">
                        Ref: {item.reference_range_note}
                      </span>
                    )}
                  </div>
                  <p className="finding-copy">
                    <strong>What this means:</strong> {item.plain_language_meaning}
                  </p>
                  <p className="finding-copy">
                    <strong>Why it matters:</strong> {item.why_it_matters}
                  </p>
                </article>
              )
            })}
          </div>
        ) : null}

        {additionalClinicalFindings.length > 0 && (
          <details
            className="recorded-raw-details"
            open={findingExplanations.length === 0}
          >
            <summary>
              {findingExplanations.length > 0
                ? 'View concise recorded clinical finding bullets'
                : 'Recorded clinical findings'}
            </summary>
            <ul className="report-bullet-list">
              {additionalClinicalFindings.map((finding, idx) => (
                <li key={idx}>{finding}</li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Extracted Clinical Documents (when uploaded) */}
      {extractedDocs.length > 0 && (
        <section className="report-editorial-block" aria-labelledby="rep-docs-heading">
          <div className="report-block-header">
            <span className="report-section-num">DOC</span>
            <div>
              <h4 id="rep-docs-heading">Extracted Clinical Document Information</h4>
              <p className="report-block-subtitle">
                Text extracted from uploaded patient documents after privacy filtering.
              </p>
            </div>
          </div>

          <div className="finding-explanation-grid">
            {extractedDocs.map((doc, idx) => (
              <article key={`${doc.file_name}-${idx}`} className="finding-explanation-card">
                <div className="finding-card-top">
                  <h5>{doc.file_name}</h5>
                  <span
                    className={`status-pill ${
                      doc.extraction_status === 'extracted' ? 'pill-ready' : 'pill-warn'
                    }`}
                  >
                    {doc.extraction_status === 'extracted' ? 'Extracted' : 'Unreadable'}
                  </span>
                </div>
                {doc.summary_note && <p className="finding-copy">{doc.summary_note}</p>}
                {doc.extracted_excerpt && (
                  <p className="finding-copy">
                    <strong>Excerpt:</strong> {doc.extracted_excerpt}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Observed Medical Image Findings (when uploaded) */}
      {imageObservations.length > 0 && (
        <section className="report-editorial-block" aria-labelledby="rep-images-heading">
          <div className="report-block-header">
            <span className="report-section-num report-section-num-blue">IMG</span>
            <div>
              <h4 id="rep-images-heading">Observed Medical Image Findings</h4>
              <p className="report-block-subtitle">
                Preliminary AI visual observations—not a validated radiology diagnosis.
              </p>
            </div>
          </div>

          <div className="considerations-stack">
            {imageObservations.map((img, idx) => (
              <article
                key={`${img.image_name}-${idx}`}
                className="consideration-editorial-card"
              >
                <div className="consideration-card-head">
                  <div>
                    <span className="consideration-ai-tag">
                      {img.modality.replace('_', ' ').toUpperCase()}
                    </span>
                    <h5>{img.image_name}</h5>
                  </div>
                  <span
                    className={`status-pill ${
                      img.processing_status === 'analyzed' ? 'pill-ready' : 'pill-warn'
                    }`}
                  >
                    {img.processing_status === 'analyzed'
                      ? 'Image Analyzed'
                      : 'Could Not Interpret'}
                  </span>
                </div>

                {img.visibly_observed.length > 0 && (
                  <div className="consideration-detail-block">
                    <span>What is visibly observed:</span>
                    <ul className="report-bullet-list">
                      {img.visibly_observed.map((obs, obsIdx) => (
                        <li key={obsIdx}>{obs}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {img.possible_indications.length > 0 && (
                  <div className="consideration-detail-block">
                    <span>What possible findings may indicate:</span>
                    <ul className="report-bullet-list">
                      {img.possible_indications.map((ind, indIdx) => (
                        <li key={indIdx}>{ind}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {img.uncertainties.length > 0 && (
                  <div className="uncertainty-callout">
                    <strong>What cannot be confidently determined:</strong>{' '}
                    {img.uncertainties.join(' ')}
                  </div>
                )}

                <div className="consideration-detail-block">
                  <span>Radiologist / clinician verification needed:</span>{' '}
                  {img.clinician_verification_needed}
                </div>
                <p className="finding-copy">{img.limitation_note}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 3. AI-Generated Diagnostic Considerations + Simple Explanation */}
      <section
        className="report-editorial-block"
        aria-labelledby="rep-considerations-heading"
      >
        <div className="report-block-header">
          <span className="report-section-num">03</span>
          <div>
            <h4 id="rep-considerations-heading">
              Possible Conditions &amp; Simple Explanations
            </h4>
            <p className="report-block-subtitle">
              AI-generated possibilities for clinician review—not a confirmed diagnosis.
            </p>
          </div>
        </div>

        {report.possible_diagnostic_considerations.length === 0 ? (
          <p className="empty-state">
            No specific diagnostic pattern was generated because clinical or verified
            evidence inputs were insufficient.
          </p>
        ) : (
          <div className="considerations-stack">
            {report.possible_diagnostic_considerations.map((item, idx) => (
              <article
                key={`${item.condition_or_pattern}-${idx}`}
                className="consideration-editorial-card"
              >
                <div className="consideration-card-head">
                  <div>
                    <span className="consideration-ai-tag">
                      AI Decision-Support Consideration
                    </span>
                    <h5>{item.condition_or_pattern}</h5>
                  </div>
                  {item.cited_chunk_ids.length > 0 && (
                    <div className="citation-chip-row">
                      {item.cited_chunk_ids.map((cid) => {
                        const matched = sourceByChunkId.get(cid)
                        return (
                          <span
                            key={cid}
                            className="citation-chip"
                            title={
                              matched
                                ? `${matched.source_publisher} — ${matched.document_title}`
                                : cid
                            }
                          >
                            Ref: <code>{cid}</code>
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>

                {item.plain_language_explanation && (
                  <div className="consideration-detail-block">
                    <span>What might be happening inside the body:</span>{' '}
                    {item.plain_language_explanation}
                  </div>
                )}

                <div className="consideration-detail-block">
                  <span>Why the patient&apos;s findings point toward this possibility:</span>{' '}
                  {item.why_findings_point_here || item.rationale}
                </div>

                {item.supporting_observed_evidence.length > 0 && (
                  <div className="consideration-evidence-tags">
                    <span className="tags-label">Supporting observations:</span>
                    <div className="pill-tag-wrap">
                      {item.supporting_observed_evidence.map((ev, evIdx) => (
                        <span key={evIdx} className="observation-tag">
                          {ev}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {item.uncertainty_note && (
                  <div className="uncertainty-callout">
                    <strong>What remains uncertain:</strong> {item.uncertainty_note}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 4. Supporting Medical Evidence and Sources (Verified Provenance) */}
      <section
        className="report-editorial-block report-evidence-block"
        aria-labelledby="rep-sources-heading"
      >
        <div className="report-block-header">
          <span className="report-section-num report-section-num-blue">04</span>
          <div>
            <h4 id="rep-sources-heading">Supporting Medical References</h4>
            <p className="report-block-subtitle">
              Verified medical document passages retrieved from the Knowledge Base.
            </p>
          </div>
        </div>

        <p className="evidence-narrative">
          {sanitizeClinicalAiText(report.supporting_medical_evidence)}
        </p>

        {report.retrieved_sources.length === 0 ? (
          <div className="insufficient-evidence-box" role="status">
            <strong>
              No matching verified medical documents were retrieved for this case.
            </strong>
            <p>
              Upload relevant clinical guidelines in the Knowledge Base to enable
              citation-backed retrieval for similar queries.
            </p>
          </div>
        ) : (
          <div className="sources-stack">
            {report.retrieved_sources.map((src) => {
              const safeUrl = getSafeExternalUrl(src.source_url)
              return (
                <article key={src.chunk_id} className="source-reference-card">
                  <div className="source-ref-header">
                    <div>
                      <strong>{src.document_title}</strong>
                      <div className="source-publisher-line">
                        <span>{src.source_publisher}</span>
                        {src.publication_date && <span> · {src.publication_date}</span>}
                        {src.section_heading && <span> · {src.section_heading}</span>}
                        {src.page_number != null && <span> · p. {src.page_number}</span>}
                      </div>
                    </div>
                    <span className="status-pill pill-ready">
                      Match {(src.similarity_score * 100).toFixed(0)}%
                    </span>
                  </div>

                  <blockquote className="source-excerpt">{src.excerpt}</blockquote>

                  <div className="source-ref-footer">
                    <span>
                      Citation ID: <code className="chunk-id-code">{src.chunk_id}</code>
                    </span>
                    {safeUrl && (
                      <a
                        href={safeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="source-link"
                      >
                        View Reference Source ↗
                      </a>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* 5. Additional Information Needed */}
      <section className="report-editorial-block" aria-labelledby="rep-missing-heading">
        <div className="report-block-header">
          <span className="report-section-num">05</span>
          <div>
            <h4 id="rep-missing-heading">Additional Information Needed</h4>
            <p className="report-block-subtitle">
              Tests, history, or follow-up details that would clarify diagnostic certainty.
            </p>
          </div>
        </div>

        {report.additional_information_required.length === 0 ? (
          <p className="empty-state">No major missing clinical items identified.</p>
        ) : (
          <ul className="report-bullet-list">
            {report.additional_information_required.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        )}
      </section>

      {/* 6. Suggested Next Steps & Grounded Treatment Support */}
      <section className="report-editorial-block" aria-labelledby="rep-nextsteps-heading">
        <div className="report-block-header">
          <span className="report-section-num">06</span>
          <div className="report-block-title-row">
            <div>
              <h4 id="rep-nextsteps-heading">Next Steps &amp; Care Guidance</h4>
              <p className="report-block-subtitle">
                Questions to ask your doctor and evidence-backed guidance.
              </p>
            </div>
            <span
              className={`status-pill ${
                treatment.grounded_in_verified_references ? 'pill-ready' : 'pill-warn'
              }`}
            >
              {treatment.grounded_in_verified_references
                ? 'Grounded in Verified Sources'
                : 'Withheld — Insufficient Evidence'}
            </span>
          </div>
        </div>

        {discussionPoints.length > 0 && (
          <div className="next-steps-subsection">
            <strong>Questions &amp; Topics to Discuss with a Clinician</strong>
            <ul className="report-bullet-list">
              {discussionPoints.map((point, idx) => (
                <li key={idx}>{point}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="next-steps-subsection">
          <strong>Evidence-Based Care &amp; Management Context</strong>
          <p className="evidence-status-note">
            {sanitizeClinicalAiText(treatment.status_note)}
          </p>

          {treatment.grounded_in_verified_references &&
          treatment.guidance_items.length > 0 ? (
            <>
              <ul className="report-bullet-list">
                {treatment.guidance_items.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
              {treatment.cited_chunk_ids.length > 0 && (
                <div className="citation-chip-row">
                  {treatment.cited_chunk_ids.map((cid) => (
                    <span key={cid} className="citation-chip">
                      Grounded Citation: <code>{cid}</code>
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="insufficient-evidence-box" role="status">
              <strong>
                Treatment Guidance Withheld Due to Insufficient Verified Evidence
              </strong>
              <p>
                We only show specific treatment steps when matching medical reference
                documents clearly support them. Consult a licensed clinician for
                individualized medication or treatment decisions.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* 7. Emergency Warnings & Safety Boundaries */}
      <section
        className="report-editorial-block report-warning-block"
        aria-labelledby="rep-warnings-heading"
      >
        <div className="report-block-header">
          <span className="report-section-num report-section-num-amber">07</span>
          <div>
            <h4 id="rep-warnings-heading">Emergency Warnings</h4>
            <p className="report-block-subtitle">
              Warning signs requiring urgent care and clinical limitations.
            </p>
          </div>
        </div>

        {report.risk_indicators_and_safety_warnings.length > 0 && (
          <div className="next-steps-subsection">
            <strong>When to Seek Urgent Medical Evaluation</strong>
            <ul className="report-bullet-list">
              {report.risk_indicators_and_safety_warnings.map((warn, idx) => (
                <li key={idx}>{warn}</li>
              ))}
            </ul>
          </div>
        )}

        {report.clinical_limitations.length > 0 && (
          <div className="next-steps-subsection">
            <strong>Important Limitations</strong>
            <ul className="report-bullet-list">
              {report.clinical_limitations.map((lim, idx) => (
                <li key={idx}>{lim}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="disclaimer-footnote">
          {sanitizeClinicalAiText(report.clinician_review_disclaimer)}
        </p>
      </section>
    </div>
  )
}
