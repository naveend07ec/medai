import json
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.database import Base, get_db
from app.main import app
from app.services.generative_ai import clinical_response_service, gemini_service
from app.services.medical_rag import rag_service
from app.services.medical_rag.document_ingestion_service import DocumentIngestionService
from app.services.medical_rag.embedding_service import GeminiEmbeddingService
from app.services.medical_rag.retrieval_service import (
    KnowledgeRetrievalService,
    retrieval_service,
)


@pytest.fixture()
def report_api_client(tmp_path):
    """Provide a TestClient backed by an isolated temporary SQLite database."""
    db_file = tmp_path / "genai_report_test.db"
    test_engine = create_engine(
        f"sqlite:///{db_file.as_posix()}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(test_engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=test_engine,
    )
    Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db: Session = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client, TestingSessionLocal
    finally:
        app.dependency_overrides.clear()
        gemini_service._settings_override = None
        rag_service._settings_override = None
        rag_service._retrieval_service = retrieval_service
        retrieval_service._settings_override = None
        clinical_response_service._rag_service = rag_service
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def _create_sample_patient_and_assessment(
    client: TestClient,
    *,
    current_symptoms: str = "Persistent fatigue and polyuria",
    oxygen_saturation: int = 98,
    systolic_bp: int = 144,
    diastolic_bp: int = 88,
) -> tuple[str, str]:
    patient_res = client.post(
        "/api/v1/patients",
        json={
            "full_name": "Kavita Sharma",
            "date_of_birth": "1978-08-22",
            "patient_code": f"PT-GENAI-{uuid4().hex[:6]}",
            "sex": "Female",
            "contact_number": "+919900112233",
        },
    )
    assert patient_res.status_code == 201
    patient_id = patient_res.json()["id"]

    assessment_res = client.post(
        "/api/v1/assessments",
        json={
            "patient_id": patient_id,
            "current_symptoms": current_symptoms,
            "symptom_duration": "3 weeks",
            "previous_conditions": "Hypertension",
            "existing_medications": "Amlodipine 5 mg daily",
            "medical_history_notes": "Known Allergies: Penicillin; email kavita.sharma@example.com",
            "systolic_bp": systolic_bp,
            "diastolic_bp": diastolic_bp,
            "heart_rate": 84,
            "body_temperature": 36.9,
            "oxygen_saturation": oxygen_saturation,
            "lab_results": "Fasting glucose 142 mg/dL; HbA1c pending",
            "attached_report_names": ["metabolic_panel.pdf"],
            "attached_images": [
                {"name": "retinal_photo.png", "size_label": "250 KB", "type": "image/png"}
            ],
            "predictive_experiment_result": {
                "executed": True,
                "status": "completed",
                "result": {
                    "predicted_class": 1,
                    "class_0_probability": 0.28,
                    "class_1_probability": 0.72,
                    "model_name": "xgboost_diabetes_model",
                    "model_version": "pima-colab-v1",
                    "module_name": "Diabetes prediction experiment",
                    "clinical_disclaimer": "Research prototype output only.",
                },
                "message": "Completed",
            },
        },
    )
    assert assessment_res.status_code == 201
    return patient_id, assessment_res.json()["id"]


def test_genai_unavailable_without_api_key_returns_503(
    report_api_client, monkeypatch
):
    """Missing GEMINI_API_KEY marks service unavailable and refuses fake reports."""
    client, _ = report_api_client
    cfg = Settings(
        _env_file=None,
        GEMINI_API_KEY=None,
        GENAI_API_KEY=None,
        GEMINI_MODEL="gemini-2.5-flash",
    )
    monkeypatch.setattr(gemini_service, "_settings_override", cfg)
    monkeypatch.setattr(rag_service, "_settings_override", cfg)

    _, assessment_id = _create_sample_patient_and_assessment(client)

    health_res = client.get("/api/v1/assessments/genai/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "unavailable"
    assert health_res.json()["provider"] == "gemini"

    gen_res = client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert gen_res.status_code == 503
    assert "not configured" in gen_res.json()["detail"].lower()

    get_res = client.get(f"/api/v1/assessments/{assessment_id}/report")
    assert get_res.status_code == 404


def test_emergency_assessment_when_gemini_unavailable_returns_503_with_emergency_alert(
    report_api_client, monkeypatch
):
    """Emergency screening works independently even when Gemini cannot be reached."""
    client, _ = report_api_client
    cfg = Settings(
        _env_file=None,
        GEMINI_API_KEY=None,
        GENAI_API_KEY=None,
        GEMINI_MODEL="gemini-2.5-flash",
    )
    monkeypatch.setattr(gemini_service, "_settings_override", cfg)
    monkeypatch.setattr(rag_service, "_settings_override", cfg)

    _, assessment_id = _create_sample_patient_and_assessment(
        client,
        current_symptoms="Acute crushing chest pain and shortness of breath",
        oxygen_saturation=87,
        systolic_bp=190,
        diastolic_bp=122,
    )

    gen_res = client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert gen_res.status_code == 503
    payload = gen_res.json()
    assert payload["generated_by_gemini"] is False
    assert payload["emergency_alert"]["emergency_detected"] is True
    assert payload["emergency_alert"]["urgency_level"] == "emergency"
    assert len(payload["emergency_alert"]["matched_patterns"]) >= 2
    assert client.get(f"/api/v1/assessments/{assessment_id}/report").status_code == 404


def test_generate_persist_retrieve_and_review_grounded_report(
    report_api_client, monkeypatch
):
    """End-to-end 9-section report generation with verified RAG citations, PII stripping, and review sync."""
    client, SessionLocal = report_api_client
    cfg = Settings(
        _env_file=None,
        GEMINI_API_KEY="test-placeholder-key",
        GEMINI_MODEL="gemini-2.5-flash",
        GEMINI_EMBEDDING_DIMENSION=3,
        RAG_TOP_K=3,
        RAG_MIN_SIMILARITY=0.50,
    )
    monkeypatch.setattr(gemini_service, "_settings_override", cfg)
    monkeypatch.setattr(rag_service, "_settings_override", cfg)

    # Seed one verified public medical document chunk into the test database.
    fake_embed_svc = GeminiEmbeddingService(settings_override=cfg)
    monkeypatch.setattr(
        fake_embed_svc,
        "embed_texts",
        lambda texts, task_type="RETRIEVAL_DOCUMENT": [[0.9, 0.1, 0.0] for _ in texts],
    )
    with SessionLocal() as db:
        ingestion = DocumentIngestionService(embedding_svc=fake_embed_svc, settings_override=cfg)
        doc = ingestion.ingest_document(
            db,
            file_bytes=(
                b"# Hyperglycemia Evaluation\n\n"
                b"Symptomatic fasting glucose >= 126 mg/dL warrants confirmatory HbA1c "
                b"and basic metabolic panel assessment before finalizing care plans.\n"
            ),
            file_name="metabolic_guidance.md",
            title="Public Metabolic Evaluation Reference",
            source_publisher="NIDDK Public Health Reference",
            source_url="https://example.org/metabolic-reference",
        )
        seeded_chunk_id = str(doc.chunks[0].id)

    retrieval_svc = KnowledgeRetrievalService(
        embedding_svc=fake_embed_svc,
        settings_override=cfg,
    )
    monkeypatch.setattr(rag_service, "_retrieval_service", retrieval_svc)

    recorded_prompts: list[str] = []

    class FakeModels:
        def generate_content(self, *, model, contents, config):
            del model, config
            recorded_prompts.append(contents)
            return SimpleNamespace(
                text=json.dumps(
                    {
                        "patient_context_summary": (
                            "You are an adult who has been feeling unusually tired and urinating more often "
                            "for the past 3 weeks, with slightly raised blood pressure and blood sugar."
                        ),
                        "finding_explanations": [
                            {
                                "finding_name": "Fasting Blood Sugar",
                                "observed_value": "142 mg/dL",
                                "reference_range_note": "Typical normal fasting blood sugar is 99 mg/dL or below.",
                                "status_flag": "outside_range",
                                "plain_language_meaning": "This test measures sugar in your blood after not eating overnight.",
                                "why_it_matters": "Readings above typical levels can cause extra thirst and frequent urination.",
                            }
                        ],
                        "possible_diagnostic_considerations": [
                            {
                                "condition_or_pattern": "High Blood Sugar Pattern (Dysglycemia)",
                                "plain_language_explanation": "This means your body may not be moving sugar out of your blood into cells as easily as usual.",
                                "why_findings_point_here": "Feeling tired and urinating often along with a fasting blood sugar of 142 mg/dL makes this worth checking.",
                                "supporting_observed_evidence": [
                                    "Fasting glucose 142 mg/dL",
                                    "Reported polyuria and fatigue for 3 weeks",
                                ],
                                "cited_chunk_ids": [seeded_chunk_id],
                                "rationale": "Fasting glucose with frequent urination warrants repeat testing.",
                                "uncertainty_note": "Your 3-month average sugar test (HbA1c) is still pending, so nothing is confirmed yet.",
                            }
                        ],
                        "supporting_medical_evidence": (
                            "The retrieved NIDDK guide explains that a fasting blood sugar of 126 mg/dL or higher "
                            "should be checked again with a repeat test or HbA1c blood test."
                        ),
                        "additional_information_required": [
                            "Confirmatory HbA1c (3-month average blood sugar) and repeat fasting glucose results are pending."
                        ],
                        "doctor_discussion_points": [
                            "Ask your doctor when your HbA1c test result will be ready to review."
                        ],
                        "risk_indicators_and_safety_warnings": [
                            "Your blood pressure was slightly raised (144/88 mm Hg); ask your clinician to recheck it."
                        ],
                        "treatment_and_management_guidance": [
                            "Discuss confirmatory HbA1c testing and lifestyle evaluation with the reviewing clinician."
                        ],
                        "cited_chunk_ids": [seeded_chunk_id],
                        "clinical_limitations": [
                            "Medical images and uploaded PDF report files were not parsed automatically."
                        ],
                    }
                )
            )

    monkeypatch.setattr(
        gemini_service,
        "_build_client",
        lambda _cfg: SimpleNamespace(models=FakeModels()),
    )

    _, assessment_id = _create_sample_patient_and_assessment(client)

    health_res = client.get("/api/v1/assessments/genai/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "ready"
    assert health_res.json()["rag_connected"] is True

    gen_res = client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert gen_res.status_code == 201
    created = gen_res.json()

    # Verify PII was NOT sent to Gemini
    assert len(recorded_prompts) == 1
    assert "Kavita Sharma" not in recorded_prompts[0]
    assert "1978-08-22" not in recorded_prompts[0]
    assert "+919900112233" not in recorded_prompts[0]
    assert "kavita.sharma@example.com" not in recorded_prompts[0]

    report = created["report"]
    # Verify plain-language breakdown and structured sections
    assert report["patient_context_summary"]
    assert len(report["finding_explanations"]) == 1
    assert report["finding_explanations"][0]["status_flag"] == "outside_range"
    assert any("Persistent fatigue and polyuria" in f for f in report["relevant_clinical_findings"])
    assert len(report["possible_diagnostic_considerations"]) == 1
    assert report["possible_diagnostic_considerations"][0]["plain_language_explanation"]
    assert report["possible_diagnostic_considerations"][0]["why_findings_point_here"]
    assert report["possible_diagnostic_considerations"][0]["cited_chunk_ids"] == [seeded_chunk_id]
    assert len(report["doctor_discussion_points"]) == 1
    assert "HbA1c" in report["supporting_medical_evidence"]
    assert any("HbA1c" in m for m in report["additional_information_required"])
    assert len(report["risk_indicators_and_safety_warnings"]) >= 1

    treatment = report["treatment_and_management_information"]
    assert treatment["grounded_in_verified_references"] is True
    assert treatment["cited_chunk_ids"] == [seeded_chunk_id]
    assert len(treatment["guidance_items"]) == 1

    assert len(report["clinical_limitations"]) >= 1
    assert len(report["retrieved_sources"]) == 1
    assert report["retrieved_sources"][0]["chunk_id"] == seeded_chunk_id

    assert report["emergency_alert"]["emergency_detected"] is False
    assert report["predictive_ml_output"]["included"] is True
    assert "XGBoost" in report["predictive_ml_output"]["summary"]
    assert "not a confirmed medical diagnosis" in report["clinician_review_disclaimer"].lower()
    assert "GAN" in report["research_context_note"]
    assert "Paillier" in report["research_context_note"]

    # Persistence check via GET
    get_res = client.get(f"/api/v1/assessments/{assessment_id}/report")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == created["id"]

    # Clinician review check via PATCH
    review_res = client.patch(
        f"/api/v1/assessments/{assessment_id}/report/review",
        json={
            "clinician_reviewed": True,
            "clinician_notes": "Ordered confirmatory HbA1c and repeat BP check.",
        },
    )
    assert review_res.status_code == 200
    reviewed = review_res.json()
    assert reviewed["clinician_reviewed"] is True
    assert reviewed["clinician_notes"] == "Ordered confirmatory HbA1c and repeat BP check."
    assert reviewed["reviewed_at"] is not None

    asm_res = client.get(f"/api/v1/assessments/{assessment_id}")
    assert asm_res.status_code == 200
    assert asm_res.json()["clinician_reviewed"] is True


def test_report_with_insufficient_rag_evidence_blocks_unverified_treatment_guidance(
    report_api_client, monkeypatch
):
    """When KB returns insufficient evidence, Section 7 stays ungrounded with zero treatment guidance."""
    client, _ = report_api_client
    cfg = Settings(
        _env_file=None,
        GEMINI_API_KEY="test-placeholder-key",
        GEMINI_MODEL="gemini-2.5-flash",
        GEMINI_EMBEDDING_DIMENSION=3,
    )
    monkeypatch.setattr(gemini_service, "_settings_override", cfg)
    monkeypatch.setattr(rag_service, "_settings_override", cfg)

    fake_embed_svc = GeminiEmbeddingService(settings_override=cfg)
    monkeypatch.setattr(
        fake_embed_svc,
        "embed_texts",
        lambda texts, task_type="RETRIEVAL_QUERY": [[0.1, 0.2, 0.3] for _ in texts],
    )
    monkeypatch.setattr(
        rag_service,
        "_retrieval_service",
        KnowledgeRetrievalService(embedding_svc=fake_embed_svc, settings_override=cfg),
    )

    class FakeModels:
        def generate_content(self, **_kwargs):
            return SimpleNamespace(
                text=json.dumps(
                    {
                        "patient_context_summary": "Adult presenting with persistent fatigue and polyuria.",
                        "possible_diagnostic_considerations": [
                            {
                                "condition_or_pattern": "Metabolic Hyperglycemia Consideration",
                                "supporting_observed_evidence": ["Fasting glucose 142 mg/dL"],
                                "cited_chunk_ids": [],
                                "rationale": "Elevated fasting glucose warrants laboratory follow-up.",
                                "uncertainty_note": "Insufficient local KB documents found for treatment grounding.",
                            }
                        ],
                        "supporting_medical_evidence": (
                            "No indexed medical reference chunks met the configured similarity threshold."
                        ),
                        "additional_information_required": ["Confirmatory HbA1c pending."],
                        "risk_indicators_and_safety_warnings": ["Monitor for worsening osmotic symptoms."],
                        "treatment_and_management_guidance": [],
                        "cited_chunk_ids": [],
                        "clinical_limitations": ["Local RAG knowledge base had no matching sources."],
                    }
                )
            )

    monkeypatch.setattr(
        gemini_service,
        "_build_client",
        lambda _cfg: SimpleNamespace(models=FakeModels()),
    )

    _, assessment_id = _create_sample_patient_and_assessment(client)
    res = client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert res.status_code == 201
    report = res.json()["report"]
    assert report["evidence_sufficient"] is False
    assert report["retrieved_sources"] == []
    treatment = report["treatment_and_management_information"]
    assert treatment["grounded_in_verified_references"] is False
    assert treatment["cited_chunk_ids"] == []
    assert treatment["guidance_items"] == []


def test_malformed_provider_output_and_missing_assessment(
    report_api_client, monkeypatch
):
    """Malformed Gemini JSON returns 502; missing assessment returns 404."""
    client, _ = report_api_client
    cfg = Settings(
        _env_file=None,
        GEMINI_API_KEY="test-placeholder-key",
        GEMINI_MODEL="gemini-2.5-flash",
        GEMINI_EMBEDDING_DIMENSION=3,
    )
    monkeypatch.setattr(gemini_service, "_settings_override", cfg)
    monkeypatch.setattr(rag_service, "_settings_override", cfg)

    fake_embed_svc = GeminiEmbeddingService(settings_override=cfg)
    monkeypatch.setattr(
        fake_embed_svc,
        "embed_texts",
        lambda texts, task_type="RETRIEVAL_QUERY": [[0.1, 0.2, 0.3] for _ in texts],
    )
    monkeypatch.setattr(
        rag_service,
        "_retrieval_service",
        KnowledgeRetrievalService(embedding_svc=fake_embed_svc, settings_override=cfg),
    )

    missing_res = client.post(f"/api/v1/assessments/{uuid4()}/generate-report")
    assert missing_res.status_code == 404

    class BadJsonModels:
        def generate_content(self, **_kwargs):
            return SimpleNamespace(text="not valid json at all")

    monkeypatch.setattr(
        gemini_service,
        "_build_client",
        lambda _cfg: SimpleNamespace(models=BadJsonModels()),
    )
    _, assessment_id = _create_sample_patient_and_assessment(client)
    bad_res = client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert bad_res.status_code == 502
    assert client.get(f"/api/v1/assessments/{assessment_id}/report").status_code == 404
