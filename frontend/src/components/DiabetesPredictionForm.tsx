import { useState } from 'react'
import { submitDiabetesPrediction } from '../api/predictions'
import type {
  DiabetesPredictionResponse,
  PredictiveModelHealth,
} from '../types/prediction'
import {
  EMPTY_PIMA_VALUES,
  PIMA_FEATURE_FIELDS,
  type PimaFeatureKey,
  validatePimaFeatureStrings,
} from '../utils/assessmentValidation'

interface DiabetesPredictionFormProps {
  health: PredictiveModelHealth | null
  healthError: string | null
  checkingHealth: boolean
  result: DiabetesPredictionResponse | null
  onResultChange: (nextResult: DiabetesPredictionResponse | null) => void
  onRefreshHealth: () => void
}

function formatPercent(probability: number): string {
  return `${(probability * 100).toFixed(2)}%`
}

export function DiabetesPredictionForm({
  health,
  healthError,
  checkingHealth,
  result,
  onResultChange,
  onRefreshHealth,
}: DiabetesPredictionFormProps) {
  const [values, setValues] =
    useState<Record<PimaFeatureKey, string>>(EMPTY_PIMA_VALUES)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<PimaFeatureKey, string>>
  >({})
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const isModelReady = Boolean(
    health && health.status === 'ready' && !healthError,
  )

  function handleChange(key: PimaFeatureKey, rawValue: string) {
    setValues((prev) => ({ ...prev, [key]: rawValue }))
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setApiError(null)

    if (!isModelReady) {
      onResultChange(null)
      setApiError('Prediction is disabled until the predictive model reports ready.')
      return
    }

    const { parsed, errors } = validatePimaFeatureStrings(values)
    setFieldErrors(errors)
    if (!parsed) {
      return
    }

    setSubmitting(true)
    try {
      const prediction = await submitDiabetesPrediction(parsed)
      onResultChange(prediction)
    } catch (err: unknown) {
      onResultChange(null)
      setApiError(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred while running the prediction.',
      )
      onRefreshHealth()
    } finally {
      setSubmitting(false)
    }
  }

  function handleReset() {
    setValues(EMPTY_PIMA_VALUES)
    setFieldErrors({})
    setApiError(null)
    onResultChange(null)
  }

  const visibleResult = isModelReady ? result : null

  return (
    <div className="experiment-container">
      <div className="context-banner" role="note">
        <strong>Dataset-Specific Research Experiment (Not a General Patient Assessment):</strong>{' '}
        This standalone tool runs the pre-trained Pima Indians Diabetes XGBoost model
        using its eight fixed numerical features. General patient intake uses the{' '}
        <strong>New Patient Assessment</strong> workflow.
      </div>

      <div className="assessment-grid">
        <section className="panel" aria-labelledby="assessment-form-heading">
          <div className="panel-header">
            <div>
              <span className="badge">Predictive AI Experiment • Research Prototype</span>
              <h3 id="assessment-form-heading">
                Diabetes Prediction Experiment (8 Pima Features)
              </h3>
            </div>
            <div className="status-controls">
              {checkingHealth ? (
                <span className="status-pill status-neutral">Checking model…</span>
              ) : isModelReady ? (
                <span className="status-pill status-ready">Model ready</span>
              ) : healthError ? (
                <span className="status-pill status-error">Backend unreachable</span>
              ) : (
                <span className="status-pill status-warn">Model unavailable</span>
              )}
              <button
                type="button"
                className="btn-secondary btn-xs"
                onClick={onRefreshHealth}
                disabled={checkingHealth}
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="preprocessing-note">
            <strong>Zero-as-Missing Preprocessing Rule:</strong> In the Pima dataset,{' '}
            <code>0</code> in <code>Glucose</code>, <code>BloodPressure</code>,{' '}
            <code>SkinThickness</code>, <code>Insulin</code>, or <code>BMI</code> represents
            an unrecorded measurement and is replaced during inference with the saved
            training-fitted median. <code>Pregnancies = 0</code> is retained as zero.
          </div>

          {healthError && (
            <div className="alert alert-error" role="alert">
              <strong>Backend unavailable:</strong> {healthError}
            </div>
          )}

          {!healthError && health && health.status !== 'ready' && (
            <div className="alert alert-warn" role="status">
              <strong>Model unavailable:</strong>{' '}
              {health.detail ?? 'Predictive model artifacts are currently unavailable.'}{' '}
              Submission is disabled until artifacts are loaded.
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="fields-grid">
              {PIMA_FEATURE_FIELDS.map((field) => {
                const error = fieldErrors[field.key]
                const inputId = `standalone-feature-${field.key}`
                return (
                  <div key={field.key} className="field-group">
                    <label htmlFor={inputId} className="field-label">
                      <span>{field.label}</span>
                      <span className="field-unit">{field.unit}</span>
                    </label>
                    <input
                      id={inputId}
                      name={field.key}
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      required
                      value={values[field.key]}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      placeholder={
                        field.zeroAsMissing && field.plausibleMin !== undefined
                          ? `0 or ${field.plausibleMin}–${field.max}`
                          : `${field.min}–${field.max}`
                      }
                      aria-invalid={Boolean(error)}
                      aria-describedby={`${inputId}-help`}
                      className={error ? 'input-error' : undefined}
                    />
                    {error ? (
                      <span id={`${inputId}-help`} className="error-text" role="alert">
                        {error}
                      </span>
                    ) : (
                      <span id={`${inputId}-help`} className="help-text">
                        {field.hint}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {apiError && (
              <div className="alert alert-error" role="alert">
                <strong>Prediction unavailable:</strong> {apiError}
              </div>
            )}

            <div className="form-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={!isModelReady || submitting}
              >
                {submitting
                  ? 'Estimating…'
                  : isModelReady
                    ? 'Run Research Prediction'
                    : 'Model Unavailable'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleReset}
                disabled={submitting}
              >
                Clear Inputs
              </button>
            </div>
          </form>
        </section>

        <aside className="panel results-panel" aria-labelledby="results-heading">
          <div className="panel-header">
            <div>
              <span className="badge badge-neutral">Research Output</span>
              <h3 id="results-heading">Model-Estimated Probabilities</h3>
            </div>
          </div>

          <div className="disclaimer-box" role="note">
            <strong>Research Prototype Output — Not Clinical Certainty:</strong>{' '}
            Probabilities reflect statistical patterns learned from historical Pima
            tabular data. They do not represent clinical risk certainty, a medical
            diagnosis, or treatment advice.
          </div>

          {!isModelReady ? (
            <div className="empty-result empty-unavailable" role="status">
              <strong>
                {checkingHealth
                  ? 'Checking predictive model readiness…'
                  : 'Prediction results unavailable'}
              </strong>
              <p>
                {checkingHealth
                  ? 'Waiting for the backend model readiness check to complete.'
                  : 'No prediction outputs are shown while the backend or predictive model artifacts are unavailable.'}
              </p>
            </div>
          ) : visibleResult ? (
            <div className="result-content">
              <div className="predicted-class-card">
                <span className="result-label">Research Experiment Predicted Class</span>
                <strong className="result-class-value">
                  Class {visibleResult.predicted_class}
                </strong>
                <span className="result-class-note">
                  {visibleResult.predicted_class === 1
                    ? 'Statistical pattern aligned with positive-class training labels (not a diagnosis)'
                    : 'Statistical pattern aligned with negative-class training labels (not a clearance)'}
                </span>
              </div>

              <div className="prob-list">
                <div className="prob-item">
                  <div className="prob-header">
                    <span>Class 0 Model-Estimated Probability</span>
                    <strong>{formatPercent(visibleResult.class_0_probability)}</strong>
                  </div>
                  <div className="prob-bar-track" aria-hidden="true">
                    <div
                      className="prob-bar-fill prob-bar-zero"
                      style={{
                        width: `${Math.min(100, Math.max(0, visibleResult.class_0_probability * 100))}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="prob-item">
                  <div className="prob-header">
                    <span>Class 1 Model-Estimated Probability</span>
                    <strong>{formatPercent(visibleResult.class_1_probability)}</strong>
                  </div>
                  <div className="prob-bar-track" aria-hidden="true">
                    <div
                      className="prob-bar-fill prob-bar-one"
                      style={{
                        width: `${Math.min(100, Math.max(0, visibleResult.class_1_probability * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <dl className="metadata-list">
                <div>
                  <dt>Module</dt>
                  <dd>{visibleResult.module_name}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{visibleResult.model_name}</dd>
                </div>
                <div>
                  <dt>Experiment Version</dt>
                  <dd>{visibleResult.model_version}</dd>
                </div>
              </dl>

              <div className="api-disclaimer">
                <strong>Model Disclaimer:</strong> {visibleResult.clinical_disclaimer}
              </div>
            </div>
          ) : (
            <div className="empty-result">
              <strong>Awaiting Input Submission</strong>
              <p>
                Enter the eight dataset features and submit to inspect statistical
                research estimates from the loaded model.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
