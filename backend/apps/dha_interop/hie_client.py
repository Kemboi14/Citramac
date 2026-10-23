"""
Durable outbox for clinical data bound for the DHA Shared Health Record
(POST /shr/bundles — hie_spec/openapi/sharedhealthrecord.openapi.json).

CLAUDE.md §4 "Fail safely":
- every outbound bundle is first written to a durable outbox row
  (`FhirResourceCache`) keyed by a stable idempotency key, so enqueueing twice
  is a no-op and clinical work never blocks on the network;
- delivery goes through apps.dha_interop.hie_api (token, facility headers,
  transaction log) and keeps the HIE's message and trace id — and any FHIR
  OperationOutcome issues with their `issue.expression` — for whoever can fix
  the data;
- a timeout is retried only when the send is idempotent (`retry_safe`) —
  never blind; an SHR bundle POST is not documented as idempotent, so a
  failed send is surfaced for a person to resend;
- when the HIE is not configured, that is recorded and logged explicitly —
  never a silent success.

DHA publishes no endpoint for pushing a Patient (the Client Registry is
read through GET /patients) nor for a free-standing referral document;
registration identity is reconciled by a Client Registry lookup instead
(apps.dha_interop.registries) and referrals reach the SHR only as a
ServiceRequest addressed to a facility's FR code.
"""

import logging
from datetime import timedelta

from django.utils import timezone

from . import hie_api
from .models import FhirResourceCache

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 6
BACKOFF_MINUTES = (1, 5, 15, 60, 240)
SHR_BUNDLE = "ShrBundle"


def parse_operation_outcome(payload):
    """[{severity, code, expression, diagnostics}] from an OperationOutcome body."""
    if not isinstance(payload, dict) or payload.get("resourceType") != "OperationOutcome":
        return []
    issues = []
    for issue in payload.get("issue", []):
        issues.append(
            {
                "severity": issue.get("severity", ""),
                "code": issue.get("code", ""),
                "expression": issue.get("expression") or issue.get("location") or [],
                "diagnostics": issue.get("diagnostics")
                or (issue.get("details") or {}).get("text", ""),
            }
        )
    return issues


def describe_issues(issues):
    return "; ".join(
        f"{i['severity']}: {', '.join(i['expression']) or 'resource'} — {i['diagnostics'] or i['code']}"
        for i in issues
    )


def enqueue(organization_id, resource_type, fhir_json, idempotency_key, *, related=None,
            retry_safe=False):
    """Idempotent: a second call with the same key returns the first row."""
    entry, created = FhirResourceCache.objects.get_or_create(
        organization_id=organization_id,
        idempotency_key=idempotency_key,
        defaults={
            "resource_type": resource_type,
            "direction": "OUTBOUND",
            "fhir_json": fhir_json,
            "related_object_type": related[0] if related else "",
            "related_object_id": related[1] if related else None,
            "status": "CACHED",
            "retry_safe": retry_safe,
            "next_attempt_at": timezone.now(),
        },
    )
    if not created and entry.status in ("CACHED", "RETRY", "REJECTED"):
        # A corrected resource replaces an unsent / rejected one under the same key.
        entry.fhir_json = fhir_json
        entry.status = "CACHED"
        entry.next_attempt_at = timezone.now()
        entry.save(update_fields=["fhir_json", "status", "next_attempt_at", "updated_at"])
    return entry


def _branch_for(entry):
    """The facility a queued SHR bundle is sent on behalf of (its consent's branch)."""
    from .models import ShrConsent

    if entry.related_object_type != "ShrConsent" or not entry.related_object_id:
        return None
    consent = (
        ShrConsent.objects.unscoped().select_related("branch").filter(pk=entry.related_object_id).first()
    )
    return consent.branch if consent else None


def deliver(entry):
    """One delivery attempt. Updates and returns the outbox row."""
    if entry.resource_type != SHR_BUNDLE:
        entry.status = "FAILED"
        entry.next_attempt_at = None
        entry.transmission_detail = (
            f"No DHA HIE endpoint accepts a {entry.resource_type} — only Shared Health Record "
            "bundles are sent."
        )
        entry.save(update_fields=["status", "next_attempt_at", "transmission_detail", "updated_at"])
        return entry
    branch = _branch_for(entry)
    if branch is None:
        entry.status = "FAILED"
        entry.next_attempt_at = None
        entry.transmission_detail = "The bundle's SHR consent (and so its facility) is missing."
        entry.save(update_fields=["status", "next_attempt_at", "transmission_detail", "updated_at"])
        return entry
    entry.attempts += 1
    try:
        body = hie_api.call(
            "POST",
            "/shr/bundles",
            transaction_type="SHR_BUNDLE",
            organization_id=entry.organization_id,
            branch=branch,
            json_body=entry.fhir_json,
        )
    except hie_api.HieNotConfigured as exc:
        entry.attempts -= 1
        entry.status = "CACHED"
        entry.transmission_detail = f"Queued, not sent: {exc}"
        logger.warning("SHR outbox %s held: %s", entry.id, exc)
        entry.save(update_fields=["status", "attempts", "transmission_detail", "updated_at"])
        return entry
    except hie_api.HieError as exc:
        entry.http_status = exc.http_status
        entry.issues = parse_operation_outcome(exc.body)
        if exc.transient:
            return _after_transient(entry, exc.describe())
        entry.status = "REJECTED"
        entry.next_attempt_at = None
        entry.transmission_detail = describe_issues(entry.issues) or exc.describe()
        entry.save()
        return entry
    # Accepted and queued upstream — processing is asynchronous.
    entry.http_status = 200
    entry.issues = []
    entry.status = "SENT"
    entry.next_attempt_at = None
    mediator = (body or {}).get("mediator_id", "")
    entry.transmission_detail = (
        f"Accepted by the SHR (mediator_id {mediator}). {(body or {}).get('message', '')}".strip()
    )
    entry.save()
    return entry


def _after_transient(entry, detail):
    entry.transmission_detail = detail
    if not entry.retry_safe or entry.attempts >= MAX_ATTEMPTS:
        # Not safe to repeat without a stable identifier, or out of attempts:
        # surface it for a person rather than hammering the HIE.
        entry.status = "FAILED"
        entry.next_attempt_at = None
    else:
        entry.status = "RETRY"
        wait = BACKOFF_MINUTES[min(entry.attempts - 1, len(BACKOFF_MINUTES) - 1)]
        entry.next_attempt_at = timezone.now() + timedelta(minutes=wait)
    entry.save()
    return entry


def drain_outbox(limit=50):
    """Deliver everything due. Each row is claimed under `select_for_update(skip_locked=True)`
    so two workers never send the same bundle."""
    from django.db import transaction

    from apps.tenancy.context import platform_admin_context

    delivered = 0
    with platform_admin_context():
        for _ in range(limit):
            with transaction.atomic():
                entry = (
                    FhirResourceCache.objects.select_for_update(skip_locked=True)
                    .filter(
                        direction="OUTBOUND",
                        status__in=["CACHED", "RETRY"],
                        next_attempt_at__lte=timezone.now(),
                    )
                    .order_by("next_attempt_at")
                    .first()
                )
                if entry is None:
                    break
                FhirResourceCache.objects.filter(pk=entry.pk).update(
                    next_attempt_at=timezone.now() + timedelta(minutes=10)
                )
            deliver(entry)
            delivered += 1
    return delivered


def transmit_referral(referral_packet, bundle_json):
    """
    Referral document Bundle: recorded, not sent. The national exchange takes
    referrals only as an SHR ServiceRequest addressed to the destination
    facility's FR code, and a referral packet records its destination as free
    text — so there is nowhere to deliver this bundle. FAILED with that reason,
    never a silent success.
    """
    entry = enqueue(
        referral_packet.organization_id,
        "Bundle",
        bundle_json,
        f"referral:{referral_packet.id}",
        related=("ReferralPacket", referral_packet.id),
        retry_safe=False,
    )
    entry.status = "FAILED"
    entry.next_attempt_at = None
    entry.transmission_detail = (
        "Not transmitted: the DHA HIE accepts referrals only as a Shared Health Record "
        "ServiceRequest addressed to the destination facility's FR code, and this referral "
        "records its destination as free text."
    )
    entry.save(update_fields=["status", "next_attempt_at", "transmission_detail", "updated_at"])
    return entry
