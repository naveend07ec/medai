from app.schemas.report import MedicalReferenceItem


def retrieve_verified_medical_references() -> tuple[bool, list[MedicalReferenceItem], str]:
    """Check Medical RAG retrieval availability without fabricating citations.

    Returns (rag_connected, retrieved_references, status_note).
    """
    return (
        False,
        [],
        "No verified Medical RAG knowledge base or guideline index is connected yet.",
    )

