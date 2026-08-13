"""
SHA gateway service — docs/08-DHA-SHA-INTEGRATION.md §8.3. Every call is
logged to ShaTransactionLog regardless of outcome, per §8.3's "SHA
transactions are financial or medical, never fire-and-forget."

`settings.SHA_GATEWAY_MODE` gates behavior:
- "stub" (default): honestly reports PENDING/no-op, no live call — no real
  SHA sandbox/production endpoint or facility certificate exists in this
  environment.
- "sandbox"/"production": signs the payload (apps.insurance_claims.signing,
  §8.4) and POSTs it to `settings.SHA_GATEWAY_ENDPOINT_URL`. If the endpoint
  or signing key isn't configured even in this mode, fails honestly rather
  than silently falling back to the stub behavior.
"""

import requests
from django.conf import settings

from apps.dha_interop.models import ShaTransactionLog

from .signing import SigningNotConfigured, sign_payload


def _log(organization_id, transaction_type, request_payload):
    mode = getattr(settings, "SHA_GATEWAY_MODE", "stub")

    if mode == "stub":
        return ShaTransactionLog.objects.create(
            organization_id=organization_id,
            transaction_type=transaction_type,
            request_payload=request_payload,
            response_payload={
                "detail": "SHA gateway integration is a Phase 6 stub — no live call made."
            },
            status="PENDING",
        )

    endpoint = getattr(settings, "SHA_GATEWAY_ENDPOINT_URL", "") or ""
    if not endpoint:
        return ShaTransactionLog.objects.create(
            organization_id=organization_id,
            transaction_type=transaction_type,
            request_payload=request_payload,
            response_payload={
                "detail": (
                    f"SHA_GATEWAY_MODE is '{mode}' but SHA_GATEWAY_ENDPOINT_URL is not "
                    "configured — refusing to fall back to stub behavior silently."
                )
            },
            status="FAILED",
        )

    try:
        signature = sign_payload(request_payload)
    except SigningNotConfigured as exc:
        return ShaTransactionLog.objects.create(
            organization_id=organization_id,
            transaction_type=transaction_type,
            request_payload=request_payload,
            response_payload={"detail": str(exc)},
            status="FAILED",
        )

    try:
        response = requests.post(
            endpoint,
            json=request_payload,
            headers={"X-Citramac-Signature": signature},
            timeout=30,
        )
        response_payload = {"http_status": response.status_code}
        try:
            response_payload["body"] = response.json()
        except ValueError:
            response_payload["body"] = response.text
        response.raise_for_status()
        log_status = "SUCCESS"
    except requests.RequestException as exc:
        response_payload = {"detail": str(exc)}
        log_status = "FAILED"

    return ShaTransactionLog.objects.create(
        organization_id=organization_id,
        transaction_type=transaction_type,
        request_payload=request_payload,
        response_payload=response_payload,
        status=log_status,
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
