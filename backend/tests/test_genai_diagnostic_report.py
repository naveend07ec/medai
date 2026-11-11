import json
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.database import Base, get_db
from app.main import app
from app.services.generative_ai import genai_diagnostic_service


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
            yield client
    finally:
        app.dependency_overrides.clear()
        genai_diagnostic_service._settings_override = None
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def _create_sample_patient_and_assessment(client: TestClient) -> tuple[str, str]:
    patient_res = client.post(
        "/api/v1/patients",
        json={
            "full_name": "Kavita Sharma",
            "date_of_birth": "1978-08-22",
            "patient_code": "PT-GENAI-001",
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
            "current_symptoms": "Persistent fatigue and polyuria",
            "symptom_duration": "3 weeks",
            "previous_conditions": "Hypertension",
            "existing_medications": "Amlodipine 5 mg daily",
            "medical_history_notes": "Known Allergies: Penicillin",
            "systolic_bp": 144,
            "diastolic_bp": 88,
            "heart_rate": 84,
            "body_temperature": 36.9,
            "oxygen_saturation": 98,
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
    report_api_client: TestClient, monkeypatch
):
    """Missing GENAI_API_KEY marks service unavailable and refuses fake reports."""
    monkeypatch.setattr(
        genai_diagnostic_service,
        "_settings_override",
        Settings(
            _env_file=None,
            GENAI_PROVIDER="gemini",
            GENAI_API_KEY=None,
            GENAI_MODEL="gemini-2.5-flash",
        ),
    )

    _, assessment_id = _create_sample_patient_and_assessment(report_api_client)

    health_res = report_api_client.get("/api/v1/assessments/genai/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "unavailable"
    assert health_res.json()["rag_connected"] is False

    gen_res = report_api_client.post(
        f"/api/v1/assessments/{assessment_id}/generate-report"
    )
    assert gen_res.status_code == 503
    assert "not configured" in gen_res.json()["detail"].lower()

    get_res = report_api_client.get(f"/api/v1/assessments/{assessment_id}/report")
    assert get_res.status_code == 404


def test_generate_persist_retrieve_and_review_report(
    report_api_client: TestClient, monkeypatch
):
    """End-to-end report generation, de-identification, persistence, and clinician review."""
    monkeypatch.setattr(
        genai_diagnostic_service,
        "_settings_override",
        Settings(
            _env_file=None,
            GENAI_PROVIDER="gemini",
            GENAI_API_KEY="test-placeholder-key",
            GENAI_MODEL="gemini-2.5-flash",
        ),
    )

    recorded_prompts: list[str] = []

    def fake_call_provider(_current, _system_instruction: str, user_content: str) -> str:
        recorded_prompts.append(user_content)
        return json.dumps(
            {
                "patient_clinical_summary": (
                    "Adult female presenting with 3 weeks of persistent fatigue and polyuria, "
                    "elevated systolic blood pressure (144/88 mm Hg), and fasting glucose 142 mg/dL."
                ),
                "ai_generated_diagnostic_insights": (
                    "Observed hyperglycemia with osmotic symptoms warrants formal metabolic evaluation; "
                    "these AI interpretations are non-diagnostic and require clinician correlation."
                ),
                "possible_diagnostic_considerations": [
                    {
                        "condition_or_pattern": "Dysglycemia / Hyperglycemic Pattern",
                        "supporting_observed_evidence": [
                            "Fasting glucose 142 mg/dL",
                            "Reported polyuria and fatigue for 3 weeks",
                        ],
                        "rationale": "Fasting plasma glucose >= 126 mg/dL with classic symptoms merits confirmatory testing.",
                        "uncertainty_note": "HbA1c result is still pending and single reading is insufficient alone.",
                    }
                ],
                "additional_missing_or_uncertainty": [
                    "Confirmatory HbA1c and repeat fasting glucose results are pending."
                ],
                "further_clinical_evaluation_considerations": [
                    "Review pending HbA1c and basic metabolic panel results.",
                    "Confirm blood pressure readings on repeat clinical measurement.",
                ],
            }
        )

    monkeypatch.setattr(genai_diagnostic_service, "_call_provider", fake_call_provider)

    _, assessment_id = _create_sample_patient_and_assessment(report_api_client)

    health_res = report_api_client.get("/api/v1/assessments/genai/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "ready"

    gen_res = report_api_client.post(
        f"/api/v1/assessments/{assessment_id}/generate-report"
    )
    assert gen_res.status_code == 201
    created = gen_res.json()

    # Verify PII was NOT sent to the external LLM prompt
    assert len(recorded_prompts) == 1
    assert "Kavita Sharma" not in recorded_prompts[0]
    assert "1978-08-22" not in recorded_prompts[0]
    assert "+919900112233" not in recorded_prompts[0]

    report = created["report"]
    assert report["patient_clinical_summary"]
    assert any("Persistent fatigue and polyuria" in f for f in report["available_clinical_findings"])
    assert "non-diagnostic" in report["ai_generated_diagnostic_insights"].lower()
    assert len(report["possible_diagnostic_considerations"]) == 1
    assert any("HbA1c" in m for m in report["missing_information_and_uncertainty"])
    assert len(report["further_clinical_evaluation_considerations"]) >= 1

    # Section 7 must strictly remain ungrounded / non-prescriptive without Medical RAG
    treatment = report["personalized_treatment_support"]
    assert treatment["grounded_in_verified_references"] is False
    assert treatment["retrieved_references"] == []
    assert treatment["guidance_items"] == []

    # Separate predictive experiment and safety disclaimer preserved
    assert report["predictive_model_separation_note"]["included"] is True
    assert "XGBoost" in report["predictive_model_separation_note"]["summary"]
    assert "not a definitive medical diagnosis" in report["clinician_review_and_safety_disclaimer"].lower()
    assert "GAN" in report["research_context_note"]
    assert "Paillier" in report["research_context_note"]

    # Persistence check via GET
    get_res = report_api_client.get(f"/api/v1/assessments/{assessment_id}/report")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == created["id"]

    # Clinician review check via PATCH
    review_res = report_api_client.patch(
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

    # Verify assessment clinician_reviewed synced
    asm_res = report_api_client.get(f"/api/v1/assessments/{assessment_id}")
    assert asm_res.status_code == 200
    assert asm_res.json()["clinician_reviewed"] is True


def test_malformed_provider_output_and_missing_assessment(
    report_api_client: TestClient, monkeypatch
):
    """Malformed provider JSON returns 503; missing assessment returns 404."""
    monkeypatch.setattr(
        genai_diagnostic_service,
        "_settings_override",
        Settings(
            _env_file=None,
            GENAI_PROVIDER="gemini",
            GENAI_API_KEY="test-placeholder-key",
            GENAI_MODEL="gemini-2.5-flash",
        ),
    )

    missing_res = report_api_client.post(
        f"/api/v1/assessments/{uuid4()}/generate-report"
    )
    assert missing_res.status_code == 404

    monkeypatch.setattr(
        genai_diagnostic_service,
        "_call_provider",
        lambda *_args: "not valid json",
    )
    _, assessment_id = _create_sample_patient_and_assessment(report_api_client)
    bad_res = report_api_client.post(
        f"/api/v1/assessments/{assessment_id}/generate-report"
    )
    assert bad_res.status_code == 503
    assert report_api_client.get(f"/api/v1/assessments/{assessment_id}/report").status_code == 404

