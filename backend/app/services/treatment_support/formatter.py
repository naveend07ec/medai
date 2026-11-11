from app.schemas.report import MedicalReferenceItem, TreatmentSupportSection


def build_treatment_support_section(
    rag_connected: bool,
    retrieved_references: list[MedicalReferenceItem],
    rag_status_note: str,
    grounded_guidance: list[str] | None = None,
) -> TreatmentSupportSection:
    """Build Section 7 strictly requiring verified medical references."""
    if not rag_connected or not retrieved_references:
        return TreatmentSupportSection(
            grounded_in_verified_references=False,
            retrieved_references=[],
            guidance_items=[],
            status_note=(
                f"{rag_status_note} Personalized treatment-support recommendations are "
                "withheld so no unverified or unsupported treatment advice is generated. "
                "All therapeutic decisions must be determined by the reviewing clinician "
                "from verified clinical guidelines."
            ),
        )

    return TreatmentSupportSection(
        grounded_in_verified_references=True,
        retrieved_references=retrieved_references,
        guidance_items=grounded_guidance or [],
        status_note=(
            "Treatment-support notes below are grounded in retrieved medical references "
            "and require clinician review. Autonomous prescribing is never performed."
        ),
    )

