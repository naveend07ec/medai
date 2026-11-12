from app.schemas.report import RetrievedSourceItem, TreatmentAndManagementSection


def build_treatment_support_section(
    *,
    sufficient_evidence: bool,
    verified_sources: list[RetrievedSourceItem],
    grounded_guidance: list[str],
    cited_chunk_ids: list[str],
) -> TreatmentAndManagementSection:
    """Build Section 7 strictly requiring verified retrieved medical chunks."""
    if not sufficient_evidence or not verified_sources:
        return TreatmentAndManagementSection(
            grounded_in_verified_references=False,
            guidance_items=[],
            cited_chunk_ids=[],
            status_note=(
                "No verified medical guidelines in our knowledge base strongly matched "
                "these symptoms or readings yet. To stay safe, specific treatment advice "
                "is withheld rather than guessed. A qualified doctor should guide your care plan."
            ),
            clinician_review_required=True,
        )

    valid_ids = {str(src.chunk_id) for src in verified_sources}
    filtered_ids = [cid for cid in cited_chunk_ids if cid in valid_ids]
    if not filtered_ids:
        filtered_ids = [str(src.chunk_id) for src in verified_sources]

    cleaned_guidance = [item.strip() for item in grounded_guidance if item.strip()]
    if not cleaned_guidance:
        return TreatmentAndManagementSection(
            grounded_in_verified_references=False,
            guidance_items=[],
            cited_chunk_ids=[],
            status_note=(
                "Retrieved medical references did not yield specific treatment or "
                "management points for this case. Clinician review is required."
            ),
            clinician_review_required=True,
        )

    return TreatmentAndManagementSection(
        grounded_in_verified_references=True,
        guidance_items=cleaned_guidance,
        cited_chunk_ids=filtered_ids,
        status_note=(
            "These general care and follow-up points come strictly from the verified "
            "medical references listed below. A clinician must review and approve any "
            "next steps; this tool never prescribes medications or changes doses."
        ),
        clinician_review_required=True,
    )
