from datetime import date, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.database import Base, create_db_engine, get_db, get_engine
import app.core.database as database_module
from app.main import app
from app.models import Patient
from app.schemas.patient import PatientCreate, PatientResponse


@pytest.fixture()
def db_session(tmp_path) -> Session:
    """Create an isolated temporary SQLite database session for each test."""
    db_file = tmp_path / "test_patients.db"
    engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False},
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_create_patient_and_uuid_generation(db_session: Session):
    """Creating a patient persists fields and generates a UUID primary key."""
    patient = Patient(
        patient_code="PT-TEST-001",
        full_name="Test Patient One",
        date_of_birth=date(1988, 5, 14),
        sex="Female",
        contact_number="+15550100",
    )
    db_session.add(patient)
    db_session.commit()
    db_session.refresh(patient)

    assert isinstance(patient.id, UUID)
    assert patient.patient_code == "PT-TEST-001"
    assert patient.full_name == "Test Patient One"
    assert patient.date_of_birth == date(1988, 5, 14)
    assert patient.sex == "Female"
    assert patient.contact_number == "+15550100"


def test_patient_unique_code_enforced(db_session: Session):
    """Duplicate patient_code values are rejected by a uniqueness constraint."""
    first = Patient(
        patient_code="PT-UNIQUE-001",
        full_name="First Patient",
        date_of_birth=date(1990, 1, 1),
    )
    duplicate = Patient(
        patient_code="PT-UNIQUE-001",
        full_name="Second Patient",
        date_of_birth=date(1992, 2, 2),
    )

    db_session.add(first)
    db_session.commit()

    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_patient_optional_fields_default_to_none(db_session: Session):
    """Optional fields sex and contact_number may be omitted."""
    patient = Patient(
        patient_code="PT-OPT-001",
        full_name="Optional Fields Patient",
        date_of_birth=date(1979, 11, 3),
    )
    db_session.add(patient)
    db_session.commit()
    db_session.refresh(patient)

    assert patient.sex is None
    assert patient.contact_number is None


def test_patient_timestamps_created_and_updated(db_session: Session):
    """created_at and updated_at are automatically populated on insert."""
    patient = Patient(
        patient_code="PT-TIME-001",
        full_name="Timestamp Patient",
        date_of_birth=date(1985, 7, 20),
    )
    db_session.add(patient)
    db_session.commit()
    db_session.refresh(patient)

    assert isinstance(patient.created_at, datetime)
    assert isinstance(patient.updated_at, datetime)
    initial_created_at = patient.created_at

    patient.full_name = "Timestamp Patient Updated"
    db_session.commit()
    db_session.refresh(patient)

    assert patient.created_at == initial_created_at
    assert patient.updated_at >= initial_created_at


def test_patient_orm_compatible_with_pydantic_schemas(db_session: Session):
    """Existing PatientCreate and PatientResponse schemas work with the ORM model."""
    payload = PatientCreate(
        full_name="Schema Compatible Patient",
        date_of_birth=date(1995, 3, 12),
        sex="Male",
        contact_number="555-0199",
    )
    patient = Patient(
        patient_code="PT-SCHEMA-001",
        **payload.model_dump(),
    )
    db_session.add(patient)
    db_session.commit()
    db_session.refresh(patient)

    response = PatientResponse.model_validate(patient)
    assert response.id == patient.id
    assert response.patient_code == "PT-SCHEMA-001"
    assert response.full_name == payload.full_name
    assert response.date_of_birth == payload.date_of_birth
    assert response.sex == payload.sex
    assert response.created_at == patient.created_at


def test_settings_database_url_resolution_from_env(monkeypatch, tmp_path):
    """Settings resolves DATABASE_URL without hardcoded credentials."""
    db_path = tmp_path / "env_test.db"
    sqlite_url = f"sqlite:///{db_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", sqlite_url)
    env_settings = Settings(_env_file=None)
    assert env_settings.get_database_url() == sqlite_url

    engine = create_db_engine(sqlite_url)
    assert engine.url.drivername == "sqlite"
    assert engine.url.database == db_path.as_posix()
    engine.dispose()


def test_get_db_raises_when_database_url_missing(monkeypatch):
    """get_engine and get_db fail clearly when no DATABASE_URL is configured."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_USER", raising=False)
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)
    monkeypatch.delenv("POSTGRES_DB", raising=False)
    monkeypatch.setattr(database_module, "engine", None)
    monkeypatch.setattr(database_module, "Settings", lambda: Settings(_env_file=None))

    with pytest.raises(RuntimeError, match="DATABASE_URL is not configured"):
        get_engine()


def test_get_db_yields_and_closes_session(monkeypatch, tmp_path):
    """get_db yields a working Session bound to the configured temporary SQLite URL."""
    sqlite_url = f"sqlite:///{(tmp_path / 'dep_test.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", sqlite_url)
    monkeypatch.setattr(database_module, "engine", None)
    monkeypatch.setattr(database_module, "Settings", lambda: Settings(_env_file=None))

    try:
        db_gen = get_db()
        db = next(db_gen)
        assert isinstance(db, Session)
        Base.metadata.create_all(bind=database_module.engine)

        patient = Patient(
            patient_code="PT-DEP-001",
            full_name="Dependency Test Patient",
            date_of_birth=date(1991, 8, 9),
        )
        db.add(patient)
        db.commit()
        assert db.query(Patient).count() == 1

        with pytest.raises(StopIteration):
            next(db_gen)
    finally:
        if database_module.engine is not None:
            database_module.engine.dispose()
        database_module.SessionLocal.configure(bind=None)
        monkeypatch.setattr(database_module, "engine", None)


def test_existing_fastapi_endpoints_preserved():
    """Existing root and health endpoints continue to return expected responses."""
    client = TestClient(app)

    root_res = client.get("/")
    assert root_res.status_code == 200
    assert root_res.json()["status"] == "running"

    health_res = client.get("/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "healthy"

    v1_health_res = client.get("/api/v1/health")
    assert v1_health_res.status_code == 200
    assert v1_health_res.json()["api_version"] == "v1"
