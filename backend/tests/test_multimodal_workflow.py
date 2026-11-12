import json
import struct
from uuid import uuid4
import zlib

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.database import Base, get_db
from app.main import app
from app.schemas.knowledge import RetrievalResult, RetrievedChunkItem
from app.services.generative_ai import GeminiServiceUnavailableError
from app.services.medical_rag import rag_service
from app.services.multimodal.image_processor import strip_image_metadata


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def _make_png_with_metadata(secret_text: str = "PatientName=JohnDoe") -> bytes:
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw_scanline = b"\x00\x00\x00\x00"
    idat = zlib.compress(raw_scanline)
    text_chunk = _png_chunk(b"tEXt", b"Comment\x00" + secret_text.encode("utf-8"))
    exif_chunk = _png_chunk(b"eXIf", b"Exif\x00\x00" + secret_text.encode("utf-8"))
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + text_chunk
        + exif_chunk
        + _png_chunk(b"IDAT", idat)
        + _png_chunk(b"IEND", b"")
    )


def _make_jpeg_with_exif(secret_text: str = "PatientName=JaneDoe") -> bytes:
    exif_payload = b"Exif\x00\x00" + secret_text.encode("utf-8")
    app1 = b"\xff\xe1" + struct.pack(">H", len(exif_payload) + 2) + exif_payload
    sof0_body = struct.pack(">BHHB", 8, 2, 2, 1) + b"\x01\x11\x00"
    sof0 = b"\xff\xc0" + struct.pack(">H", len(sof0_body) + 2) + sof0_body
    sos_body = b"\x01\x01\x00\x00\x3f\x00"
    sos = b"\xff\xda" + struct.pack(">H", len(sos_body) + 2) + sos_body
    return b"\xff\xd8" + app1 + sof0 + sos + b"\x00\xff\xd9"


def _make_minimal_pdf(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("latin-1")
    objs = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
        f"4 0 obj\n<< /Length {len(stream)} >>\nstream\n".encode("latin-1")
        + stream
        + b"\nendstream\nendobj\n",
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objs:
        offsets.append(len(out))
        out.extend(obj)
    xref_pos = len(out)
    out.extend(f"xref\n0 {len(offsets)}\n".encode("latin-1"))
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
    out.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode(
            "latin-1"
        )
    )
    return bytes(out)


@pytest.fixture()
def multimodal_client(tmp_path):
    db_file = tmp_path / "multimodal_test.db"
    engine = create_engine(
        f"sqlite:///{db_file.as_posix()}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
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
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def _create_patient_and_assessment(client: TestClient, *, symptoms: str) -> str:
    p_resp = client.post(
        "/api/v1/patients",
        json={
            "full_name": "Synthetic Multimodal Patient",
            "date_of_birth": "1982-04-10",
            "sex": "Female",
            "contact_number": "555-999-8888",
        },
    )
    assert p_resp.status_code == 201
    patient_id = p_resp.json()["id"]

    a_resp = client.post(
        "/api/v1/assessments",
        json={
            "patient_id": patient_id,
            "current_symptoms": symptoms,
            "symptom_duration": "4 days",
            "systolic_bp": 124,
            "diastolic_bp": 78,
            "heart_rate": 96,
            "body_temperature": 38.4,
            "oxygen_saturation": 94,
        },
    )
    assert a_resp.status_code == 201
    return a_resp.json()["id"]


def _valid_llm_json(chunk_id: str, *, include_image: bool = False) -> str:
    payload = {
        "patient_context_summary": "You have had a fever and cough for 4 days with slightly low oxygen levels.",
        "finding_explanations": [
            {
                "finding_name": "Body Temperature",
                "observed_value": "38.4 °C",
                "reference_range_note": "Typical resting adult temperature is around 36.5 to 37.5 °C.",
                "status_flag": "outside_range",
                "plain_language_meaning": "Shows your body temperature is elevated (fever).",
                "why_it_matters": "Fever often happens when the body is fighting an infection.",
            }
        ],
        "possible_diagnostic_considerations": [
            {
                "condition_or_pattern": "Lower Respiratory Tract Infection (such as Pneumonia)",
                "plain_language_explanation": "An infection in the air sacs of the lungs that can cause fever and cough.",
                "why_findings_point_here": "Fever, cough, and oxygen saturation of 94% raise this possibility.",
                "supporting_observed_evidence": ["Fever 38.4 °C", "Cough for 4 days"],
                "cited_chunk_ids": [chunk_id] if chunk_id else [],
                "rationale": "Clinical presentation aligns with respiratory guideline criteria pending clinician exam.",
                "uncertainty_note": "A doctor must examine you and review imaging before confirming.",
            }
        ],
        "supporting_medical_evidence": (
            "Retrieved clinical guidance highlights evaluating fever, cough, and oxygen levels together."
            if chunk_id
            else "No matching verified medical guideline was retrieved from the knowledge base."
        ),
        "additional_information_required": ["In-person lung exam by a clinician"],
        "doctor_discussion_points": ["Ask your doctor whether targeted antibiotic or supportive care is appropriate."],
        "risk_indicators_and_safety_warnings": ["Seek urgent care if breathing gets harder or oxygen drops further."],
        "treatment_and_management_guidance": (
            ["Clinician-guided evaluation of community respiratory infection guidelines."]
            if chunk_id
            else []
        ),
        "cited_chunk_ids": [chunk_id] if chunk_id else [],
        "clinical_limitations": ["Decision-support summary only; clinician review is mandatory."],
        "image_observations": (
            [
                {
                    "image_name": "chest_xray_synthetic.png",
                    "modality": "chest_xray",
                    "visibly_observed": ["Patchy opacity visible in the right lower lung zone."],
                    "possible_indications": ["May be consistent with localized pulmonary consolidation or infection."],
                    "uncertainties": ["Image quality and single-view projection cannot confirm etiology alone."],
                    "clinician_verification_needed": "A qualified radiologist should inspect the full-resolution chest X-ray.",
                }
            ]
            if include_image
            else []
        ),
    }
    return json.dumps(payload)


def _mock_retrieval_result(
    *,
    sufficient: bool,
    chunks: list[RetrievedChunkItem] | None = None,
) -> RetrievalResult:
    items = chunks or []
    return RetrievalResult(
        sufficient_evidence=sufficient,
        status="evidence_found" if sufficient else "insufficient_evidence",
        query="test clinical query",
        top_k_requested=5,
        min_similarity_applied=0.35,
        total_chunks_searched=max(len(items), 1),
        retrieved_chunks=items,
        message="Evidence retrieved." if sufficient else "No matching evidence found.",
    )


def test_a_text_only_assessment_rag_gemini_report(multimodal_client, monkeypatch):
    chunk_id = str(uuid4())
    doc_id = str(uuid4())
    assessment_id = _create_patient_and_assessment(
        multimodal_client, symptoms="Fever and productive cough"
    )

    monkeypatch.setattr(
        rag_service._retrieval_service,
        "retrieve",
        lambda db, **kwargs: _mock_retrieval_result(
            sufficient=True,
            chunks=[
                RetrievedChunkItem(
                    chunk_id=chunk_id,
                    document_id=doc_id,
                    document_title="Respiratory Assessment Guidelines",
                    source_publisher="Clinical Reference",
                    chunk_index=0,
                    similarity_score=0.84,
                    chunk_text="Fever with cough and SpO2 < 95% warrants clinical respiratory evaluation.",
                )
            ],
        ),
    )
    monkeypatch.setattr(
        rag_service._gemini_service,
        "generate_structured_json",
        lambda **kwargs: ("gemini-3.1-flash-lite", _valid_llm_json(chunk_id)),
    )

    resp = multimodal_client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert resp.status_code == 201
    report = resp.json()["report"]
    assert report["evidence_sufficient"] is True
    assert len(report["possible_diagnostic_considerations"]) == 1
    assert report["retrieved_sources"][0]["chunk_id"] == chunk_id


def test_b_and_g_pdf_document_extraction_and_pii_redaction(
    multimodal_client, monkeypatch
):
    chunk_id = str(uuid4())
    doc_id = str(uuid4())
    assessment_id = _create_patient_and_assessment(
        multimodal_client, symptoms="Fatigue and persistent cough"
    )

    pdf_bytes = _make_minimal_pdf(
        "Patient Name: John Doe; john.doe@example.com; Phone: 555-111-2222; CRP elevated 42 mg/L"
    )
    up_resp = multimodal_client.post(
        f"/api/v1/assessments/{assessment_id}/documents",
        files=[("files", ("lab_report.pdf", pdf_bytes, "application/pdf"))],
    )
    assert up_resp.status_code == 201
    uploaded = up_resp.json()[0]
    assert uploaded["extraction_status"] == "extracted"
    assert "CRP elevated 42 mg/L" in uploaded["extracted_text"]

    captured_prompts: list[str] = []

    monkeypatch.setattr(
        rag_service._retrieval_service,
        "retrieve",
        lambda db, **kwargs: _mock_retrieval_result(
            sufficient=True,
            chunks=[
                RetrievedChunkItem(
                    chunk_id=chunk_id,
                    document_id=doc_id,
                    document_title="Clinical Biomarker Reference",
                    source_publisher="Clinical Reference",
                    chunk_index=0,
                    similarity_score=0.81,
                    chunk_text="Elevated CRP indicates active inflammation.",
                )
            ],
        ),
    )

    def fake_gemini(**kwargs):
        captured_prompts.append(kwargs["user_prompt"])
        return ("gemini-3.1-flash-lite", _valid_llm_json(chunk_id))

    monkeypatch.setattr(
        rag_service._gemini_service,
        "generate_structured_json",
        fake_gemini,
    )

    rep_resp = multimodal_client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert rep_resp.status_code == 201
    report = rep_resp.json()["report"]
    assert len(report["extracted_document_summaries"]) == 1
    assert report["extracted_document_summaries"][0]["file_name"] == "lab_report.pdf"

    # Privacy check (Test G): direct identifiers redacted from prompt sent to Gemini
    sent_prompt = captured_prompts[0]
    assert "john.doe@example.com" not in sent_prompt
    assert "555-111-2222" not in sent_prompt
    assert "Synthetic Multimodal Patient" not in sent_prompt
    assert "CRP elevated 42 mg/L" in sent_prompt


def test_c_d_and_g_medical_image_upload_exif_strip_and_multimodal_gemini(
    multimodal_client, monkeypatch
):
    chunk_id = str(uuid4())
    doc_id = str(uuid4())
    assessment_id = _create_patient_and_assessment(
        multimodal_client, symptoms="Fever, cough, and mild shortness of breath"
    )

    # Upload PDF clinical document
    pdf_bytes = _make_minimal_pdf("WBC count 14.2 x10^9/L elevated")
    doc_resp = multimodal_client.post(
        f"/api/v1/assessments/{assessment_id}/documents",
        files=[("files", ("cbc_panel.pdf", pdf_bytes, "application/pdf"))],
    )
    assert doc_resp.status_code == 201

    # Upload PNG Chest X-Ray with embedded PII metadata chunks (Test G EXIF strip)
    raw_png = _make_png_with_metadata("PatientName=SecretIdentity")
    img_resp = multimodal_client.post(
        f"/api/v1/assessments/{assessment_id}/images",
        data={"modality": "chest_xray"},
        files=[("files", ("chest_xray_synthetic.png", raw_png, "image/png"))],
    )
    assert img_resp.status_code == 201
    img_meta = img_resp.json()[0]
    assert img_meta["exif_stripped"] is True

    # Verify served image bytes no longer contain embedded PII metadata
    content_resp = multimodal_client.get(
        f"/api/v1/assessments/{assessment_id}/attachments/{img_meta['id']}/content"
    )
    assert content_resp.status_code == 200
    assert b"SecretIdentity" not in content_resp.content

    # Also verify JPEG EXIF stripping directly
    raw_jpg = _make_jpeg_with_exif("JaneDoeSecret")
    stripped_jpg, jpg_mime = strip_image_metadata(raw_jpg, ".jpg")
    assert jpg_mime == "image/jpeg"
    assert b"JaneDoeSecret" not in stripped_jpg

    captured_image_parts: list[list[tuple[bytes, str]] | None] = []

    monkeypatch.setattr(
        rag_service._retrieval_service,
        "retrieve",
        lambda db, **kwargs: _mock_retrieval_result(
            sufficient=True,
            chunks=[
                RetrievedChunkItem(
                    chunk_id=chunk_id,
                    document_id=doc_id,
                    document_title="Chest Imaging & Fever Guidelines",
                    source_publisher="Clinical Reference",
                    chunk_index=0,
                    similarity_score=0.88,
                    chunk_text="Localized opacity with fever warrants clinician chest evaluation.",
                )
            ],
        ),
    )

    def fake_multimodal_gemini(**kwargs):
        captured_image_parts.append(kwargs.get("image_parts"))
        return ("gemini-3.1-flash-lite", _valid_llm_json(chunk_id, include_image=True))

    monkeypatch.setattr(
        rag_service._gemini_service,
        "generate_structured_json",
        fake_multimodal_gemini,
    )

    rep_resp = multimodal_client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert rep_resp.status_code == 201
    report = rep_resp.json()["report"]
    assert captured_image_parts[0] is not None
    assert len(captured_image_parts[0]) == 1
    assert captured_image_parts[0][0][1] == "image/png"
    assert b"SecretIdentity" not in captured_image_parts[0][0][0]
    assert len(report["image_observations"]) == 1
    assert report["image_observations"][0]["processing_status"] == "analyzed"
    assert report["image_observations"][0]["visibly_observed"] == [
        "Patchy opacity visible in the right lower lung zone."
    ]
    assert len(report["extracted_document_summaries"]) == 1


def test_e_insufficient_evidence_withholds_treatment(multimodal_client, monkeypatch):
    assessment_id = _create_patient_and_assessment(
        multimodal_client, symptoms="Mild intermittent wrist ache"
    )
    monkeypatch.setattr(
        rag_service._retrieval_service,
        "retrieve",
        lambda db, **kwargs: _mock_retrieval_result(sufficient=False),
    )
    monkeypatch.setattr(
        rag_service._gemini_service,
        "generate_structured_json",
        lambda **kwargs: ("gemini-3.1-flash-lite", _valid_llm_json("")),
    )

    resp = multimodal_client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert resp.status_code == 201
    report = resp.json()["report"]
    assert report["evidence_sufficient"] is False
    assert report["treatment_and_management_information"]["grounded_in_verified_references"] is False
    assert report["treatment_and_management_information"]["guidance_items"] == []


def test_f_emergency_screening_without_gemini(multimodal_client, monkeypatch):
    assessment_id = _create_patient_and_assessment(
        multimodal_client, symptoms="Severe chest pain and shortness of breath"
    )
    monkeypatch.setattr(
        rag_service._retrieval_service,
        "retrieve",
        lambda db, **kwargs: _mock_retrieval_result(sufficient=False),
    )

    def raise_unavailable(**kwargs):
        raise GeminiServiceUnavailableError("Gemini offline")

    monkeypatch.setattr(
        rag_service._gemini_service,
        "generate_structured_json",
        raise_unavailable,
    )

    resp = multimodal_client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert resp.status_code == 503
    body = resp.json()
    assert body["emergency_alert"]["emergency_detected"] is True
    assert body["generated_by_gemini"] is False


def test_h_failure_handling_unsupported_files_corrupt_images_and_bad_ai_json(
    multimodal_client, monkeypatch
):
    assessment_id = _create_patient_and_assessment(
        multimodal_client, symptoms="Fever and cough"
    )

    # Unsupported DICOM volumetric image rejected clearly
    dcm_resp = multimodal_client.post(
        f"/api/v1/assessments/{assessment_id}/images",
        data={"modality": "chest_xray"},
        files=[("files", ("scan.dcm", b"DICM_FAKE", "application/dicom"))],
    )
    assert dcm_resp.status_code == 400
    assert "not supported yet" in dcm_resp.json()["detail"].lower()

    # Corrupt PNG rejected cleanly
    corrupt_resp = multimodal_client.post(
        f"/api/v1/assessments/{assessment_id}/images",
        data={"modality": "chest_xray"},
        files=[("files", ("broken.png", b"NOT_A_PNG", "image/png"))],
    )
    assert corrupt_resp.status_code == 400

    # Unsupported document extension rejected cleanly
    exe_resp = multimodal_client.post(
        f"/api/v1/assessments/{assessment_id}/documents",
        files=[("files", ("script.exe", b"MZ", "application/octet-stream"))],
    )
    assert exe_resp.status_code == 400

    # Malformed AI JSON handled safely with 502
    monkeypatch.setattr(
        rag_service._retrieval_service,
        "retrieve",
        lambda db, **kwargs: _mock_retrieval_result(sufficient=False),
    )
    monkeypatch.setattr(
        rag_service._gemini_service,
        "generate_structured_json",
        lambda **kwargs: ("gemini-3.1-flash-lite", "{not-valid-json"),
    )
    bad_ai_resp = multimodal_client.post(f"/api/v1/assessments/{assessment_id}/generate-report")
    assert bad_ai_resp.status_code == 502
