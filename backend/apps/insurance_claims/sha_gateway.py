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
    payload = {
        "patient_id": str(pre_auth.patient_id),
        "clinical_notes": pre_auth.clinical_notes,
        "diagnostic_evidence": pre_auth.diagnostic_evidence,
    }
    if pre_auth.service_id:
        # Per-claim-line request: the service and its configured payer code
        # only — no clinical narrative (minimum necessary).
        line = pre_auth.claim_lines.first()
        payload["service"] = pre_auth.service.name
        payload["payer_code"] = line.payer_code if line else ""
        payload["quantity"] = line.quantity if line else None
    return _log(pre_auth.organization_id, "PRE_AUTHORIZATION", payload)


def submit_e_claim(claim, facility_branch=None):
    """docs/08-DHA-SHA-INTEGRATION.md §8.3.3. `facility_branch` is the branch
    the care was delivered at; its SHA FR code identifies the facility."""
    from .models import ATTACHMENT_EXCLUDED_CATEGORIES

    payload = {
        "patient_id": str(claim.patient_id),
        "diagnoses": claim.diagnoses_snapshot,
        "total_claimed_amount": str(claim.total_claimed_amount),
    }
    if facility_branch is not None:
        # VERIFY: the element name SHA's e-claim specification uses for the
        # facility FR code — this payload shape is the stub's own.
        payload["facility_fr_code"] = facility_branch.sha_fr_code
    lines = list(claim.lines.all())
    if lines:
        payload["claim_number"] = claim.claim_number
        payload["lines"] = [
            {
                "service": line.service_name,
                "payer_code": line.payer_code,
                "quantity": line.quantity,
                "unit_price": str(line.unit_price),
                "pre_authorization": (
                    line.pre_authorization.approval_reference if line.pre_authorization else ""
                ),
            }
            for line in lines
        ]
        # Re-filtered here even though the model and serializer refuse them:
        # restricted categories must never leave the system.
        payload["attachments"] = [
            a.category
            for a in claim.attachments.all()
            if a.category not in ATTACHMENT_EXCLUDED_CATEGORIES
        ]
    return _log(claim.organization_id, "E_CLAIM", payload)


def verify_member(organization_id, national_id_or_upi):
    """docs/08-DHA-SHA-INTEGRATION.md §8.3.1."""
    return _log(organization_id, "MEMBER_VERIFICATION", {"identifier": national_id_or_upi})
