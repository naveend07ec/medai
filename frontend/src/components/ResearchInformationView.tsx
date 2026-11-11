import type {
  DiabetesPredictionResponse,
  PredictiveModelHealth,
} from '../types/prediction'
import { DiabetesPredictionForm } from './DiabetesPredictionForm'
import { StatusBadge } from './StatusBadge'

interface ResearchInformationViewProps {
  health: PredictiveModelHealth | null
  healthError: string | null
  checkingHealth: boolean
  predictionResult: DiabetesPredictionResponse | null
  onPredictionResultChange: (nextResult: DiabetesPredictionResponse | null) => void
  onRefreshHealth: () => void
}

export function ResearchInformationView({
  health,
  healthError,
  checkingHealth,
  predictionResult,
  onPredictionResultChange,
  onRefreshHealth,
}: ResearchInformationViewProps) {
  return (
    <div className="research-container">
      <section className="panel research-intro-panel" aria-labelledby="research-title">
        <div className="research-header-row">
          <div>
            <span className="hero-eyebrow">Secondary Academic Documentation • Review 0 &amp; Review 1</span>
            <h2 id="research-title">
              Research Methodology, Experiments &amp; System Architecture
            </h2>
          </div>
          <span className="project-code-badge">Project 27CSPS028</span>
        </div>
        <p>
          This secondary section documents how the three core engineering modules
          proposed in Review 0 and Review 1 support the main patient-facing workflow,
          and provides direct academic access to the standalone Pima diabetes predictive
          experiment.
        </p>
      </section>

      <div className="research-cards-grid">
        <article className="panel research-card">
          <div className="component-card-header">
            <h3>1. Data Analysis &amp; Preprocessing</h3>
            <StatusBadge status="In Development" />
          </div>
          <p>
            Prepares heterogeneous healthcare inputs (patient demographics, EHR,
            symptoms, measurements, imaging, genomic context) for AI inference.
          </p>
          <ul className="clean-list">
            <li>
              <strong>Implemented:</strong> SQLAlchemy 2.x <code>Patient</code> identity
              model &amp; schemas; saved training-fitted median imputation (
              <code>imputation_values.json</code>) for Pima features.
            </li>
            <li>
              <strong>Planned:</strong> EHR persistence, general symptom/vital APIs,
              medical imaging preprocessing, and genomic pipelines.
            </li>
          </ul>
        </article>

        <article className="panel research-card">
          <div className="component-card-header">
            <h3>2. Predictive Model Experiments</h3>
            <StatusBadge status="Completed Experiment" />
          </div>
          <p>
            Random Forest and XGBoost diabetes prediction experiments were trained and
            evaluated on the Pima Indians Diabetes dataset in Google Colab.
          </p>
          <ul className="clean-list">
            <li>
              <strong>Live Prototype:</strong> Pre-trained XGBoost model (
              <code>xgboost_diabetes_model.pkl</code>) integrated via{' '}
              <code>POST /api/v1/predictions/diabetes</code>.
            </li>
            <li>
              <strong>Scope Note:</strong> Represents a single disease-specific
              tabular experiment, not a full generative or multimodal diagnosis.
            </li>
          </ul>
        </article>

        <article className="panel research-card">
          <div className="component-card-header">
            <h3>3. GAN &amp; Synthetic Data Evaluation</h3>
            <StatusBadge status="Completed Experiment" />
          </div>
          <p>
            Generator and discriminator architectures were studied in Colab to synthesize
            tabular healthcare cohorts and evaluate statistical similarity against real
            distributions.
          </p>
          <ul className="clean-list">
            <li>
              <strong>Role in System:</strong> Supports privacy-preserving model
              prototyping and data augmentation research without exposing real patient
              identities.
            </li>
            <li>
              <strong>Integration Status:</strong> Colab experiment completed; exported
              weights are not yet placed in <code>ai-artifacts/generative/</code>.
            </li>
          </ul>
        </article>

        <article className="panel research-card">
          <div className="component-card-header">
            <h3>4. Homomorphic Encryption &amp; Privacy</h3>
            <StatusBadge status="Completed Experiment" />
          </div>
          <p>
            Privacy-preserving multi-institution analytics researched using Paillier
            homomorphic encryption and simulated multi-hospital encrypted aggregation,
            alongside federated learning research direction.
          </p>
          <ul className="clean-list">
            <li>
              <strong>Runtime Safeguards:</strong> Patient identity separated from
              clinical/AI tables; environment-driven secrets; non-logging prediction
              endpoints.
            </li>
            <li>
              <strong>Clinician Governance:</strong> GenAI insights, Medical RAG, and
              treatment support are planned strictly as clinician-reviewed aids without
              autonomous prescribing.
            </li>
          </ul>
        </article>
      </div>

      <section
        className="research-experiment-section"
        aria-labelledby="standalone-pima-heading"
      >
        <div className="section-heading-row">
          <h3 id="standalone-pima-heading">
            Standalone Experiment Demo — Pima Diabetes XGBoost Model
          </h3>
          <span className="section-caption">
            Preserved 8-feature research interface connected to FastAPI
          </span>
        </div>
        <DiabetesPredictionForm
          health={health}
          healthError={healthError}
          checkingHealth={checkingHealth}
          result={predictionResult}
          onResultChange={onPredictionResultChange}
          onRefreshHealth={onRefreshHealth}
        />
      </section>
    </div>
  )
}

