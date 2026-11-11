from datetime import date
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from google.genai import errors as genai_errors
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.core.database import Base, get_db
from app.main import app
from app.models import KnowledgeDocument
from app.services.medical_rag.document_ingestion_service import (
    DocumentIngestionService,
    ExtractedSegment,
    chunk_segments,
    extract_document_segments,
)
from app.services.medical_rag.embedding_service import (
    EmbeddingRateLimitError,
    EmbeddingServiceError,
    EmbeddingServiceUnavailableError,
    EmbeddingTimeoutError,
    GeminiEmbeddingService,
)
from app.services.medical_rag.retrieval_service import KnowledgeRetrievalService


def _build_minimal_two_page_pdf(page1_text: str, page2_text: str) -> bytes:
    """Construct a valid minimal 2-page PDF in memory for extraction tests."""

    def _escape(text: str) -> str:
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    stream1 = f"BT /F1 12 Tf 72 720 Td ({_escape(page1_text)}) Tj ET".encode("latin-1")
    stream2 = f"BT /F1 12 Tf 72 720 Td ({_escape(page2_text)}) Tj ET".encode("latin-1")

    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj\n",
        (
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>\nendobj\n"
        ),
        (
            b"4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>\nendobj\n"
        ),
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        (
            f"6 0 obj\n<< /Length {len(stream1)} >>\nstream\n".encode("ascii")
            + stream1
            + b"\nendstream\nendobj\n"
        ),
        (
            f"7 0 obj\n<< /Length {len(stream2)} >>\nstream\n".encode("ascii")
            + stream2
            + b"\nendstream\nendobj\n"
        ),
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)

    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(pdf)


@pytest.fixture()
def kb_db_session(tmp_path: Path) -> Session:
    """Create an isolated temporary SQLite DB session for knowledge tests."""
    db_file = tmp_path / "kb_phase2.db"
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


@pytest.fixture()
def kb_api_client(tmp_path: Path):
    """Provide a FastAPI TestClient backed by an isolated temporary SQLite DB."""
    db_file = tmp_path / "kb_api.db"
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
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_pdf_txt_and_markdown_extraction_with_pages_and_headings():
    """Extract cleaned text, page numbers from PDFs, and section headings from MD/TXT."""
    pdf_bytes = _build_minimal_two_page_pdf(
        "Diagnostic criteria include elevated blood glucose.",
        "Follow up with confirmatory laboratory testing.",
    )
    pdf_segments, pdf_full = extract_document_segments(pdf_bytes, "guideline.pdf")
    assert len(pdf_segments) == 2
    assert pdf_segments[0].page_number == 1
    assert pdf_segments[1].page_number == 2
    assert "elevated blood glucose" in pdf_full

    md_bytes = (
        b"# Hypertension Overview\n\n"
        b"Repeated resting readings above 140/90 mm Hg require evaluation.\n\n"
        b"## Follow-Up\n\n"
        b"Confirm readings across separate clinical visits.\n"
    )
    md_segments, _ = extract_document_segments(md_bytes, "hypertension.md")
    assert len(md_segments) == 2
    assert md_segments[0].section_heading == "Hypertension Overview"
    assert md_segments[0].page_number is None
    assert md_segments[1].section_heading == "Follow-Up"

    txt_bytes = b"CLINICAL GUIDANCE\r\n\r\nMonitor vital signs   and hydration.\x00"
    txt_segments, txt_full = extract_document_segments(txt_bytes, "notes.txt")
    assert len(txt_segments) == 1
    assert txt_segments[0].section_heading == "CLINICAL GUIDANCE"
    assert "\x00" not in txt_full
    assert "Monitor vital signs and hydration." in txt_full


def test_empty_and_invalid_documents_rejected():
    """Reject empty bytes, unsupported extensions, bad UTF-8, and corrupt PDFs."""
    from app.services.medical_rag.document_ingestion_service import DocumentIngestionError

    with pytest.raises(DocumentIngestionError, match="empty"):
        extract_document_segments(b"", "empty.txt")

    with pytest.raises(DocumentIngestionError, match="Unsupported"):
        extract_document_segments(b"hello", "notes.docx")

    with pytest.raises(DocumentIngestionError, match="UTF-8"):
        extract_document_segments(b"\xff\xfe\x00\x01", "binary.txt")

    with pytest.raises(DocumentIngestionError, match="no extractable text"):
        extract_document_segments(b"   \n\n\t  ", "blank.md")

    with pytest.raises(DocumentIngestionError, match="Unable to read PDF"):
        extract_document_segments(b"%PDF-corrupt-content", "broken.pdf")


def test_chunk_size_and_overlap_behavior():
    """Ensure chunks respect max length, preserve provenance, and overlap properly."""
    text = " ".join(f"word{i}" for i in range(45))
    segments = [
        ExtractedSegment(
            text=text,
            section_heading="Clinical Protocol",
            page_number=4,
        )
    ]
    chunks = chunk_segments(segments, chunk_size=80, chunk_overlap=20)
    assert len(chunks) >= 3
    for idx, chunk in enumerate(chunks):
        assert chunk.chunk_index == idx
        assert len(chunk.chunk_text) <= 80
        assert chunk.section_heading == "Clinical Protocol"
        assert chunk.page_number == 4

    # Adjacent chunks share overlapping words
    first_tail = chunks[0].chunk_text.split()[-1]
    assert first_tail in chunks[1].chunk_text


def test_embedding_service_batching_validation_and_error_handling(monkeypatch):
    """Test mocked google-genai batching, dimension validation, rate limits, and key safety."""
    secret_key = "SUPER_SECRET_GEMINI_KEY_12345"
    settings = Settings(
        _env_file=None,
        GEMINI_API_KEY=secret_key,
        GEMINI_EMBEDDING_MODEL="gemini-embedding-001",
        GEMINI_EMBEDDING_DIMENSION=4,
        GEMINI_EMBEDDING_BATCH_SIZE=2,
        GEMINI_TIMEOUT_SECONDS=10.0,
    )
    svc = GeminiEmbeddingService(settings_override=settings)

    recorded_batches: list[list[str]] = []

    class FakeModels:
        def embed_content(self, *, model, contents, config):
            assert model == "gemini-embedding-001"
            assert config.output_dimensionality == 4
            recorded_batches.append(list(contents))
            return SimpleNamespace(
                embeddings=[
                    SimpleNamespace(values=[0.1, 0.2, 0.3, 0.4])
                    for _ in contents
                ]
            )

    monkeypatch.setattr(
        svc,
        "_build_client",
        lambda _cfg: SimpleNamespace(models=FakeModels()),
    )

    vectors = svc.embed_texts(["chunk one", "chunk two", "chunk three"])
    assert len(vectors) == 3
    assert recorded_batches == [["chunk one", "chunk two"], ["chunk three"]]

    # Mismatched dimension rejected
    class BadDimModels:
        def embed_content(self, **_kwargs):
            return SimpleNamespace(
                embeddings=[SimpleNamespace(values=[0.1, 0.2])]
            )

    monkeypatch.setattr(
        svc,
        "_build_client",
        lambda _cfg: SimpleNamespace(models=BadDimModels()),
    )
    with pytest.raises(EmbeddingServiceError, match="Invalid embedding vector"):
        svc.embed_texts(["chunk one"])

    # Rate limit (429) handled without exposing API key
    class RateLimitModels:
        def embed_content(self, **_kwargs):
            raise genai_errors.ClientError(
                429,
                {"error": {"message": f"Quota exceeded for {secret_key}"}},
                None,
            )

    monkeypatch.setattr(
        svc,
        "_build_client",
        lambda _cfg: SimpleNamespace(models=RateLimitModels()),
    )
    with pytest.raises(EmbeddingRateLimitError) as rate_exc:
        svc.embed_texts(["chunk one"])
    assert secret_key not in str(rate_exc.value)

    # Timeout handled cleanly
    class TimeoutModels:
        def embed_content(self, **_kwargs):
            raise TimeoutError("timed out")

    monkeypatch.setattr(
        svc,
        "_build_client",
        lambda _cfg: SimpleNamespace(models=TimeoutModels()),
    )
    with pytest.raises(EmbeddingTimeoutError):
        svc.embed_texts(["chunk one"])

    # Missing API key raises unavailable
    unconfigured_svc = GeminiEmbeddingService(
        settings_override=Settings(_env_file=None, GEMINI_API_KEY=None, GENAI_API_KEY=None)
    )
    with pytest.raises(EmbeddingServiceUnavailableError):
        unconfigured_svc.embed_texts(["chunk one"])


def test_retrieval_ranking_threshold_and_insufficient_evidence(
    kb_db_session: Session, monkeypatch
):
    """Verify NumPy cosine ranking, threshold filtering, metadata preservation, and insufficient evidence."""
    settings = Settings(
        _env_file=None,
        GEMINI_API_KEY="mock-key",
        GEMINI_EMBEDDING_DIMENSION=3,
        RAG_TOP_K=2,
        RAG_MIN_SIMILARITY=0.70,
    )
    fake_embedding_svc = GeminiEmbeddingService(settings_override=settings)

    def fake_embed_texts(texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT"):
        del task_type
        mapping = {
            "Elevated fasting glucose requires confirmatory HbA1c testing.": [0.98, 0.1, 0.0],
            "Routine immunization schedule for adults.": [0.0, 0.0, 1.0],
            "Moderate hyperglycemia lifestyle counseling reference.": [0.78, 0.62, 0.0],
        }
        return [mapping.get(t, [0.5, 0.5, 0.0]) for t in texts]

    monkeypatch.setattr(fake_embedding_svc, "embed_texts", fake_embed_texts)

    ingestion = DocumentIngestionService(
        embedding_svc=fake_embedding_svc,
        settings_override=settings,
    )
    doc = ingestion.ingest_document(
        kb_db_session,
        file_bytes=(
            b"# Diabetes Workup\n\n"
            b"Elevated fasting glucose requires confirmatory HbA1c testing.\n\n"
            b"# Preventive Care\n\n"
            b"Routine immunization schedule for adults.\n\n"
            b"# Metabolic Counseling\n\n"
            b"Moderate hyperglycemia lifestyle counseling reference.\n"
        ),
        file_name="clinical_ref.md",
        title="Public Clinical Reference Guide",
        source_publisher="National Medical Reference",
        publication_date=date(2025, 2, 10),
        source_url="https://example.org/clinical-guide",
        chunk_size=120,
        chunk_overlap=10,
    )
    assert len(doc.chunks) == 3

    retrieval = KnowledgeRetrievalService(
        embedding_svc=fake_embedding_svc,
        settings_override=settings,
    )

    # Query aligned closely with chunk 0 and chunk 2, unrelated to chunk 1
    monkeypatch.setattr(fake_embedding_svc, "embed_query", lambda _q: [1.0, 0.0, 0.0])
    result = retrieval.retrieve(kb_db_session, "fasting glucose diagnostic workup")

    assert result.sufficient_evidence is True
    assert result.status == "evidence_found"
    assert len(result.retrieved_chunks) == 2
    assert result.retrieved_chunks[0].section_heading == "Diabetes Workup"
    assert result.retrieved_chunks[0].similarity_score > result.retrieved_chunks[1].similarity_score
    assert result.retrieved_chunks[0].document_title == "Public Clinical Reference Guide"
    assert result.retrieved_chunks[0].source_publisher == "National Medical Reference"
    assert result.retrieved_chunks[0].source_url == "https://example.org/clinical-guide"
    assert result.retrieved_chunks[0].publication_date == date(2025, 2, 10)

    # Query orthogonal to stored medical chunks -> insufficient evidence
    monkeypatch.setattr(fake_embedding_svc, "embed_query", lambda _q: [0.0, 1.0, 0.0])
    low_result = retrieval.retrieve(
        kb_db_session,
        "unrelated query",
        min_similarity=0.80,
    )
    assert low_result.sufficient_evidence is False
    assert low_result.status == "insufficient_evidence"
    assert low_result.retrieved_chunks == []


def test_knowledge_api_ingestion_dedup_listing_status_and_errors(
    kb_api_client: TestClient, monkeypatch
):
    """Test /api/v1/knowledge endpoints end-to-end with mocked embeddings."""
    from app.api.v1 import knowledge as knowledge_api

    monkeypatch.setattr(
        knowledge_api,
        "Settings",
        lambda: Settings(
            _env_file=None,
            GEMINI_API_KEY="mock-key",
            GEMINI_EMBEDDING_DIMENSION=4,
            GEMINI_EMBEDDING_MODEL="gemini-embedding-001",
        ),
    )

    embed_calls = {"count": 0}

    def fake_embed_texts(texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT"):
        del task_type
        embed_calls["count"] += 1
        return [[0.25, 0.25, 0.25, 0.25] for _ in texts]

    monkeypatch.setattr(
        knowledge_api.document_ingestion_service,
        "_settings_override",
        Settings(
            _env_file=None,
            GEMINI_API_KEY="mock-key",
            GEMINI_EMBEDDING_DIMENSION=4,
            GEMINI_EMBEDDING_MODEL="gemini-embedding-001",
        ),
    )
    monkeypatch.setattr(
        knowledge_api.document_ingestion_service._embedding_service,
        "embed_texts",
        fake_embed_texts,
    )
    monkeypatch.setattr(
        knowledge_api.embedding_service,
        "_settings_override",
        Settings(_env_file=None, GEMINI_API_KEY="mock-key"),
    )

    # Initial status check
    status_res = kb_api_client.get("/api/v1/knowledge/status")
    assert status_res.status_code == 200
    assert status_res.json()["document_count"] == 0
    assert status_res.json()["chunk_count"] == 0
    assert status_res.json()["embedding_service_ready"] is True

    # Upload Markdown document
    upload_res = kb_api_client.post(
        "/api/v1/knowledge/documents",
        files={
            "file": (
                "fever_guideline.md",
                b"# Fever Assessment\n\nEvaluate hydration and vital signs carefully.",
                "text/markdown",
            )
        },
        data={
            "title": "Primary Care Fever Reference",
            "source_publisher": "WHO Public Guidance",
            "publication_date": "2024-05-01",
            "source_url": "https://example.org/who-fever",
        },
    )
    assert upload_res.status_code == 201
    body = upload_res.json()
    assert body["chunks_created"] == 1
    assert body["document"]["title"] == "Primary Care Fever Reference"
    assert embed_calls["count"] == 1

    # Duplicate content hash returns 409 without calling embedding service again
    dup_res = kb_api_client.post(
        "/api/v1/knowledge/documents",
        files={
            "file": (
                "fever_copy.md",
                b"# Fever Assessment\n\nEvaluate hydration and vital signs carefully.",
                "text/markdown",
            )
        },
        data={
            "title": "Duplicate Fever Reference",
            "source_publisher": "WHO Public Guidance",
        },
    )
    assert dup_res.status_code == 409
    assert embed_calls["count"] == 1

    # Unsupported file extension returns 400
    bad_ext = kb_api_client.post(
        "/api/v1/knowledge/documents",
        files={"file": ("malware.exe", b"binary", "application/octet-stream")},
        data={"title": "Invalid File", "source_publisher": "Test"},
    )
    assert bad_ext.status_code == 400

    # List documents and verify updated counts
    docs_res = kb_api_client.get("/api/v1/knowledge/documents")
    assert docs_res.status_code == 200
    assert len(docs_res.json()) == 1
    assert docs_res.json()[0]["chunk_count"] == 1

    status_after = kb_api_client.get("/api/v1/knowledge/status")
    assert status_after.status_code == 200
    assert status_after.json()["document_count"] == 1
    assert status_after.json()["chunk_count"] == 1

    # Upstream rate limit maps to HTTP 429
    def raise_rate_limit(*_args, **_kwargs):
        raise EmbeddingRateLimitError("Rate limit exceeded.")

    monkeypatch.setattr(
        knowledge_api.document_ingestion_service._embedding_service,
        "embed_texts",
        raise_rate_limit,
    )
    rate_res = kb_api_client.post(
        "/api/v1/knowledge/documents",
        files={"file": ("new.txt", b"Unique clinical note content.", "text/plain")},
        data={"title": "Rate Limited Doc", "source_publisher": "Test Org"},
    )
    assert rate_res.status_code == 429

    # Cleanup overrides
    knowledge_api.document_ingestion_service._settings_override = None
    knowledge_api.embedding_service._settings_override = None
    assert KnowledgeDocument is not None
