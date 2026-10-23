"""
HIE status callbacks (hie_spec/guides/claims__guides__status-callbacks.md and
consent__process__authorizationStatusCallbacks.md).

Receiving: the HIE POSTs {subject_guid, from_state, to_state, entity_type,
timestamp, facility_fr_code, …} to <public API>/integrations/dha/callbacks/
<token>/<entity>/. The view stores the event durably and acknowledges with a
2xx straight away; `apply_event` does the work afterwards. Rules from the guide:
- switch on entity_type before to_state (the three vocabularies collide);
- de-duplicate on subject_guid + to_state (unique constraint on the event);
- ordering is not guaranteed: when from_state does not match what we hold,
  re-read the entity from the HIE instead of applying the change blindly;
- every conditional field is optional.

Registering: one endpoint per entity type per facility, each with exactly one
`status_changed` operation; auth_type "none" behind an unguessable path
(no API route stores a credential).
"""

import hmac
import logging
import secrets

from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.dha_interop import hie_api
from apps.dha_interop.models import ShaCallbackEvent
from apps.tenancy.context import platform_admin_context
from apps.tenancy.crypto import decrypt_value, encrypt_value

from .models import InsuranceClaim, PreAuthorization, ShaVisit
from .sha_eligibility import ShaError, raise_from

logger = logging.getLogger(__name__)

ENTITY_TYPES = ("claim", "preauth", "authorization")
# "A publisher that spells the type out as preauthorization is mapped to
# preauth … An empty entity type falls back to claim."
ENTITY_ALIASES = {"preauthorization": "preauth", "": "claim"}
CALLBACK_PATHS = {
    "claim": "/callbacks/claim-status/",
    "preauth": "/callbacks/preauth-status/",
    "authorization": "/callbacks/authorization-status/",
}


# ── The callback secret ──


def callback_token(create=False):
    saved = hie_api.platform_settings()
    token = decrypt_value(saved.callback_token_encrypted)
    if not token and create:
        token = secrets.token_urlsafe(32)
        saved.callback_token_encrypted = encrypt_value(token)
        saved.save(update_fields=["callback_token_encrypted", "updated_at"])
    return token


def token_matches(candidate):
    expected = callback_token()
    return bool(expected) and hmac.compare_digest(str(candidate), expected)


def callback_base_url():
    saved = hie_api.platform_settings()
    base = (saved.public_api_base_url or "").rstrip("/")
    if not base:
        raise ShaError(
            "Enter this deployment's public API address (e.g. https://demo.citramac.com/api/v1) "
            "in DHA / SHA Integration first — the HIE needs somewhere to post callbacks.",
            field="public_api_base_url",
        )
    return f"{base}/integrations/dha/{callback_token(create=True)}"


# ── Receiving ──


def normalise_entity(value):
    value = str(value or "").strip().lower()
    return ENTITY_ALIASES.get(value, value)


def record_event(payload, path_entity):
    """Durably store one delivery. Returns (event, created). A redelivery of the
    same transition returns the stored event."""
    if not isinstance(payload, dict):
        raise ValueError("Callback body is not a JSON object")
    entity = normalise_entity(payload.get("entity_type") or path_entity)
    subject = str(payload.get("subject_guid") or "").strip()
    to_state = str(payload.get("to_state") or "").strip()
    if entity not in ENTITY_TYPES or not subject or not to_state:
        raise ValueError("Callback is missing entity_type, subject_guid or to_state")
    try:
        with transaction.atomic():
            event = ShaCallbackEvent.objects.create(
                entity_type=entity,
                subject_guid=subject[:64],
                from_state=str(payload.get("from_state") or "")[:64],
                to_state=to_state[:64],
                facility_fr_code=str(payload.get("facility_fr_code") or "")[:64],
                consent_token=str(payload.get("consent_token") or "")[:64],
                provider_claim_no=str(payload.get("provider_claim_no") or "")[:64],
                payload=payload,
                occurred_at=parse_datetime(str(payload.get("timestamp") or "")),
            )
        return event, True
    except IntegrityError:
        return (
            ShaCallbackEvent.objects.get(entity_type=entity, subject_guid=subject, to_state=to_state),
            False,
        )


def _finish(event, organization_id, outcome):
    event.organization_id = organization_id
    event.processed_at = timezone.now()
    event.outcome = outcome[:2000]
    event.save(update_fields=["organization_id", "processed_at", "outcome"])
    return event


def apply_event(event):
    """Apply a stored event to the claim / preauth / visit it concerns."""
    from apps.tenancy.context import set_tenant_context

    if event.processed_at:
        return event
    with platform_admin_context():
        if event.entity_type == "claim":
            claim = (
                InsuranceClaim.objects.unscoped()
                .filter(claim_number=event.provider_claim_no)
                .exclude(claim_number="")
                .select_related("sha_visit")
                .first()
                if event.provider_claim_no
                else None
            )
            if claim is None and event.consent_token:
                claim = (
                    InsuranceClaim.objects.unscoped()
                    .filter(sha_visit__consent_token=event.consent_token)
                    .select_related("sha_visit")
                    .first()
                )
            if claim is None:
                return _finish(event, None, "No claim matches this callback.")
            org = claim.organization_id
        elif event.entity_type == "preauth":
            visit = (
                ShaVisit.objects.unscoped().filter(consent_token=event.consent_token).first()
                if event.consent_token
                else None
            )
            pre_auth = (
                PreAuthorization.objects.unscoped().filter(sha_guid=event.subject_guid).first()
            )
            if pre_auth is None and visit is not None:
                pre_auth = (
                    PreAuthorization.objects.unscoped()
                    .filter(claim_lines__claim__sha_visit=visit)
                    .exclude(intervention_code="")
                    .order_by("-created_at")
                    .first()
                )
            if pre_auth is None:
                return _finish(event, None, "No pre-authorisation matches this callback.")
            org = pre_auth.organization_id
        else:
            visit = (
                ShaVisit.objects.unscoped()
                .filter(authorization_guid=event.subject_guid)
                .first()
            )
            if visit is None and event.consent_token:
                visit = ShaVisit.objects.unscoped().filter(consent_token=event.consent_token).first()
            if visit is None:
                return _finish(event, None, "No SHA visit matches this callback.")
            org = visit.organization_id

    set_tenant_context(organization_id=org)
    try:
        if event.entity_type == "claim":
            outcome = _apply_claim(event, claim)
        elif event.entity_type == "preauth":
            outcome = _apply_preauth(event, pre_auth, visit)
        else:
            outcome = _apply_authorization(event, visit)
    finally:
        set_tenant_context(organization_id=None)
    return _finish(event, org, outcome)


def _apply_claim(event, claim):
    from . import sha_claims

    held = claim.sha_visit.payer_workflow_state if claim.sha_visit else ""
    if held and event.from_state and event.from_state != held:
        # Missed or out-of-order transition — read the claim back instead.
        try:
            sha_claims.refresh_payer_status(claim)
        except ShaError as exc:
            return f"from_state {event.from_state} ≠ held {held}; re-read failed: {exc.message}"
        return f"from_state {event.from_state} ≠ held {held}; re-read the claim from the HIE."
    note = str(event.payload.get("notes") or "")
    sha_claims.apply_payer_state(claim, event.to_state, None, note)
    return f"Claim {claim.claim_number}: {event.to_state}"


def _apply_preauth(event, pre_auth, visit):
    from . import sha_claims

    if pre_auth.sha_state and event.from_state and event.from_state != pre_auth.sha_state:
        if visit is not None:
            try:
                sha_claims.refresh_preauth(pre_auth, visit)
            except ShaError as exc:
                return f"from_state mismatch; re-read failed: {exc.message}"
        return "from_state mismatch; re-read the pre-authorisation from the HIE."
    if not pre_auth.sha_guid:
        pre_auth.sha_guid = event.subject_guid
        pre_auth.save(update_fields=["sha_guid", "updated_at"])
    sha_claims.apply_preauth_state(pre_auth, event.to_state, str(event.payload.get("notes") or ""))
    return f"Pre-authorisation {pre_auth.id}: {event.to_state}"


def _apply_authorization(event, visit):
    from . import sha_claims

    reason = str(event.payload.get("authorization_reason") or "")
    visit.authorization_state = event.to_state[:32]
    if reason:
        visit.authorization_reason = reason[:64]
    visit.save(update_fields=["authorization_state", "authorization_reason", "updated_at"])
    if (
        visit.status == ShaVisit.STATUS_AWAITING_CONSENT
        and event.to_state in sha_claims.AUTHORIZED_STATES + ("REJECTED", "EXPIRED")
    ):
        try:
            sha_claims.refresh_biometric_consent(visit, visit.opened_by)
        except ShaError as exc:
            return f"Authorisation {event.to_state}; opening the visit failed: {exc.message}"
    return f"Authorisation {visit.authorization_guid}: {event.to_state}"


def apply_pending(limit=200):
    applied = 0
    for event in ShaCallbackEvent.objects.filter(processed_at__isnull=True).order_by(
        "received_at"
    )[:limit]:
        try:
            apply_event(event)
            applied += 1
        except Exception:  # noqa: BLE001 — one bad event must not stop the sweep
            logger.exception("Applying SHA callback %s failed", event.id)
    return applied


# ── Registering ──


def register_callbacks(branch):
    """Register the three status_changed endpoints for one facility. Idempotent:
    an entity type already registered for this facility is left alone."""
    saved = hie_api.platform_settings()
    if not (saved.tenant_id or saved.tenant_code):
        raise ShaError(
            "Enter the HIE tenant ID or tenant code issued by DHA under DHA / SHA Integration.",
            field="tenant_id",
        )
    if not branch.sha_fr_code:
        raise ShaError(f"{branch.name} has no SHA FR code.", field="sha_fr_code")
    base_url = callback_base_url()
    tenant = saved.tenant_id or saved.tenant_code
    try:
        existing = hie_api.call(
            "GET",
            f"/tenants/{branch.sha_fr_code}/endpoints",
            transaction_type="CALLBACK_REGISTRATION",
            organization_id=branch.organization_id,
            platform=True,
        )
    except hie_api.HieError as exc:
        if exc.http_status == 404:
            existing = []
        else:
            raise_from(exc)
    except hie_api.HieNotConfigured as exc:
        raise_from(exc)
    if isinstance(existing, dict):
        existing = existing.get("results") or existing.get("data") or []
    registered = {
        e.get("entity_type")
        for e in existing
        if isinstance(e, dict) and e.get("operations") and e.get("base_url") == base_url
    }
    results = []
    for entity in ENTITY_TYPES:
        if entity in registered:
            results.append({"entity_type": entity, "status": "already registered"})
            continue
        body = {
            "name": f"CITRAMAC {entity} status",
            "entity_type": entity,
            "base_url": base_url,
            "auth_type": "none",
            "environment": saved.environment,
            "facility_fr_code": branch.sha_fr_code,
        }
        if saved.tenant_code:
            body["tenant_code"] = saved.tenant_code
        try:
            endpoint = hie_api.call(
                "POST",
                f"/tenants/{tenant}/endpoints",
                transaction_type="CALLBACK_REGISTRATION",
                organization_id=branch.organization_id,
                platform=True,
                json_body=body,
            )
            endpoint_id = (endpoint or {}).get("endpoint_id")
            if not endpoint_id:
                raise ShaError("The HIE returned no endpoint_id for the callback endpoint.")
            # First path segment is the facility FR code, never a placeholder.
            hie_api.call(
                "POST",
                f"/tenants/{branch.sha_fr_code}/endpoints/{endpoint_id}/operations",
                transaction_type="CALLBACK_REGISTRATION",
                organization_id=branch.organization_id,
                platform=True,
                json_body={
                    "name": f"CITRAMAC {entity} status changed",
                    "action": "status_changed",
                    "method": "POST",
                    "path": CALLBACK_PATHS[entity],
                },
            )
        except (hie_api.HieError, hie_api.HieNotConfigured) as exc:
            raise_from(exc)
        results.append({"entity_type": entity, "status": "registered", "endpoint_id": endpoint_id})
    return results
