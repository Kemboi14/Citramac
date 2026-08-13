"""
SHA gateway service skeleton — docs/08-DHA-SHA-INTEGRATION.md §8.3. Every
call is logged to ShaTransactionLog regardless of outcome, per §8.3's "SHA
transactions are financial or medical, never fire-and-forget." Real calls
against SHA's API (mutual TLS, signed payloads per §8.4) are a Phase 6 item —
these functions honestly report PENDING/no-op rather than faking success,
consistent with the IPRS/SHA-verification stubs from Phase 3.
"""

from apps.dha_interop.models import ShaTransactionLog


def _log(organization_id, transaction_type, request_payload):
    return ShaTransactionLog.objects.create(
        organization_id=organization_id,
        transaction_type=transaction_type,
        request_payload=request_payload,
        response_payload={
            "detail": "SHA gateway integration is a Phase 6 stub — no live call made."
        },
        status="PENDING",
    )


def submit_pre_authorization(pre_auth):
    """docs/08-DHA-SHA-INTEGRATION.md §8.3.2."""
    return _log(
        pre_auth.organization_id,
        "PRE_AUTHORIZATION",
        {
            "patient_id": str(pre_auth.patient_id),
            "clinical_notes": pre_auth.clinical_notes,
            "diagnostic_evidence": pre_auth.diagnostic_evidence,
        },
    )


def submit_e_claim(claim):
    """docs/08-DHA-SHA-INTEGRATION.md §8.3.3."""
    return _log(
        claim.organization_id,
        "E_CLAIM",
        {
            "patient_id": str(claim.patient_id),
            "diagnoses": claim.diagnoses_snapshot,
            "total_claimed_amount": str(claim.total_claimed_amount),
        },
    )


def verify_member(organization_id, national_id_or_upi):
    """docs/08-DHA-SHA-INTEGRATION.md §8.3.1."""
    return _log(organization_id, "MEMBER_VERIFICATION", {"identifier": national_id_or_upi})
