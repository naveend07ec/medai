from datetime import date
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base
import app.core.database as database_module
from app.main import app


@pytest.fixture()
def api_client(tmp_path):
    """Provide a TestClient backed by an isolated temporary SQLite database."""
    db_file = tmp_path / "api_test.db"
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

    from app.core.database import get_db

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def test_patient_creation_listing_and_lookup(api_client: TestClient):
    """Create patients, list them, and look up by UUID and patient_code."""
    create_res = api_client.post(
        "/api/v1/patients",
        json={
            "full_name": "Asha Nair",
            "date_of_birth": "1992-04-18",
            "patient_code": "PT-ASH-001",
            "sex": "Female",
            "contact_number": "+919876543210",
        },
    )
    assert create_res.status_code == 201
    created = create_res.json()
    assert created["patient_code"] == "PT-ASH-001"
    assert created["full_name"] == "Asha Nair"
    assert created["date_of_birth"] == "1992-04-18"
    assert created["sex"] == "Female"
    assert created["id"]

    # Auto-generated patient_code when omitted
    auto_res = api_client.post(
        "/api/v1/patients",
        json={
            "full_name": "Rohan Verma",
            "date_of_birth": "1985-09-02",
        },
    )
    assert auto_res.status_code == 201
    assert auto_res.json()["patient_code"].startswith("PT-")

    list_res = api_client.get("/api/v1/patients")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 2

    by_id_res = api_client.get(f"/api/v1/patients/{created['id']}")
    assert by_id_res.status_code == 200
    assert by_id_res.json()["patient_code"] == "PT-ASH-001"

    by_code_res = api_client.get("/api/v1/patients/by-code/PT-ASH-001")
    assert by_code_res.status_code == 200
    assert by_code_res.json()["id"] == created["id"]


def test_duplicate_patient_code_rejected(api_client: TestClient):
    """Duplicate patient_code returns HTTP 409 Conflict."""
    payload = {
        "full_name": "First Patient",
        "date_of_birth": str(date(1990, 1, 1)),
        "patient_code": "PT-DUP-100",
    }
    first_res = api_client.post("/api/v1/patients", json=payload)
    assert first_res.status_code == 201

    dup_res = api_client.post(
        "/api/v1/patients",
        json={
            "full_name": "Second Patient",
            "date_of_birth": str(date(1991, 2, 2)),
            "patient_code": "PT-DUP-100",
        },
    )
    assert dup_res.status_code == 409
    assert "already exists" in dup_res.json()["detail"].lower()


def test_assessment_creation_relationship_and_history(api_client: TestClient):
    """Create clinical assessments linked to a patient and retrieve full history."""
    patient_res = api_client.post(
        "/api/v1/patients",
        json={
            "full_name": "Meera Iyer",
            "date_of_birth": "1980-06-15",
            "patient_code": "PT-MEERA-01",
            "sex": "Female",
        },
    )
    assert patient_res.status_code == 201
    patient = patient_res.json()

    assessment_payload = {
        "patient_id": patient["id"],
        "current_symptoms": "Fatigue and increased thirst",
        "symptom_duration": "2 weeks",
        "previous_conditions": "Hypertension",
        "existing_medications": "Amlodipine 5mg",
        "systolic_bp": 128,
        "diastolic_bp": 82,
        "heart_rate": 76,
        "body_temperature": 36.8,
        "oxygen_saturation": 98,
        "lab_results": "Fasting glucose 136 mg/dL",
        "ehr_summary": "Annual preventive follow-up",
        "attached_report_names": ["cbc_panel.pdf"],
        "attached_images": [
            {"name": "fundus_scan.png", "size_label": "412 KB", "type": "image/png"}
        ],
        "imaging_notes": "Routine screening image attached",
        "genomic_notes": "External panel pending",
        "family_history_markers": "Type 2 diabetes in maternal history",
        "preprocessing_summary": {
            "providedModalities": ["Patient Demographics", "Clinical Measurements"],
            "missingModalities": [],
            "validatedMeasurementsCount": 5,
            "imputationAppliedNote": None,
        },
        "clinician_reviewed": False,
    }
    create_res = api_client.post("/api/v1/assessments", json=assessment_payload)
    assert create_res.status_code == 201
    created = create_res.json()

    assert created["patient_id"] == patient["id"]
    assert created["patient"]["patient_code"] == "PT-MEERA-01"
    assert created["patient"]["full_name"] == "Meera Iyer"
    assert created["current_symptoms"] == "Fatigue and increased thirst"
    assert created["systolic_bp"] == 128
    assert created["attached_images"][0]["name"] == "fundus_scan.png"
    assert created["clinician_reviewed"] is False
    assert created["created_at"]

    # Retrieve assessment history (global and per-patient)
    history_res = api_client.get("/api/v1/assessments")
    assert history_res.status_code == 200
    assert len(history_res.json()) == 1
    assert history_res.json()[0]["id"] == created["id"]

    patient_history_res = api_client.get(
        f"/api/v1/patients/{patient['id']}/assessments"
    )
    assert patient_history_res.status_code == 200
    assert len(patient_history_res.json()) == 1

    single_res = api_client.get(f"/api/v1/assessments/{created['id']}")
    assert single_res.status_code == 200
    assert single_res.json()["id"] == created["id"]

    review_res = api_client.patch(
        f"/api/v1/assessments/{created['id']}/review",
        json={"clinician_reviewed": True},
    )
    assert review_res.status_code == 200
    assert review_res.json()["clinician_reviewed"] is True


def test_invalid_patient_reference_and_empty_assessment_rejected(api_client: TestClient):
    """Non-existent patient_id returns 404; empty clinical payload returns 422."""
    missing_patient_res = api_client.post(
        "/api/v1/assessments",
        json={
            "patient_id": str(uuid4()),
            "current_symptoms": "Mild headache",
        },
    )
    assert missing_patient_res.status_code == 404

    missing_lookup = api_client.get(f"/api/v1/patients/{uuid4()}")
    assert missing_lookup.status_code == 404

    missing_history = api_client.get(f"/api/v1/patients/{uuid4()}/assessments")
    assert missing_history.status_code == 404

    patient_res = api_client.post(
        "/api/v1/patients",
        json={"full_name": "Validation Patient", "date_of_birth": "1995-03-10"},
    )
    assert patient_res.status_code == 201

    empty_assessment_res = api_client.post(
        "/api/v1/assessments",
        json={"patient_id": patient_res.json()["id"]},
    )
    assert empty_assessment_res.status_code == 422


def test_unconfigured_database_returns_503_safely(monkeypatch):
    """Unconfigured DATABASE_URL yields clean 503 JSON without leaking secrets."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_USER", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    monkeypatch.delenv("POSTGRES_DB", raising=False)
    monkeypatch.setattr(database_module, "engine", None)
    original_settings_cls = database_module.Settings
    monkeypatch.setattr(
        database_module,
        "Settings",
        lambda: original_settings_cls(_env_file=None),
    )

    with TestClient(app) as client:
        res = client.get("/api/v1/patients")
        assert res.status_code == 503
        assert "not configured" in res.json()["detail"].lower()
