"""Seed script to populate a fresh database with synthetic patients and initial knowledge guidelines."""

from datetime import date
from pathlib import Path
import sys

# Ensure backend directory is in python path
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import select
from app.core.database import SessionLocal, get_engine
from app.models.patient import Patient
from app.models.clinical_assessment import ClinicalAssessment
from app.models.knowledge import KnowledgeDocument
from app.services.medical_rag.document_ingestion_service import document_ingestion_service

SAMPLE_PATIENTS = [
    {
        "patient_code": "PT-0001",
        "full_name": "Arun Kumar",
        "date_of_birth": date(1981, 5, 23),
        "sex": "Male",
        "contact_number": "+91 98765 43210",
    },
    {
        "patient_code": "PT-0002",
        "full_name": "Priya Sharma",
        "date_of_birth": date(1992, 11, 14),
        "sex": "Female",
        "contact_number": "+91 98765 43211",
    },
    {
        "patient_code": "PT-0003",
        "full_name": "Rajesh Patel",
        "date_of_birth": date(1975, 3, 30),
        "sex": "Male",
        "contact_number": "+91 98765 43212",
    },
]


def seed_patients(db):
    """Seed initial demo patients if patient table is empty."""
    existing_count = db.scalar(select(Patient.id).limit(1))
    if existing_count:
        print("[INFO] Patients table already contains records. Skipping patient seed.")
        return

    print("[INFO] Seeding initial demo patients...")
    for p_data in SAMPLE_PATIENTS:
        patient = Patient(**p_data)
        db.add(patient)
    db.commit()
    print(f"[SUCCESS] Seeded {len(SAMPLE_PATIENTS)} demo patients.")


def seed_knowledge_base(db):
    """Index knowledge guidelines from knowledge_sources if documents table is empty."""
    existing_doc = db.scalar(select(KnowledgeDocument.id).limit(1))
    if existing_doc:
        print("[INFO] Knowledge base already contains indexed documents. Skipping ingestion.")
        return

    catalog_dir = BACKEND_DIR / "knowledge_sources"
    if not catalog_dir.exists():
        print(f"[WARN] Knowledge sources directory not found at {catalog_dir}")
        return

    print("[INFO] Seeding knowledge base from local guideline sources...")
    files_to_ingest = list(catalog_dir.rglob("*.pdf")) + list(catalog_dir.rglob("*.md"))
    
    ingested = 0
    for file_path in files_to_ingest:
        if file_path.name == "SOURCE_CATALOG.md":
            continue
        try:
            with open(file_path, "rb") as f:
                content = f.read()
            title = file_path.stem.replace("_", " ").title()
            doc_record, chunks = document_ingestion_service.ingest_document(
                db=db,
                filename=file_path.name,
                file_bytes=content,
                title=title,
                source_organization="Medical Reference Library",
            )
            print(f"  + Ingested '{title}' ({len(chunks)} chunks)")
            ingested += 1
        except Exception as exc:
            print(f"  ! Skipped '{file_path.name}': {exc}")

    print(f"[SUCCESS] Ingested {ingested} guideline documents into knowledge base.")


def main():
    print("=== MED-AI Database Seed Utility ===")
    get_engine()
    db = SessionLocal()
    try:
        seed_patients(db)
        seed_knowledge_base(db)
    finally:
        db.close()
    print("=== Database seeding complete ===")


if __name__ == "__main__":
    main()
