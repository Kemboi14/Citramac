"""
SHA e-claims through the DHA HIE middleware
(hie_spec/openapi/eclaims.openapi.json, consent.openapi.json; guides
claims__process__* and consent__process__*).

The HIE's model is a "virtual claim" opened at the visit, not a claim built
afterwards:

1. Consent while the patient is present — OTP (POST /claims/otp, then
   POST /claims/visit with the OTP) or fingerprint (POST /claims/authorize →
   capture iframe → GET /claims/authorizations until AUTHORIZED → POST
   /claims/visit with auth_guid). Which path applies comes from the
   eligibility flags facilityBiometricsEnforced / whitelistedForOTP.
2. The visit's `authorization_code` is the consent_token every later call
   carries (startVisitWorkflow.md: "The authorization_code IS the
   consent_token").
3. Billing: POST /claims/lines (one per documented, priced service, added
   once and remembered by its GUID), /claims/diagnoses (ICD-11, coded only),
   /claims/attachments (the filed document, labelled with an SHA document type).
4. Pre-authorisation where the intervention needsPreauth (POST /preauths).
5. Dispatch: POST /claims/submit (outpatient / emergency) or
   /claims/discharge (inpatient), carrying claim_number as invoice_number
   — the stable business identifier that makes a resend harmless.
6. Payer outcome from status callbacks (apps.insurance_claims.sha_callbacks)
   or GET /claims/preview/payer.

What leaves the record is codes and amounts only: no diagnosis narrative, and
never psychotherapy/process notes or trauma history as attachments.
"""

import json

from django.db import transaction
from django.utils import timezone

from apps.client_registry.models import PatientIdentifier
from apps.dha_interop import hie_api
from apps.dha_interop.registries import claim_practitioner_fields, client_registry_id

from .models import (
    ATTACHMENT_EXCLUDED_CATEGORIES,
    InsuranceClaim,
    PreAuthorization,
    ShaIntervention,
    ShaVisit,
)
from .sha_eligibility import ShaError, latest_check, raise_from

# claims__guides__sha-combination-rules.md, "Intervention Code Combinations:
# SHA" — packages whose interventions must be billed ALONE on a visit.
# (SHA-16 is partly alone, partly combinable; it is left to the HIE to rule on.)
ALONE_PACKAGES = ("SHA-05", "SHA-06", "SHA-09", "SHA-10", "SHA-12", "SHA-18")
# The published enums used in request bodies.
SERVICE_TYPES = ("OUTPATIENT", "INPATIENT", "CAPITATION", "EMERGENCY")
AUTHORIZE_SERVICE_TYPES = ("OUTPATIENT", "INPATIENT")
DEVICE_OS = ("windows", "android")
OUTPATIENT_DISCHARGE_REASONS = ("RECOVERED", "REFERRED", "ABSCONDED", "OTHER")
INPATIENT_DISCHARGE_REASONS = ("RECOVERED", "REFERRED", "DECEASED", "ABSCONDED", "OTHER")
CLOSE_REASONS = (
    "WRONG_PATIENT",
    "NO_SERVICE_GIVEN",
    "WRONG_BENEFIT",
    "EXPIRED_VISIT",
    "EXHAUSTED_BENEFIT",
    "TIME_BARRED",
    "OTHER_REASONS",
)
OTP_WHITELIST_REASONS = (
    "OTHER",
    "OLD",
    "AMPUTEE",
    "EXPIRED",
    "MEDICAL_CONDITION",
    "BIOMETRIC_FAILURE",
    "CHILD_BELOW_7_YEARS",
    "MENTALLY_UNSTABLE",
    "CONSTRUCTION_WORKER",
    "ONCOLOGY_TREATMENT",
    "DIALYSIS_TREATMENT",
    "PRIVACY_CONCERNS",
    "TECHNICAL_ISSUES",
)
CLAIM_DOCUMENT_TYPES = (
    "BIO_DETAILS",
    "BIRTH_NOTIFICATION",
    "CARE_PLAN",
    "CASE_NOTE",
    "CASE_SUMMARY",
    "CERTIFIED_BURIAL_PERMIT",
    "CERTIFIED_COPY_OF_DECEASED_ID",
    "CLAIM_FORM",
    "COVER_LETTER_FROM_EMPLOYER",
    "CRITICAL_CARE_UNIT_CASE",
    "CT_SCAN",
    "DEATH_NOTICE",
    "DIALYSIS_CHART",
    "DISCHARGE_SUMMARY",
    "ENTRY_EXIT_VISA_STAMP",
    "FINAL_BILL",
    "IMAGING_ORDER",
    "IMAGING_REPORT",
    "INVOICE",
    "LAB_ORDER",
    "LAB_RESULTS",
    "MAGNETIC_RESONANCE_IMAGING",
    "MEDICAL_REPORT",
    "OTHER",
    "POST_SERVICE_IMAGING_REPORT",
    "PRE_SERVICE_IMAGING_REPORT",
    "PREAUTH_FORM",
    "PRESCRIPTION",
    "REQUEST_FORM_BY_RELEVANT_CONSULTANT",
    "RHESUS_FACTOR",
    "THEATRE_NOTES",
)
# Authorisation states that count as consent granted
# (consent__guides__biometrics-integration.md, Step 3).
AUTHORIZED_STATES = ("AUTHORIZED", "AUTHORIZED_PENDING_VISIT")
OTP_FALLBACK_REASON = "BIOMETRICS_NOT_FOUND_OTP_ALLOWED"

# Payer workflowState (understandingClaimStatuses.md, "Payer Workflow State")
# and the provider workflow_state values a claim callback can carry → our claim
# status. Anything unlisted keeps the claim's status and is shown verbatim.
PAYER_STATE_TO_STATUS = {
    "APPROVED": "APPROVED",
    "PAID": "APPROVED",
    "REJECTED": "REJECTED",
    "TIME_BARRED": "REJECTED",
    "SENT_BACK": "RETURNED",
    "CLARIFICATION_AFTER_AUTOMATIC_CHECKS": "RETURNED",
    "MISSING_DOCUMENTS": "RETURNED",
    "FAILED_TO_SUBMIT": "RETURNED",
    "DRAFT_PROVIDER": "UNDER_REVIEW",
    "SUBMITTED_PROVIDER": "UNDER_REVIEW",
    "AUTOMATIC_CHECKS_DONE": "UNDER_REVIEW",
    "SUBMITTED_PAYER": "UNDER_REVIEW",
    "IN_REVIEW": "UNDER_REVIEW",
    "CLINICAL_REVIEW": "UNDER_REVIEW",
    "MEDICAL_REVIEW": "UNDER_REVIEW",
    "UNDER_COMMITTEE_REVIEW": "UNDER_REVIEW",
    "SENT_TO_SURVEILLANCE": "UNDER_REVIEW",
    "MANUAL_REVIEW": "UNDER_REVIEW",
    "DRAFT_PROVIDER_RESUBMITTED": "UNDER_REVIEW",
    "DRAFT_PROVIDER_RESUBMITTED_MISSING_DOCUMENTS": "UNDER_REVIEW",
    "RESUBMITTED_MISSING_DOCUMENTS": "UNDER_REVIEW",
    "SENT_FOR_PAYMENT_PROCESSING": "UNDER_REVIEW",
    "APPEALED": "UNDER_REVIEW",
    "DISPATCHED": "UNDER_REVIEW",
}
# Preauth status (understandingPreauthStatuses.md) → PreAuthorization.status.
PREAUTH_STATE_TO_STATUS = {
    "ACTIVE": "SUBMITTED",
    "PENDING_SUBMISSION": "SUBMITTED",
    "CLARIFICATION_AFTER_AUTOMATIC_CHECKS": "SUBMITTED",
    "DOCTOR_REQUEST_SENT": "SUBMITTED",
    "PENDING_DOCTOR_APPROVAL": "SUBMITTED",
    "FINALISED": "APPROVED",
    "REJECTED": "REJECTED",
    "REJECTED_AFTER_APPROVAL": "REJECTED",
    "CANCELLED": "REJECTED",
}


def _user_label(user):
    if not user:
        return "HIE"
    return user.get_full_name() if hasattr(user, "get_full_name") else str(user)


def _visit_history(visit, state, user, note=""):
    visit.status_history = list(visit.status_history or []) + [
        {"state": state, "at": timezone.now().isoformat(), "by": _user_label(user), "note": note}
    ]


def _claim_history(claim, status, user, note=""):
    claim.status_history = list(claim.status_history or []) + [
        {"status": status, "at": timezone.now().isoformat(), "by": _user_label(user), "note": note}
    ]


def _call(method, path, *, transaction_type, branch, organization_id, **kwargs):
    try:
        return hie_api.call(
            method,
            path,
            transaction_type=transaction_type,
            organization_id=organization_id,
            branch=branch,
            **kwargs,
        )
    except (hie_api.HieError, hie_api.HieNotConfigured) as exc:
        raise_from(exc)


def package_of(code):
    """`SHA-10` for `SHA-10-005` — the code format of benefit-intervention-codes.md."""
    parts = (code or "").split("-")
    return "-".join(parts[:2]) if len(parts) >= 2 else code


def check_combination(codes):
    codes = [c for c in codes if c]
    if len(codes) <= 1:
        return
    for code in codes:
        if package_of(code) in ALONE_PACKAGES:
            raise ShaError(
                f"{code} ({package_of(code)}) must be billed alone — SHA's combination rules allow "
                "no other intervention on the same visit. Start a separate visit for the others.",
                field="intervention_codes",
            )


def _require_cr_id(patient):
    cr_id = client_registry_id(patient)
    if not cr_id:
        raise ShaError(
            "Look the client up in the Client Registry and confirm the match first — SHA visits "
            "are opened by Client Registry ID.",
            field="cr_id",
        )
    return cr_id


def _require_alive(patient):
    check = latest_check(patient)
    if check is not None and check.is_alive is False:
        raise ShaError(
            "SHA records this client as deceased — no SHA transaction can be made. Resolve the "
            "record with SHA before continuing.",
            field="eligibility",
        )
    return check


def _validate_visit_request(service_type, intervention_codes):
    if service_type not in SERVICE_TYPES:
        raise ShaError("Choose the type of service.", field="service_type")
    codes = [str(c).strip() for c in intervention_codes or [] if str(c).strip()]
    if not codes:
        raise ShaError("Choose at least one SHA intervention for the visit.", field="intervention_codes")
    check_combination(codes)
    return codes


def _branch_ready(branch):
    if not branch.sha_claims_enabled:
        raise ShaError(f"SHA claims are not enabled for {branch.name}.", field="branch")
    if not branch.sha_fr_code:
        raise ShaError(f"{branch.name} has no SHA FR code.", field="branch")


# ── Consent: contacts, OTP, biometrics, whitelist ──


def list_contacts(patient, branch):
    cr_id = _require_cr_id(patient)
    body = _call(
        "GET",
        "/patients/contacts",
        transaction_type="CLAIM_CONSENT",
        branch=branch,
        organization_id=patient.organization_id,
        params={"patient_id": cr_id},
    )
    return [
        {
            "id": c.get("id"),
            "type": c.get("contactType", ""),
            # Already masked by the HIE.
            "value": c.get("contactValue", ""),
            "confirmed": bool(c.get("isConfirmed")),
            "active": c.get("active", True),
        }
        for c in ((body.get("results") or []) if isinstance(body, dict) else [])
    ]


def send_visit_otp(patient, branch, intervention_codes, contact_id=None):
    _branch_ready(branch)
    cr_id = _require_cr_id(patient)
    _require_alive(patient)
    codes = _validate_visit_request("OUTPATIENT", intervention_codes)
    payload = {"patient_id": cr_id, "intervention_codes": codes}
    if contact_id not in (None, ""):
        try:
            payload["contact_id"] = int(contact_id)
        except (TypeError, ValueError):
            raise ShaError("Choose one of the client's registered contacts.", field="contact_id") from None
    body = _call(
        "POST",
        "/claims/otp",
        transaction_type="CLAIM_CONSENT",
        branch=branch,
        organization_id=patient.organization_id,
        json_body=payload,
    )
    return (body or {}).get("message", "The OTP has been sent to the client.")


def _visit_from_response(visit, body, user, note):
    visit.consent_token = str(body.get("authorization_code") or "")[:64]
    if not visit.consent_token:
        raise ShaError("The HIE opened no visit — its response carried no authorization code.")
    visit.authorization_guid = str(body.get("authorization_guid") or visit.authorization_guid)[:64]
    visit.claim_guid = str(body.get("edi_claim_guid") or "")[:64]
    visit.workflow_state = str(body.get("workflow_state") or "")[:48]
    visit.authorization_state = str(body.get("claim_auth_status") or "AUTHORIZED")[:32]
    visit.status = ShaVisit.STATUS_OPEN
    visit.opened_at = timezone.now()
    _visit_history(visit, "OPEN", user, note)
    visit.save()
    return visit


@transaction.atomic
def open_visit_with_otp(patient, branch, user, service_type, intervention_codes, otp, episode=None):
    _branch_ready(branch)
    cr_id = _require_cr_id(patient)
    check = _require_alive(patient)
    codes = _validate_visit_request(service_type, intervention_codes)
    if check is not None and check.biometrics_enforced and not check.whitelisted_for_otp:
        raise ShaError(
            "This facility must use fingerprint consent for this client — OTP is allowed only "
            "once SHA whitelists them.",
            field="consent_method",
        )
    otp = (otp or "").strip()
    if not otp:
        raise ShaError("Enter the OTP the client received.", field="otp")
    body = _call(
        "POST",
        "/claims/visit",
        transaction_type="CLAIM_VISIT",
        branch=branch,
        organization_id=patient.organization_id,
        json_body={
            "intervention_codes": codes,
            "patient_id": cr_id,
            "service_type": service_type,
            "otp": otp,
            **claim_practitioner_fields(user),
        },
    )
    visit = ShaVisit(
        organization=patient.organization,
        patient=patient,
        branch=branch,
        episode=episode,
        cr_id=cr_id,
        service_type=service_type,
        intervention_codes=codes,
        consent_method="OTP",
        opened_by=user,
    )
    return _visit_from_response(visit, body or {}, user, "Visit opened with the client's OTP")


@transaction.atomic
def start_biometric_consent(
    patient, branch, user, service_type, intervention_codes, *, agent_id, work_station_id,
    device_os="windows", episode=None,
):
    _branch_ready(branch)
    cr_id = _require_cr_id(patient)
    _require_alive(patient)
    codes = _validate_visit_request(service_type, intervention_codes)
    if service_type not in AUTHORIZE_SERVICE_TYPES:
        raise ShaError("Fingerprint consent covers outpatient and inpatient visits.", field="service_type")
    if not (agent_id or "").strip():
        raise ShaError("Enter the biometrics agent's national ID.", field="agent_id")
    if not (work_station_id or "").strip():
        raise ShaError(
            "The workstation ID is missing — start HealthID on this computer and check "
            "http://localhost:18065/status.",
            field="work_station_id",
        )
    if device_os not in DEVICE_OS:
        raise ShaError("Choose the device's operating system.", field="device_os")
    body = _call(
        "POST",
        "/claims/authorize",
        transaction_type="CLAIM_CONSENT",
        branch=branch,
        organization_id=patient.organization_id,
        json_body={
            "agent_id": agent_id.strip(),
            "authorizing_device_os": device_os,
            "ekyc_provider_id": branch.name,
            "factors": ["SHA"],
            "interventions": codes,
            "is_biometrics_discharge_authorization": False,
            "is_emergency": False,
            "is_integration": True,
            "patient_id": cr_id,
            "provider": branch.sha_fr_code,
            "service_type": service_type,
            "work_station_id": work_station_id.strip(),
        },
    )
    body = body or {}
    verification = body.get("shaVerificationRequest") or {}
    visit = ShaVisit.objects.create(
        organization=patient.organization,
        patient=patient,
        branch=branch,
        episode=episode,
        cr_id=cr_id,
        service_type=service_type,
        intervention_codes=codes,
        consent_method="BIOMETRIC",
        authorization_guid=str(body.get("guid") or "")[:64],
        authorization_token=str(body.get("token") or "")[:64],
        authorization_state=str(body.get("status") or "PENDING")[:32],
        # VERIFY: the guide says the response "includes an iframe link" without
        # naming the field; shaVerificationRequest.requestUrl is the only
        # URL-valued field on the published response schema.
        biometric_capture_url=str(verification.get("requestUrl") or "")[:1000],
        opened_by=user,
    )
    _visit_history(visit, "PENDING", user, "Fingerprint consent requested")
    visit.save(update_fields=["status_history"])
    return visit


def _fetch_authorization(visit):
    body = _call(
        "GET",
        "/claims/authorizations",
        transaction_type="CLAIM_CONSENT",
        branch=visit.branch,
        organization_id=visit.organization_id,
        params={"guid": visit.authorization_guid},
    )
    if isinstance(body, list):
        body = body[0] if body else {}
    if isinstance(body, dict) and isinstance(body.get("results"), list):
        body = body["results"][0] if body["results"] else {}
    return body if isinstance(body, dict) else {}


@transaction.atomic
def refresh_biometric_consent(visit, user):
    """Poll the authorisation; once AUTHORIZED, open the visit with auth_guid."""
    visit = ShaVisit.objects.select_for_update().get(pk=visit.pk)
    if visit.status != ShaVisit.STATUS_AWAITING_CONSENT or visit.consent_method != "BIOMETRIC":
        return visit
    record = _fetch_authorization(visit)
    state = str(record.get("status") or "")
    reason = str(record.get("authorizationReason") or "")
    if state:
        visit.authorization_state = state[:32]
    if reason:
        visit.authorization_reason = reason[:64]
    if state in AUTHORIZED_STATES:
        body = _call(
            "POST",
            "/claims/visit",
            transaction_type="CLAIM_VISIT",
            branch=visit.branch,
            organization_id=visit.organization_id,
            json_body={
                "intervention_codes": visit.intervention_codes,
                "patient_id": visit.cr_id,
                "service_type": visit.service_type,
                "auth_guid": visit.authorization_guid,
                **claim_practitioner_fields(user),
            },
        )
        return _visit_from_response(visit, body or {}, user, "Visit opened with fingerprint consent")
    if state in ("REJECTED", "EXPIRED"):
        visit.status = ShaVisit.STATUS_REJECTED
        note = (
            "No usable fingerprints — SHA allows this client to consent by OTP"
            if reason == OTP_FALLBACK_REASON
            else f"Fingerprint consent {state.lower()}"
        )
        _visit_history(visit, state, user, note)
    visit.save()
    return visit


@transaction.atomic
def cancel_biometric_consent(visit, user):
    """Clear a stuck PENDING authorisation (the capture iframe lasts 10 minutes)."""
    visit = ShaVisit.objects.select_for_update().get(pk=visit.pk)
    if visit.status != ShaVisit.STATUS_AWAITING_CONSENT:
        raise ShaError("Only a pending fingerprint request can be cancelled.")
    if visit.authorization_token:
        _call(
            "POST",
            f"/claims/authorizations/{visit.authorization_token}/reject",
            transaction_type="CLAIM_CONSENT",
            branch=visit.branch,
            organization_id=visit.organization_id,
        )
    visit.status = ShaVisit.STATUS_REJECTED
    visit.authorization_state = "REJECTED"
    _visit_history(visit, "REJECTED", user, "Fingerprint request cancelled")
    visit.save()
    return visit


def request_otp_whitelist(patient, branch, user, reason_type, reason, biometric_attempts=0):
    """Ask SHA to let a client who cannot give fingerprints consent by OTP —
    e.g. MENTALLY_UNSTABLE, a published reason. SHA decides; the outcome
    shows on the next eligibility check (whitelistedForOTP)."""
    cr_id = _require_cr_id(patient)
    if reason_type not in OTP_WHITELIST_REASONS:
        raise ShaError("Choose why the client cannot use fingerprints.", field="reason_type")
    if not (reason or "").strip():
        raise ShaError("Describe the reason.", field="reason")
    body = _call(
        "POST",
        "/patients/otp-whitelists",
        transaction_type="CLAIM_CONSENT",
        branch=branch,
        organization_id=patient.organization_id,
        data={
            "beneficiary_cr_id": cr_id,
            "reason_type": reason_type,
            "reason": reason.strip()[:500],
            "biometric_attempts": str(int(biometric_attempts or 0)),
            "facility_fr_code": branch.sha_fr_code,
            "attachments": "[]",
        },
    )
    return body or {}


@transaction.atomic
def close_visit(visit, user, reason_type, reason_text):
    visit = ShaVisit.objects.select_for_update().get(pk=visit.pk)
    if visit.status not in (ShaVisit.STATUS_OPEN,):
        raise ShaError("Only an open visit can be closed.")
    if reason_type not in CLOSE_REASONS:
        raise ShaError("Choose why the visit is being closed.", field="reason_type")
    if not (reason_text or "").strip():
        raise ShaError("Describe why the visit is being closed.", field="reason_text")
    body = _call(
        "POST",
        "/claims/close",
        transaction_type="CLAIM_VISIT",
        branch=visit.branch,
        organization_id=visit.organization_id,
        json_body={
            "consent_token": visit.consent_token,
            "cancel_reason_type": reason_type,
            "cancel_reason_text": reason_text.strip()[:500],
        },
    )
    visit.status = ShaVisit.STATUS_CLOSED
    visit.closed_at = timezone.now()
    visit.close_reason = reason_type
    visit.workflow_state = str((body or {}).get("workflow_state") or "CLOSED")[:48]
    _visit_history(visit, "CLOSED", user, reason_text.strip()[:255])
    visit.save()
    return visit


# ── Billing the visit ──


def attach_visit(claim, visit, user):
    if claim.payer != "SHA":
        raise ShaError("Only an SHA claim is billed against an SHA visit.")
    if visit.patient_id != claim.patient_id:
        raise ShaError("That visit belongs to another client.", field="visit")
    if visit.status != ShaVisit.STATUS_OPEN:
        raise ShaError("The SHA visit is not open — the client's consent is needed first.", field="visit")
    if InsuranceClaim.objects.filter(sha_visit=visit).exclude(pk=claim.pk).exists():
        raise ShaError("Another claim is already billed against this visit.", field="visit")
    claim.sha_visit = visit
    _claim_history(claim, claim.status, user, f"Billed against SHA visit {visit.consent_token}")
    claim.save(update_fields=["sha_visit", "status_history", "updated_at"])
    return claim


def _primary_intervention(visit):
    return visit.intervention_codes[0] if visit.intervention_codes else ""


def sync_claim(claim, user):
    """
    Push what is not yet on the HIE claim: lines (each added once, remembered
    by GUID), coded diagnoses, and labelled attachments. Safe to call again —
    every item records that it was sent.
    """
    from apps.clinical_encounter.models import DiagnosisCode

    visit = claim.sha_visit
    if visit is None or visit.status != ShaVisit.STATUS_OPEN:
        raise ShaError("Bill this claim against an open SHA visit first.", field="visit")
    if claim.status not in ("DRAFT", "RETURNED"):
        raise ShaError("Only a draft or returned claim can be changed.", field="status")
    practitioner = claim_practitioner_fields(user)
    branch, org = visit.branch, claim.organization_id
    sent = {"lines": 0, "diagnoses": 0, "attachments": 0}

    for line in claim.lines.filter(sha_line_guid=""):
        code = line.payer_code or _primary_intervention(visit)
        if code not in visit.intervention_codes:
            raise ShaError(
                f"{line.service_name} is mapped to {code or 'no SHA intervention'}, which is not "
                "on this visit. Map the service to one of the visit's interventions or add the "
                "intervention to the visit.",
                field="lines",
            )
        body = _call(
            "POST",
            "/claims/lines",
            transaction_type="E_CLAIM",
            branch=branch,
            organization_id=org,
            json_body={
                "consent_token": visit.consent_token,
                "intervention_code": code,
                "unit_price": str(line.unit_price),
                "quantity": str(line.quantity),
                "service_name": line.service_name[:150],
                "service_identifier": str(line.charge_item_id),
                **practitioner,
            },
        )
        line.sha_line_guid = str((body or {}).get("id") or "")[:64] or "added"
        line.save(update_fields=["sha_line_guid", "updated_at"])
        sent["lines"] += 1

    codes = [
        d.icd11_code_id
        for d in DiagnosisCode.objects.filter(encounter__patient=claim.patient, status="ACTIVE")
        .exclude(verification_status="RULED_OUT")
        .order_by("-is_primary", "-noted_at")
    ]
    already = set(claim.sha_diagnoses or [])
    for icd in codes:
        if icd in already:
            continue
        for intervention in visit.intervention_codes:
            _call(
                "POST",
                "/claims/diagnoses",
                transaction_type="E_CLAIM",
                branch=branch,
                organization_id=org,
                json_body={
                    "consent_token": visit.consent_token,
                    "icd_code": icd,
                    "intervention_code": intervention,
                    **practitioner,
                },
            )
        already.add(icd)
        sent["diagnoses"] += 1
    claim.sha_diagnoses = sorted(already)
    claim.save(update_fields=["sha_diagnoses", "updated_at"])

    for attachment in claim.attachments.filter(sha_attachment_id="").select_related("file"):
        if attachment.category in ATTACHMENT_EXCLUDED_CATEGORIES:
            continue
        if attachment.file is None or not attachment.sha_document_type:
            continue
        attachment.file.file.open("rb")
        try:
            content = attachment.file.file.read()
        finally:
            attachment.file.file.close()
        body = _call(
            "POST",
            "/claims/attachments",
            transaction_type="E_CLAIM",
            branch=branch,
            organization_id=org,
            data={
                "consent_token": visit.consent_token,
                "document_type": attachment.sha_document_type,
                "intervention_code": attachment.intervention_code or _primary_intervention(visit),
            },
            files={"file_blob": (attachment.file.file.name.rsplit("/", 1)[-1], content)},
        )
        attachment.sha_attachment_id = str((body or {}).get("id") or "")[:64] or "added"
        attachment.save(update_fields=["sha_attachment_id", "updated_at"])
        sent["attachments"] += 1
    return sent


def remove_attachment(claim, attachment):
    visit = claim.sha_visit
    _call(
        "PATCH",
        "/claims/attachments",
        transaction_type="E_CLAIM",
        branch=visit.branch,
        organization_id=claim.organization_id,
        json_body={
            "attachment_id": attachment.sha_attachment_id,
            "consent_token": visit.consent_token,
            "intervention_code": attachment.intervention_code or _primary_intervention(visit),
        },
    )


def missing_documents(claim):
    """Document types the visit's interventions require that no attachment carries."""
    visit = claim.sha_visit
    if visit is None:
        return []
    required = set()
    for intervention in ShaIntervention.objects.filter(code__in=visit.intervention_codes):
        required.update(intervention.applicable_document_types or [])
    have = set(
        claim.attachments.exclude(file__isnull=True)
        .exclude(sha_document_type="")
        .values_list("sha_document_type", flat=True)
    )
    return sorted(required - have)


def preview_claim(claim):
    visit = claim.sha_visit
    if visit is None:
        raise ShaError("This claim has no SHA visit.")
    return _call(
        "POST",
        "/claims/preview",
        transaction_type="E_CLAIM",
        branch=visit.branch,
        organization_id=claim.organization_id,
        json_body={"consent_token": visit.consent_token},
    )


def send_discharge_otp(claim):
    visit = claim.sha_visit
    if visit is None or visit.status != ShaVisit.STATUS_OPEN:
        raise ShaError("This claim has no open SHA visit.")
    body = _call(
        "POST",
        "/claims/otp/discharge",
        transaction_type="CLAIM_CONSENT",
        branch=visit.branch,
        organization_id=claim.organization_id,
        json_body={"consent_token": visit.consent_token, "patient_id": visit.cr_id},
    )
    return (body or {}).get("message", "The discharge OTP has been sent to the client.")


def dispatch_request(claim, *, discharge_reason, otp="", discharge_auth_guid="",
                     discharge_status="FULL", notes="", discharge_date=None):
    """(path, payload) for dispatching the visit's claim — validated with no
    network call, so a missing OTP is caught before anything is pushed.
    Outpatient/capitation/emergency → /claims/submit; inpatient →
    /claims/discharge. `claim_number` is the invoice_number, so a resend after
    a timeout names the same claim."""
    visit = claim.sha_visit
    if visit is None or visit.status != ShaVisit.STATUS_OPEN:
        raise ShaError("Bill this claim against an open SHA visit first.", field="sha_visit")
    otp = (otp or "").strip()
    discharge_auth_guid = (discharge_auth_guid or "").strip()
    if visit.service_type == "INPATIENT":
        if discharge_reason not in INPATIENT_DISCHARGE_REASONS:
            raise ShaError("Choose the discharge reason.", field="discharge_reason")
        payload = {
            "consent_token": visit.consent_token,
            "invoice_number": claim.claim_number,
            "discharge_reason": discharge_reason,
            "discharge_date": (discharge_date or timezone.now()).isoformat(),
        }
        path = "/claims/discharge"
    else:
        if discharge_reason not in OUTPATIENT_DISCHARGE_REASONS:
            raise ShaError("Choose the discharge reason.", field="discharge_reason")
        if discharge_status not in ("PARTIAL", "FULL"):
            raise ShaError("Choose a full or partial discharge.", field="discharge_status")
        payload = {
            "consent_token": visit.consent_token,
            "invoice_number": claim.claim_number,
            "discharge_reason": discharge_reason,
            "discharge_status": discharge_status,
        }
        if notes.strip():
            payload["notes"] = notes.strip()[:500]
        path = "/claims/submit"
    if discharge_auth_guid:
        payload["discharge_auth_guid"] = discharge_auth_guid
    elif otp:
        payload["otp"] = otp
    else:
        raise ShaError(
            "Enter the discharge OTP the client received (or the fingerprint discharge "
            "authorisation).",
            field="otp",
        )
    return path, payload


def dispatch(claim, user, request):
    """Send a validated dispatch_request() and record the visit as submitted."""
    path, payload = request
    visit = claim.sha_visit
    body = hie_api_call_retry_safe(
        "POST", path, visit=visit, organization_id=claim.organization_id, json_body=payload
    )
    visit.status = ShaVisit.STATUS_SUBMITTED
    visit.discharge_status = payload.get("discharge_status", "FULL")
    visit.workflow_state = str((body or {}).get("workflow_state") or "SUBMITTED")[:48]
    visit.claim_guid = str((body or {}).get("edi_claim_guid") or visit.claim_guid)[:64]
    _visit_history(visit, visit.workflow_state, user, "Claim submitted to SHA")
    visit.save()
    return body or {}


def hie_api_call_retry_safe(method, path, *, visit, organization_id, json_body):
    """Claim dispatch carries invoice_number (our claim_number, assigned before
    any network call), so a timed-out request may be repeated."""
    return _call(
        method,
        path,
        transaction_type="E_CLAIM",
        branch=visit.branch,
        organization_id=organization_id,
        json_body=json_body,
        retry_safe=True,
    )


def resubmit(claim, user):
    """After the payer returned the claim and it has been corrected."""
    visit = claim.sha_visit
    _call(
        "POST",
        "/claims/lines/resubmit",
        transaction_type="E_CLAIM",
        branch=visit.branch,
        organization_id=claim.organization_id,
        json_body={"consent_token": visit.consent_token},
    )
    claim.status = "UNDER_REVIEW"
    _claim_history(claim, "UNDER_REVIEW", user, "Corrected and resubmitted to SHA")
    claim.save(update_fields=["status", "status_history", "updated_at"])
    return claim


def apply_payer_state(claim, state, user=None, note=""):
    """Record an HIE claim state on the claim. Returns True when it changed."""
    if not state:
        return False
    visit = claim.sha_visit
    changed = False
    if visit is not None and visit.payer_workflow_state != state:
        visit.payer_workflow_state = state[:48]
        _visit_history(visit, state, user, note)
        visit.save(update_fields=["payer_workflow_state", "status_history", "updated_at"])
        changed = True
    target = PAYER_STATE_TO_STATUS.get(state)
    if target and target != claim.status and claim.status != "DRAFT":
        claim.status = target
        if target == "REJECTED":
            claim.approved_amount = 0
        if target in InsuranceClaim.ADJUDICATED_STATUSES:
            claim.adjudicated_at = timezone.now()
        _claim_history(claim, target, user, f"SHA: {state}" + (f" — {note}" if note else ""))
        claim.save()
        changed = True
    return changed


def refresh_payer_status(claim, user=None):
    visit = claim.sha_visit
    if visit is None:
        raise ShaError("This claim has no SHA visit.")
    body = _call(
        "GET",
        "/claims/preview/payer",
        transaction_type="E_CLAIM",
        branch=visit.branch,
        organization_id=claim.organization_id,
        params={"provider_claim_no": claim.claim_number},
    )
    results = (body.get("results") or []) if isinstance(body, dict) else []
    if not results:
        return claim
    payer = results[0]
    apply_payer_state(claim, str(payer.get("workflowState") or ""), user, "")
    return claim


# ── Pre-authorisation ──


@transaction.atomic
def create_preauth(claim, line, user, *, service_start, service_end, notification_email):
    visit = claim.sha_visit
    if visit is None or visit.status != ShaVisit.STATUS_OPEN:
        raise ShaError("Open the SHA visit before requesting pre-authorisation.", field="visit")
    code = line.payer_code
    if not code:
        raise ShaError("Map this service to an SHA intervention first.", field="payer_code")
    doctor = claim_practitioner_fields(user)
    if not doctor:
        raise ShaError(
            "SHA pre-authorisation names the treating doctor: your registration must be checked "
            "against the Health Worker Registry first (Staff → Practitioner credential).",
            field="doctor",
        )
    if not (notification_email or "").strip():
        raise ShaError("Enter the email SHA notifies about this request.", field="notification_email")
    from apps.clinical_encounter.models import DiagnosisCode

    diagnoses = [
        {"consent_token": visit.consent_token, "icd_code": d.icd11_code_id}
        for d in DiagnosisCode.objects.filter(encounter__patient=claim.patient, status="ACTIVE")
        .exclude(verification_status="RULED_OUT")
        .order_by("-is_primary", "-noted_at")
    ]
    if not diagnoses:
        raise ShaError("Record the coded (ICD-11) diagnosis first.", field="diagnosis")
    attachments, files = [], {}
    for index, attachment in enumerate(
        claim.attachments.exclude(file__isnull=True).exclude(sha_document_type="")
    ):
        if attachment.category in ATTACHMENT_EXCLUDED_CATEGORIES:
            continue
        field_name = f"attachment_{index}"
        attachment.file.file.open("rb")
        try:
            files[field_name] = (
                attachment.file.file.name.rsplit("/", 1)[-1],
                attachment.file.file.read(),
            )
        finally:
            attachment.file.file.close()
        attachments.append(
            {
                "document_title": attachment.get_category_display(),
                "document_type": attachment.sha_document_type,
                "file_field_name": field_name,
            }
        )
    data = {
        "consent_token": visit.consent_token,
        "intervention_code": code,
        "service_start": service_start,
        "service_end": service_end,
        "items": json.dumps([{"unit_price": str(line.unit_price)} for _ in range(line.quantity)]),
        "diagnoses": json.dumps(diagnoses),
        "doctors": json.dumps(
            [
                {
                    "identification_number": doctor["practitioner_identification_number"],
                    "identification_type": doctor["practitioner_identification_type"],
                    "regulation_body": doctor["practitioner_regulation_body"],
                    "intervention_code": code,
                    "is_primary": True,
                }
            ]
        ),
        "attachments": json.dumps(attachments),
        "provider_notification_email": notification_email.strip(),
    }
    body = _call(
        "POST",
        "/preauths",
        transaction_type="PRE_AUTHORIZATION",
        branch=visit.branch,
        organization_id=claim.organization_id,
        data=data,
        files=files or None,
    )
    body = body or {}
    state = str(body.get("status") or "ACTIVE")
    pre_auth = PreAuthorization.objects.create(
        organization=claim.organization,
        patient=claim.patient,
        service=line.charge_item.service,
        requested_by=user,
        intervention_code=code,
        sha_state=state[:48],
        sha_guid=str(body.get("guid") or "")[:64],
        sha_reference=str(body.get("id") or "")[:100],
        status=PREAUTH_STATE_TO_STATUS.get(state, "SUBMITTED"),
        submitted_at=timezone.now(),
    )
    line.pre_authorization = pre_auth
    line.save(update_fields=["pre_authorization", "updated_at"])
    return pre_auth


def apply_preauth_state(pre_auth, state, note=""):
    if not state or state == pre_auth.sha_state:
        return False
    pre_auth.sha_state = state[:48]
    status = PREAUTH_STATE_TO_STATUS.get(state)
    if status and status != pre_auth.status:
        pre_auth.status = status
        if status in ("APPROVED", "REJECTED"):
            pre_auth.decided_at = timezone.now()
    if note:
        pre_auth.decision_note = note[:255]
    pre_auth.save()
    return True


def refresh_preauth(pre_auth, visit):
    body = _call(
        "GET",
        "/preauths",
        transaction_type="PRE_AUTHORIZATION",
        branch=visit.branch,
        organization_id=pre_auth.organization_id,
        params={"consent_token": visit.consent_token},
    )
    if isinstance(body, list):
        items = body
    elif isinstance(body, dict):
        items = body.get("results") or [body]
    else:
        items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("interventionCode") in ("", None, pre_auth.intervention_code):
            apply_preauth_state(pre_auth, str(item.get("status") or ""))
            if item.get("guid") and not pre_auth.sha_guid:
                pre_auth.sha_guid = str(item["guid"])[:64]
                pre_auth.save(update_fields=["sha_guid", "updated_at"])
            break
    return pre_auth


# ── Read model ──


def visit_data(visit):
    if visit is None:
        return None
    interventions = {
        i.code: i for i in ShaIntervention.objects.filter(code__in=visit.intervention_codes)
    }
    return {
        "id": str(visit.id),
        "branch": {"id": str(visit.branch_id), "name": visit.branch.name, "fr_code": visit.branch.sha_fr_code},
        "cr_id": visit.cr_id,
        "service_type": visit.service_type,
        "consent_method": visit.consent_method,
        "status": visit.status,
        "status_label": visit.get_status_display(),
        "intervention_codes": visit.intervention_codes,
        "interventions": [
            {
                "code": code,
                "name": interventions[code].name if code in interventions else "",
                "needs_preauth": interventions[code].needs_preauth if code in interventions else None,
                "payment_mechanism": interventions[code].payment_mechanism
                if code in interventions
                else "",
                "applicable_document_types": interventions[code].applicable_document_types
                if code in interventions
                else [],
            }
            for code in visit.intervention_codes
        ],
        "authorization_state": visit.authorization_state,
        "authorization_reason": visit.authorization_reason,
        "otp_fallback_allowed": visit.authorization_reason == OTP_FALLBACK_REASON,
        "biometric_capture_url": visit.biometric_capture_url
        if visit.status == ShaVisit.STATUS_AWAITING_CONSENT
        else "",
        "consent_token": visit.consent_token,
        "workflow_state": visit.workflow_state,
        "payer_workflow_state": visit.payer_workflow_state,
        "opened_at": visit.opened_at.isoformat() if visit.opened_at else None,
        "closed_at": visit.closed_at.isoformat() if visit.closed_at else None,
        "status_history": visit.status_history or [],
    }


def patient_visits(patient):
    return ShaVisit.objects.filter(patient=patient).select_related("branch").order_by("-created_at")


def identifiers_for_display(patient):
    return list(
        patient.identifiers.filter(
            kind__in=[PatientIdentifier.KIND_CLIENT_REGISTRY, PatientIdentifier.KIND_SHA],
            superseded_at__isnull=True,
        ).values("kind", "value", "verified_at", "verified_by_source")
    )
