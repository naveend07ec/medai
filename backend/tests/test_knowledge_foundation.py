from datetime import date
import hashlib
from pathlib import Path

import google.genai as google_genai
import pypdf
import pytest
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.database import Base
from app.models import KnowledgeChunk, KnowledgeDocument


@pytest.fixture()
def knowledge_db_session(tmp_path: Path) -> Session:
    """Create an isolated temporary SQLite session for knowledge storage tests."""
    db_file = tmp_path / "knowledge_foundation.db"
    engine = create_engine(
        f"sqlite:///{db_file.as_posix()}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_required_phase1_packages_importable():
    """Verify google-genai and pypdf are installed and importable."""
    assert hasattr(google_genai, "Client")
    assert hasattr(pypdf, "PdfReader")


def test_gemini_and_rag_configuration_defaults_and_validation(monkeypatch):
    """Verify configurable Gemini/RAG settings preserve existing config and validate bounds."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GENAI_API_KEY", raising=False)

    default_settings = Settings(_env_file=None)
    assert default_settings.GEMINI_MODEL == "gemini-2.5-flash"
    assert default_settings.GEMINI_EMBEDDING_MODEL == "gemini-embedding-001"
    assert default_settings.GEMINI_EMBEDDING_DIMENSION == 768
    assert default_settings.VECTOR_STORE_BACKEND == "postgres_numpy"
    assert default_settings.RAG_TOP_K == 5
    assert default_settings.RAG_MIN_SIMILARITY == pytest.approx(0.35)
    assert default_settings.GENAI_DEMO_MODE is False
    assert default_settings.get_gemini_api_key() is None

    monkeypatch.setenv("GEMINI_API_KEY", "  test-gemini-key  ")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.5-pro")
    monkeypatch.setenv("GEMINI_EMBEDDING_DIMENSION", "1536")
    configured = Settings(_env_file=None)
    assert configured.get_gemini_api_key() == "test-gemini-key"
    assert configured.get_gemini_model() == "gemini-2.5-pro"
    assert configured.GEMINI_EMBEDDING_DIMENSION == 1536

    with pytest.raises(ValueError, match="postgres_numpy"):
        Settings(_env_file=None, VECTOR_STORE_BACKEND="local_json")

    with pytest.raises(ValueError):
        Settings(_env_file=None, RAG_TOP_K=0)


def test_knowledge_document_and_chunk_persistence(knowledge_db_session: Session):
    """Persist KnowledgeDocument and linked KnowledgeChunk records with metadata."""
    content_hash = hashlib.sha256(b"clinical-guideline-sample-v1").hexdigest()
    doc = KnowledgeDocument(
        title="Standards of Care in Diabetes — Clinical Reference",
        source_publisher="American Diabetes Association (Public Summary)",
        publication_date=date(2025, 1, 1),
        source_url="https://example.org/guidelines/diabetes-2025",
        file_name="standards_2025.pdf",
        content_type="application/pdf",
        content_hash=content_hash,
        metadata_json={"language": "en", "approved": True},
    )
    chunk_0 = KnowledgeChunk(
        chunk_index=0,
        chunk_text="Fasting plasma glucose >= 126 mg/dL on two occasions supports diagnostic evaluation.",
        section_heading="Diagnostic Criteria",
        page_number=12,
        token_estimate=18,
        embedding_model="gemini-embedding-001",
        embedding_dimension=4,
        embedding_vector=[0.1, 0.2, 0.3, 0.4],
        chunk_metadata={"topic": "diagnosis"},
    )
    doc.chunks.append(chunk_0)

    knowledge_db_session.add(doc)
    knowledge_db_session.commit()
    knowledge_db_session.refresh(doc)

    assert doc.id is not None
    assert doc.created_at is not None
    assert len(doc.chunks) == 1
    assert doc.chunks[0].document_id == doc.id
    assert doc.chunks[0].embedding_dimension == 4
    assert doc.chunks[0].embedding_vector == [0.1, 0.2, 0.3, 0.4]
    assert doc.chunks[0].section_heading == "Diagnostic Criteria"
    assert doc.chunks[0].page_number == 12


def test_knowledge_chunk_unique_index_and_document_hash_enforced(
    knowledge_db_session: Session,
):
    """Enforce unique document content_hash and unique (document_id, chunk_index)."""
    doc_hash = hashlib.sha256(b"unique-doc").hexdigest()
    first_doc = KnowledgeDocument(
        title="Doc 1",
        source_publisher="Public Health Org",
        content_hash=doc_hash,
    )
    knowledge_db_session.add(first_doc)
    knowledge_db_session.commit()

    duplicate_doc = KnowledgeDocument(
        title="Doc 1 Copy",
        source_publisher="Public Health Org",
        content_hash=doc_hash,
    )
    knowledge_db_session.add(duplicate_doc)
    with pytest.raises(IntegrityError):
        knowledge_db_session.commit()
    knowledge_db_session.rollback()

    chunk_a = KnowledgeChunk(
        document_id=first_doc.id,
        chunk_index=0,
        chunk_text="Chunk A",
        embedding_model="gemini-embedding-001",
        embedding_dimension=3,
        embedding_vector=[0.1, 0.2, 0.3],
    )
    chunk_b = KnowledgeChunk(
        document_id=first_doc.id,
        chunk_index=0,
        chunk_text="Chunk B duplicate index",
        embedding_model="gemini-embedding-001",
        embedding_dimension=3,
        embedding_vector=[0.4, 0.5, 0.6],
    )
    knowledge_db_session.add(chunk_a)
    knowledge_db_session.commit()

    knowledge_db_session.add(chunk_b)
    with pytest.raises(IntegrityError):
        knowledge_db_session.commit()
    knowledge_db_session.rollback()


def test_knowledge_chunk_embedding_dimension_and_vector_validation():
    """Reject empty, non-finite, non-positive-dimension, or mismatched vectors."""
    with pytest.raises(ValueError, match="non-empty"):
        KnowledgeChunk(
            chunk_index=0,
            chunk_text="Empty embedding",
            embedding_model="gemini-embedding-001",
            embedding_dimension=3,
            embedding_vector=[],
        )

    with pytest.raises(ValueError, match="finite"):
        KnowledgeChunk(
            chunk_index=0,
            chunk_text="NaN embedding",
            embedding_model="gemini-embedding-001",
            embedding_dimension=2,
            embedding_vector=[0.5, float("nan")],
        )

    with pytest.raises(ValueError, match="must match"):
        KnowledgeChunk(
            chunk_index=0,
            chunk_text="Mismatched embedding",
            embedding_model="gemini-embedding-001",
            embedding_dimension=4,
            embedding_vector=[0.1, 0.2, 0.3],
        )

    with pytest.raises(ValueError, match="positive integer"):
        KnowledgeChunk(
            chunk_index=0,
            chunk_text="Zero dimension",
            embedding_model="gemini-embedding-001",
            embedding_dimension=0,
            embedding_vector=[0.1],
        )


def test_knowledge_tables_exist_in_metadata():
    """Verify KnowledgeDocument and KnowledgeChunk are registered on Base.metadata."""
    assert "knowledge_documents" in Base.metadata.tables
    assert "knowledge_chunks" in Base.metadata.tables

    cols = set(Base.metadata.tables["knowledge_chunks"].columns.keys())
    assert {
        "id",
        "document_id",
        "chunk_index",
        "chunk_text",
        "section_heading",
        "page_number",
        "embedding_model",
        "embedding_dimension",
        "embedding_vector",
        "created_at",
    }.issubset(cols)
    assert inspect(KnowledgeChunk).mapper is not None

