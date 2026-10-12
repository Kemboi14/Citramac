"""
HIE (National Health Information Exchange) transmission — docs/08-DHA-SHA-INTEGRATION.md §8.1.

CLAUDE.md §4 "Fail safely":
- every outbound resource is first written to a durable outbox row
  (`FhirResourceCache`) keyed by a stable idempotency key, so enqueueing twice
  is a no-op and clinical work never blocks on the network;
- delivery parses an `OperationOutcome` and keeps `issue.expression` so the
  person who can fix the data is told which field is wrong;
- a timeout is retried only when the send is idempotent (`retry_safe`, an
  update-as-create PUT by id) — never blind;
- when the HIE is not configured or consent is absent, that is recorded and
  logged explicitly — never a silent success.

VERIFY: the HIE base URL, per-interaction paths and authentication are defined
by the national IG / DHA onboarding pack. They are read from settings
(`HIE_ENDPOINT_URL`, `HIE_PATIENT_PATH`, `HIE_BUNDLE_PATH`) and nothing is assumed.
"""

import logging
from datetime import timedelta

import requests
from django.conf import settings
from django.utils import timezone

from apps.client_registry.consent import HIE_GENERAL, may_send_to_hie

from .models import FhirResourceCache

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 6
BACKOFF_MINUTES = (1, 5, 15, 60, 240)
FHIR_JSON = "application/fhir+json"


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


def enqueue_patient(patient):
    """Queue the Patient for the HIE — only with an explicit consent YES."""
    from .fhir_patient import build_patient_resource

    if not may_send_to_hie(patient, HIE_GENERAL):
        logger.info("Patient %s not queued for the HIE: no explicit consent.", patient.id)
        return None
    resource, omitted = build_patient_resource(patient)
    for reason in omitted:
        logger.warning("Patient %s: identifier withheld from FHIR — %s", patient.id, reason)
    return enqueue(
        patient.organization_id,
        "Patient",
        resource.model_dump(mode="json", exclude_none=True),
        f"patient:{patient.id}",
        related=("Patient", patient.id),
        retry_safe=True,
    )


def _target(entry):
    endpoint = (getattr(settings, "HIE_ENDPOINT_URL", "") or "").rstrip("/")
    if not endpoint:
        return None, None, "HIE_ENDPOINT_URL is not configured"
    if entry.resource_type == "Patient":
        path = (getattr(settings, "HIE_PATIENT_PATH", "") or "").strip("/")
        if not path:
            return None, None, "HIE_PATIENT_PATH is not configured (VERIFY with the national IG)"
        return "PUT", f"{endpoint}/{path}/{entry.fhir_json['id']}", ""
    path = (getattr(settings, "HIE_BUNDLE_PATH", "") or "").strip("/")
    return "POST", f"{endpoint}/{path}" if path else endpoint, ""


def deliver(entry):
    """One delivery attempt. Updates and returns the outbox row."""
    method, url, reason = _target(entry)
    if method is None:
        entry.status = "CACHED"
        entry.transmission_detail = f"Queued, not sent: {reason}."
        logger.warning("HIE outbox %s held: %s", entry.id, reason)
        entry.save(update_fields=["status", "transmission_detail", "updated_at"])
        return entry

    client_cert = getattr(settings, "HIE_MTLS_CLIENT_CERT", "") or ""
    client_key = getattr(settings, "HIE_MTLS_CLIENT_KEY", "") or ""
    entry.attempts += 1
    try:
        response = requests.request(
            method,
            url,
            json=entry.fhir_json,
            headers={"Content-Type": FHIR_JSON, "Accept": FHIR_JSON},
            cert=(client_cert, client_key) if client_cert and client_key else None,
            timeout=30,
        )
    except requests.Timeout as exc:
        return _after_transient(entry, f"Timed out: {exc}")
    except requests.RequestException as exc:
        return _after_transient(entry, str(exc))

    entry.http_status = response.status_code
    try:
        body = response.json()
    except ValueError:
        body = None
    entry.issues = parse_operation_outcome(body)
    if response.ok:
        entry.status = "SENT"
        entry.next_attempt_at = None
        entry.transmission_detail = f"HTTP {response.status_code}"
    elif response.status_code in (408, 429) or response.status_code >= 500:
        return _after_transient(entry, f"HTTP {response.status_code}")
    else:
        entry.status = "REJECTED"
        entry.next_attempt_at = None
        entry.transmission_detail = (
            describe_issues(entry.issues) or f"HTTP {response.status_code}"
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
    """Deliver everything due. Safe to run concurrently-ish: rows are claimed by
    pushing next_attempt_at out before the network call."""
    now = timezone.now()
    due = FhirResourceCache.objects.filter(
        direction="OUTBOUND", status__in=["CACHED", "RETRY"], next_attempt_at__lte=now
    ).order_by("next_attempt_at")[:limit]
    delivered = 0
    for entry in due:
        FhirResourceCache.objects.filter(pk=entry.pk).update(
            next_attempt_at=now + timedelta(minutes=10)
        )
        deliver(entry)
        delivered += 1
    return delivered


def transmit_referral(referral_packet, bundle_json):
    """
    Referral Bundle: enqueue durably, then attempt delivery now. A Bundle POST
    is not idempotent, so a timeout is NOT retried automatically
    (`retry_safe=False`) — the row is FAILED for a person to resend. With no
    endpoint configured the row is FAILED with that reason (existing behaviour).
    """
    entry = enqueue(
        referral_packet.organization_id,
        "Bundle",
        bundle_json,
        f"referral:{referral_packet.id}",
        related=("ReferralPacket", referral_packet.id),
        retry_safe=False,
    )
    if not (getattr(settings, "HIE_ENDPOINT_URL", "") or ""):
        entry.status = "FAILED"
        entry.next_attempt_at = None
        entry.transmission_detail = (
            "HIE_ENDPOINT_URL is not configured — no live transmission attempted. Real "
            "transmission requires the facility's mutual-TLS client certificate per "
            "docs/08-DHA-SHA-INTEGRATION.md §8.4."
        )
        entry.save(update_fields=["status", "next_attempt_at", "transmission_detail", "updated_at"])
        return entry
    return deliver(entry)
