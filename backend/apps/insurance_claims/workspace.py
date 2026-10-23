"""Client record → Billing stage: claims, pre-authorisation, invoice and
payments (v4 mockup stageBilling / billingExtras).

FHIR R4 mapping (no export is built here; this is the internal model):
- documented delivered service → ChargeItem (care_pathway.ChargeItem)
- payer claim → Claim (InsuranceClaim + ClaimLine as Claim.item); payer
  decision → ClaimResponse
- per-line pre-authorisation → Claim (use=preauthorization) / ClaimResponse
- invoice → Invoice (billing.Invoice, lineItem.chargeItemReference)
- payments → PaymentReconciliation / PaymentNotice (billing.Payment;
  insurer remittance also kept as insurance_claims.Remittance)

Rules carried from the mockup and CLAUDE.md:
- Lines come only from priced, non-voided ChargeItems; rates are the tariff
  snapshot on the charge, never a value held here.
- Payer codes come only from ServicePayerCode (for SHA, the facility's map
  from its tariff service to an SHA intervention code). Unconfigured → blank
  code, shown as "Payer code not configured — VERIFY". No payer code is ever
  invented. For SHA the pre-authorisation requirement is SHA's own live
  `needsPreauth` flag for the intervention (ShaIntervention), not a typed one.
- SHA claims are billed against a consented SHA visit and dispatched through
  the DHA HIE (apps.insurance_claims.sha_claims); SHA's decisions arrive by
  status callback or a status refresh — they are never typed in. Other payers
  have no connection: their submission and decision are recorded by finance.
- Package ceilings and emergency-fund routing are NOT applied here: SHA rules
  them on its side, and no source exists for other payers.
- PSYCHOTHERAPY_NOTES and TRAUMA_HISTORY are never claim attachments.
- `claim_number` / invoice `number` are assigned before any network call.
"""

import csv
import io
import uuid
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from apps.billing.models import Invoice, InvoiceLine, Payment
from apps.billing.permissions import is_finance
from apps.care_pathway.models import ChargeItem
from apps.client_registry.models import Patient, PatientIdentifier
from apps.clinical_encounter.models import DiagnosisCode
from apps.tenancy.models import Branch

from . import sha_claims
from .models import (
    ATTACHMENT_DEFAULT_CATEGORIES,
    ATTACHMENT_EXCLUDED_CATEGORIES,
    ClaimAttachment,
    ClaimLine,
    InsuranceClaim,
    PreAuthorization,
    Remittance,
    ServicePayerCode,
    ShaIntervention,
    ShaVisit,
)
from .sha_eligibility import ShaError

ZERO = Decimal("0")
TIMELINE = ["Draft", "Submitted", "With payer", "Adjudicated"]
# Patient.payer → the payer a claim is addressed to. SHA + private insurer
# claims SHA first; a secondary claim is not modelled (VERIFY coordination of
# benefits with the facility before adding one).
CLAIMABLE_PAYER = {"SHA": "SHA", "SHA_PRIVATE": "SHA", "PRIVATE": "PRIVATE", "EMPLOYER": "EMPLOYER"}
PAYMENT_METHODS = {
    "INSURANCE": "Insurer remittance",
    "MPESA": "M-Pesa",
    "CASH": "Cash",
    "CARD": "Card",
}
PAYER_STATUS_CHOICES = ("UNDER_REVIEW", "RETURNED", "APPROVED", "PARTIALLY_APPROVED", "REJECTED")
PREAUTH_DECISIONS = ("APPROVED", "PARTIALLY_APPROVED", "REJECTED")
APPROVED_PREAUTH = ("APPROVED", "PARTIALLY_APPROVED")


class BillingError(Exception):
    """A refused finance action; `field` names what the user must fix."""

    def __init__(self, message, field=None):
        self.message = message
        self.field = field
        super().__init__(message)


def _money(value):
    return str((value or ZERO).quantize(Decimal("0.01")))


def _user_label(user):
    if not user:
        return ""
    return user.get_full_name() if hasattr(user, "get_full_name") else str(user)


def _history(claim, status, user, note=""):
    claim.status_history = list(claim.status_history or []) + [
        {"status": status, "at": timezone.now().isoformat(), "by": _user_label(user), "note": note}
    ]


def timeline_stage(claim):
    if claim.status == "DRAFT":
        return 0
    if claim.status == "SUBMITTED":
        return 1
    if claim.status in ("UNDER_REVIEW", "RETURNED"):
        return 2
    return 3


def is_sha(claim):
    return claim.payer == "SHA"


# ── Charges and payer configuration ──


def billable_charges(patient):
    """Priced, non-voided documented services, oldest first."""
    return list(
        ChargeItem.objects.filter(patient=patient, voided_at__isnull=True, unit_price__isnull=False)
        .select_related("service")
        .order_by("delivered_at")
    )


def _claimed_charge_ids(patient):
    """Charges already on a claim that still stands (rejected claims release theirs)."""
    return set(
        ClaimLine.objects.filter(claim__patient=patient)
        .exclude(claim__status="REJECTED")
        .values_list("charge_item_id", flat=True)
    )


def claim_payer(patient):
    return CLAIMABLE_PAYER.get(patient.payer or "")


def _payer_codes(service_ids, payer):
    if not payer:
        return {}
    return {
        c.service_id: c
        for c in ServicePayerCode.objects.filter(
            service_id__in=service_ids, payer=payer, active=True
        )
    }


def _requires_preauth(code, payer):
    """For SHA, SHA's own needsPreauth flag for the intervention once it has been
    read from the HIE; None (unknown) until then. Other payers: as configured."""
    if code is None:
        return None
    if payer == "SHA":
        intervention = ShaIntervention.objects.filter(code=code.payer_code).first()
        return intervention.needs_preauth if intervention else None
    return code.requires_preauth


# ── Finance review checklist ──


def _primary_diagnosis(patient):
    return (
        DiagnosisCode.objects.filter(encounter__patient=patient, status="ACTIVE")
        .exclude(verification_status="RULED_OUT")
        .select_related("icd11_code")
        .order_by("-is_primary", "-noted_at")
        .first()
    )


def _identity_verified(patient):
    if patient.identity_status != Patient.IDENTITY_IDENTIFIED:
        return False
    return PatientIdentifier.objects.filter(
        patient=patient, verified_at__isnull=False, superseded_at__isnull=True
    ).exists()


def sha_facility(claim):
    """
    (branch, problem) for an SHA claim: the branch the claimed care was
    delivered at, which supplies the facility FR code SHA requires. Taken
    from each line's episode and the claim's encounter; when neither records
    a branch and the organisation has exactly one active branch, that one.
    `problem` is why the claim can't carry an FR code, else "".
    """
    branches = {
        line.charge_item.episode.branch
        for line in claim.lines.select_related("charge_item__episode__branch")
        if line.charge_item.episode_id and line.charge_item.episode.branch_id
    }
    if claim.encounter_id and claim.encounter.branch_id:
        branches.add(claim.encounter.branch)
    if not branches:
        active = list(
            Branch.objects.filter(organization_id=claim.organization_id, is_active=True)[:2]
        )
        if len(active) == 1:
            branches = set(active)
    if not branches:
        return None, "The branch this care was delivered at isn't recorded on the claim"
    if len(branches) > 1:
        names = ", ".join(sorted(b.name for b in branches))
        return None, f"Lines span more than one branch ({names}) — claim each facility separately"
    branch = branches.pop()
    if not branch.sha_fr_code:
        return branch, (
            f"{branch.name} has no SHA FR code — an Org Admin adds it in Branch Settings"
        )
    return branch, ""


def balance_after_claim(patient, claim):
    """What the client/guarantor would owe if this draft claim were submitted."""
    from apps.care_pathway.services import billing_overview

    overview = billing_overview(patient)
    unbilled = sum((Decimal(e["unbilled_balance"]) for e in overview["events"]), ZERO)
    on_claim = (
        sum((line.amount for line in claim.lines.all()), ZERO) if claim.status == "DRAFT" else ZERO
    )
    return max(ZERO, unbilled - on_claim)


def checklist(claim):
    patient = claim.patient
    lines = list(claim.lines.select_related("pre_authorization", "charge_item"))
    dx = _primary_diagnosis(patient)
    held = [
        line.service_name
        for line in lines
        if line.requires_preauth
        and not (line.pre_authorization and line.pre_authorization.status in APPROVED_PREAUTH)
    ]
    balance = balance_after_claim(patient, claim)
    facility = []
    if claim.payer == "SHA":
        branch, problem = sha_facility(claim)
        facility.append(
            {
                "key": "facility",
                "label": "Facility SHA FR code on file",
                "ok": not problem,
                "detail": problem or f"{branch.name} · FR code {branch.sha_fr_code}",
            }
        )
        visit = claim.sha_visit
        facility.append(
            {
                "key": "sha_visit",
                "label": "SHA visit opened with the client's consent",
                "ok": visit is not None and visit.status == ShaVisit.STATUS_OPEN,
                "detail": (
                    f"{visit.get_consent_method_display()} consent · {', '.join(visit.intervention_codes)}"
                    if visit is not None and visit.status == ShaVisit.STATUS_OPEN
                    else "Open the SHA visit while the client is present (OTP or fingerprint)"
                ),
            }
        )
        missing = sha_claims.missing_documents(claim)
        facility.append(
            {
                "key": "sha_documents",
                "label": "Documents SHA requires for the intervention",
                "ok": not missing,
                "detail": ("Missing: " + ", ".join(missing)) if missing else "All attached",
            }
        )
    mismatched = [
        line.service_name
        for line in lines
        if line.charge_item.voided_at is not None
        or line.charge_item.unit_price != line.unit_price
        or line.charge_item.quantity != line.quantity
    ]
    return [
        {
            "key": "diagnosis",
            "label": "Diagnosis coded (ICD-11)",
            "ok": dx is not None,
            "detail": (
                f"ICD-11 {dx.icd11_code_id}"
                if dx
                else "None recorded — a clinician records it at intake"
            ),
        },
        {
            "key": "preauth",
            "label": "Pre-authorisation approved where required",
            "ok": not held,
            "detail": ("Awaiting: " + ", ".join(held)) if held else "No line is held",
        },
        {
            "key": "guarantor",
            "label": "Guarantor recorded for any balance",
            "ok": balance <= 0 or bool(claim.guarantor.strip()),
            "detail": f"Client / guarantor balance {_money(balance)}",
        },
        {
            "key": "identity",
            "label": "Identity verified",
            "ok": _identity_verified(patient),
            "detail": "A registry-verified identifier is on file"
            if _identity_verified(patient)
            else "No verified identifier — resolve at registration",
        },
        {
            "key": "lines",
            "label": "Lines match documented care",
            "ok": bool(lines) and not mismatched,
            "detail": (
                "No lines on the claim"
                if not lines
                else ("Changed since added: " + ", ".join(mismatched))
                if mismatched
                else f"{len(lines)} line(s) from documented, priced services"
            ),
        },
        *facility,
    ]


# ── Claims ──


def _recalculate(claim):
    claim.total_claimed_amount = sum((line.amount for line in claim.lines.all()), ZERO)
    claim.save(update_fields=["total_claimed_amount", "updated_at"])


@transaction.atomic
def create_claim(user, patient, charge_ids=None):
    """Draft a claim from the client's unclaimed, priced charges. Conditional:
    an existing draft for this client is extended rather than duplicated."""
    payer = claim_payer(patient)
    if not payer:
        raise BillingError(
            f"This client's payer is “{patient.get_payer_display() or 'not recorded'}” — there "
            "is no payer to claim from. Use the invoice and payments instead.",
            field="payer",
        )
    claimed = _claimed_charge_ids(patient)
    charges = [c for c in billable_charges(patient) if c.id not in claimed]
    if charge_ids is not None:
        wanted = {str(c) for c in charge_ids}
        charges = [c for c in charges if str(c.id) in wanted]
    if not charges:
        raise BillingError("There are no unclaimed, priced services to claim.", field="lines")

    claim = (
        InsuranceClaim.objects.select_for_update()
        .filter(patient=patient, status="DRAFT")
        .exclude(claim_number="")
        .first()
    )
    if claim is None:
        claim = InsuranceClaim.objects.create(
            organization=patient.organization,
            patient=patient,
            payer=payer,
            claim_number=f"CLM-{timezone.now():%Y%m%d}-{uuid.uuid4().hex[:8].upper()}",
            created_by=user,
        )
        _history(claim, "DRAFT", user, "Claim created from documented services")
        for category in ATTACHMENT_DEFAULT_CATEGORIES:
            ClaimAttachment.objects.create(
                organization=claim.organization, claim=claim, category=category, added_by=user
            )
    codes = _payer_codes({c.service_id for c in charges}, claim.payer)
    for charge in charges:
        code = codes.get(charge.service_id)
        ClaimLine.objects.create(
            organization=claim.organization,
            claim=claim,
            charge_item=charge,
            service_name=charge.service.name,
            quantity=charge.quantity,
            unit_price=charge.unit_price,
            payer_code=code.payer_code if code else "",
            requires_preauth=_requires_preauth(code, claim.payer),
        )
    _recalculate(claim)
    claim.save(update_fields=["status_history"])
    return claim


def _draft(claim):
    if claim.status != "DRAFT":
        raise BillingError("Only a draft claim can be changed.", field="status")


def update_draft(user, claim, guarantor):
    _draft(claim)
    claim.guarantor = (guarantor or "").strip()[:255]
    claim.save(update_fields=["guarantor", "updated_at"])
    return claim


@transaction.atomic
def remove_line(user, claim, line):
    _draft(claim)
    name = line.service_name
    line.delete()
    _recalculate(claim)
    _history(claim, "DRAFT", user, f"Line removed: {name}")
    claim.save(update_fields=["status_history"])
    return claim


def _review(user, claim, lines_checked):
    """Run the finance review on a locked draft and snapshot it (within the
    caller's transaction). Raises BillingError listing what is incomplete."""
    _draft(claim)
    items = checklist(claim)
    failing = [i for i in items if not i["ok"]]
    if not lines_checked:
        failing.append(
            {
                "key": "lines_checked",
                "label": "Confirm you have checked every line against documented care",
            }
        )
    if failing:
        raise BillingError(
            "Finance review is incomplete: " + "; ".join(i["label"] for i in failing),
            field=failing[0]["key"],
        )
    if not claim.claim_number:
        claim.claim_number = f"CLM-{timezone.now():%Y%m%d}-{uuid.uuid4().hex[:8].upper()}"
    # Codes only — no diagnosis narrative leaves the record on a claim.
    claim.diagnoses_snapshot = [
        {"system": "ICD-11", "code": d.icd11_code_id, "is_primary": d.is_primary}
        for d in DiagnosisCode.objects.filter(encounter__patient=claim.patient, status="ACTIVE")
        .exclude(verification_status="RULED_OUT")
        .order_by("-is_primary", "-noted_at")
    ]
    claim.checklist_snapshot = items
    claim.lines_checked_by = user
    claim.lines_checked_at = timezone.now()


def _mark_submitted(user, claim, note):
    claim.status = "SUBMITTED"
    claim.submitted_at = timezone.now()
    claim.submitted_by = user
    _history(claim, "SUBMITTED", user, note)
    claim.save()


def submit_claim(user, claim, lines_checked, dispatch=None):
    """
    Finance review, then:
    - SHA → push lines, diagnoses and documents to the consented visit and
      dispatch it through the HIE. These are network side effects a database
      rollback cannot undo, so they run outside any transaction and each push
      is recorded as it is accepted; `dispatch` (discharge reason, the client's
      discharge OTP or fingerprint discharge authorisation) is validated
      before anything is pushed.
    - other payers → recorded as sent through the payer's own channel.
    """
    if not is_sha(claim):
        with transaction.atomic():
            claim = InsuranceClaim.objects.select_for_update().get(pk=claim.pk)
            _review(user, claim, lines_checked)
            _mark_submitted(
                user,
                claim,
                "Recorded as submitted — CITRAMAC has no connection to this payer; send the "
                "claim through the payer's own channel",
            )
        return claim

    with transaction.atomic():
        claim = InsuranceClaim.objects.select_for_update().get(pk=claim.pk)
        _review(user, claim, lines_checked)
        claim.save()
    dispatch = dispatch or {}
    try:
        request = sha_claims.dispatch_request(
            claim,
            discharge_reason=dispatch.get("discharge_reason", ""),
            otp=dispatch.get("otp", ""),
            discharge_auth_guid=dispatch.get("discharge_auth_guid", ""),
            discharge_status=dispatch.get("discharge_status") or "FULL",
            notes=dispatch.get("notes", ""),
        )
        sha_claims.sync_claim(claim, user)
        body = sha_claims.dispatch(claim, user, request)
    except ShaError as exc:
        # Refused or unreachable: the claim is not marked submitted. Lines and
        # documents already accepted by the HIE stay recorded as sent.
        raise BillingError(
            f"SHA did not accept the submission — the claim stays a draft "
            f"({claim.claim_number}) and can be resubmitted. {exc.message}",
            field=exc.field or "gateway",
        ) from None
    with transaction.atomic():
        claim = InsuranceClaim.objects.select_for_update().get(pk=claim.pk)
        claim.sha_reference = str(body.get("edi_claim_guid") or claim.sha_visit.claim_guid)[:100]
        _mark_submitted(user, claim, "Submitted to SHA through the DHA HIE")
    return claim


def record_payer_status(user, claim, status, approved_amount=None, note=""):
    if is_sha(claim) and claim.sha_visit_id:
        raise BillingError(
            "SHA posts its own decision on this claim — use “Refresh from SHA”; it is never "
            "typed in.",
            field="status",
        )
    if status not in PAYER_STATUS_CHOICES:
        raise BillingError("Choose a payer status.", field="status")
    if claim.status == "DRAFT":
        raise BillingError(
            "Submit the claim before recording the payer's response.", field="status"
        )
    if claim.status in InsuranceClaim.ADJUDICATED_STATUSES:
        raise BillingError("This claim is already adjudicated.", field="status")
    if status == "UNDER_REVIEW" and claim.status != "SUBMITTED":
        raise BillingError("The claim is already with the payer.", field="status")
    if status in ("APPROVED", "PARTIALLY_APPROVED"):
        try:
            amount = Decimal(str(approved_amount))
        except (InvalidOperation, TypeError):
            raise BillingError(
                "Enter the amount the payer approved.", field="approved_amount"
            ) from None
        if amount < 0 or amount > claim.total_claimed_amount:
            raise BillingError(
                "The approved amount must be between 0 and the claimed total.",
                field="approved_amount",
            )
        claim.approved_amount = amount
    elif status == "REJECTED":
        claim.approved_amount = ZERO
    claim.status = status
    if status in InsuranceClaim.ADJUDICATED_STATUSES:
        claim.adjudicated_at = timezone.now()
    _history(claim, status, user, (note or "").strip()[:255])
    claim.save()
    return claim


# ── Pre-authorisation ──


@transaction.atomic
def request_preauth(user, claim, line, data=None):
    _draft(claim)
    if is_sha(claim):
        data = data or {}
        if line.requires_preauth is not True:
            raise BillingError(
                "SHA does not require pre-authorisation for this intervention.", field="preauth"
            )
        current = line.pre_authorization
        if current and current.status in ("SUBMITTED", "APPROVED", "PARTIALLY_APPROVED"):
            raise BillingError("Pre-authorisation has already been requested for this line.")
        try:
            return sha_claims.create_preauth(
                claim,
                line,
                user,
                service_start=data.get("service_start") or "",
                service_end=data.get("service_end") or "",
                notification_email=data.get("notification_email") or "",
            )
        except ShaError as exc:
            raise BillingError(exc.message, field=exc.field or "gateway") from None
    if line.requires_preauth is not True:
        raise BillingError(
            "This service is not configured as needing pre-authorisation for this payer.",
            field="preauth",
        )
    current = line.pre_authorization
    if current and current.status in ("SUBMITTED", "APPROVED", "PARTIALLY_APPROVED"):
        raise BillingError("Pre-authorisation has already been requested for this line.")
    pre_auth = PreAuthorization.objects.create(
        organization=claim.organization,
        patient=claim.patient,
        service=line.charge_item.service,
        requested_by=user,
    )
    line.pre_authorization = pre_auth
    line.save(update_fields=["pre_authorization", "updated_at"])
    # No connection to this payer: the request is recorded as sent through the
    # payer's own channel and finance records the decision.
    pre_auth.status = "SUBMITTED"
    pre_auth.submitted_at = timezone.now()
    pre_auth.save(update_fields=["status", "submitted_at", "updated_at"])
    return pre_auth


def record_preauth_decision(user, pre_auth, status, approval_reference="", note=""):
    if pre_auth.intervention_code:
        # Even a manual-approval (POMSF) SHA preauth is decided by SHA's
        # reviewers and arrives as a status callback.
        raise BillingError(
            "SHA posts its own decision on this pre-authorisation — it is never typed in.",
            field="status",
        )
    if status not in PREAUTH_DECISIONS:
        raise BillingError("Choose the payer's decision.", field="status")
    if pre_auth.status != "SUBMITTED":
        raise BillingError("Only a submitted request can be decided.", field="status")
    reference = (approval_reference or "").strip()
    if status in APPROVED_PREAUTH and not reference:
        raise BillingError(
            "Enter the payer's approval number exactly as the payer issued it.",
            field="approval_reference",
        )
    pre_auth.status = status
    pre_auth.approval_reference = reference[:100]
    pre_auth.decision_note = (note or "").strip()[:255]
    pre_auth.decided_at = timezone.now()
    pre_auth.decided_by = user
    pre_auth.save()
    return pre_auth


# ── Attachments ──


def _editable_for_documents(claim):
    if claim.status == "DRAFT" or (is_sha(claim) and claim.status == "RETURNED"):
        return
    raise BillingError("Documents can be added only to a draft or returned claim.", field="status")


def add_attachment(user, claim, category, file_id=None, sha_document_type="", intervention_code=""):
    _editable_for_documents(claim)
    if category in ATTACHMENT_EXCLUDED_CATEGORIES:
        raise BillingError(
            f"{category} is never attached to a payer claim — therapy and process notes and "
            "trauma history stay in the record (minimum necessary).",
            field="category",
        )
    if category not in dict(ClaimAttachment.CATEGORY_CHOICES):
        raise BillingError("Choose a document category.", field="category")
    file = None
    if file_id:
        from apps.client_registry.models import Attachment

        file = Attachment.objects.filter(pk=file_id, patient=claim.patient).first()
        if file is None:
            raise BillingError("Choose one of this client's filed documents.", field="file")
    if sha_document_type and sha_document_type not in sha_claims.CLAIM_DOCUMENT_TYPES:
        raise BillingError("Choose an SHA document type.", field="sha_document_type")
    attachment, created = ClaimAttachment.objects.get_or_create(
        organization=claim.organization,
        claim=claim,
        category=category,
        defaults={"added_by": user},
    )
    if file is not None or sha_document_type or intervention_code:
        if attachment.sha_attachment_id:
            raise BillingError(
                "This document is already on the SHA claim; remove it there before replacing it.",
                field="file",
            )
        attachment.file = file or attachment.file
        attachment.sha_document_type = sha_document_type or attachment.sha_document_type
        attachment.intervention_code = intervention_code or attachment.intervention_code
        attachment.save()
    return attachment


def remove_attachment(user, claim, attachment):
    _editable_for_documents(claim)
    if attachment.sha_attachment_id and claim.sha_visit_id:
        try:
            sha_claims.remove_attachment(claim, attachment)
        except ShaError as exc:
            raise BillingError(exc.message, field="file") from None
    attachment.delete()


# ── Invoice and payments ──


def current_invoice(patient):
    return (
        Invoice.objects.filter(patient=patient)
        .exclude(number="")
        .exclude(status="CANCELLED")
        .order_by("-version", "-created_at")
        .first()
    )


@transaction.atomic
def issue_invoice(user, patient):
    """Generate the invoice, or re-issue it as a new version when documented
    services changed. The superseded invoice is cancelled, never edited."""
    charges = billable_charges(patient)
    if not charges:
        raise BillingError("No priced, documented services to invoice.")
    previous = current_invoice(patient)
    if previous is not None:
        previous = Invoice.objects.select_for_update().get(pk=previous.pk)
        billed = sorted(str(i) for i in previous.lines.values_list("charge_item_id", flat=True))
        if billed == sorted(str(c.id) for c in charges):
            return previous, False
    version = (previous.version + 1) if previous else 1
    stem = patient.citramac_number or str(patient.id).split("-")[0].upper()
    invoice = Invoice.objects.create(
        organization=patient.organization,
        patient=patient,
        status="PENDING_PAYMENT",
        created_by=user,
        number=f"INV-{stem}-{version:02d}",
        version=version,
        supersedes=previous,
    )
    for charge in charges:
        InvoiceLine.objects.create(
            organization=patient.organization,
            invoice=invoice,
            charge_item=charge,
            description=charge.service.name,
            quantity=charge.quantity,
            unit_price=charge.unit_price,
        )
    if previous is not None:
        previous.status = "CANCELLED"
        previous.save(update_fields=["status"])
    return invoice, True


def _outstanding(patient):
    from apps.care_pathway.services import billing_overview

    overview = billing_overview(patient)
    return sum(
        (
            Decimal(e["unbilled_balance"]) + Decimal(e["claimed_balance"])
            for e in overview["events"]
        ),
        ZERO,
    )


@transaction.atomic
def record_payment(user, patient, data):
    key = str(data.get("idempotency_key") or "").strip()[:64]
    if key:
        existing = Payment.objects.filter(idempotency_key=key).first()
        if existing is not None:
            if existing.invoice.patient_id != patient.id:
                raise BillingError("That payment key belongs to another client.")
            return existing
    method = data.get("method")
    if method not in PAYMENT_METHODS:
        raise BillingError("Choose how the payment was made.", field="method")
    try:
        amount = Decimal(str(data.get("amount")))
    except (InvalidOperation, TypeError):
        raise BillingError("Enter the amount received.", field="amount") from None
    if not amount.is_finite() or amount <= 0:
        raise BillingError("Enter the amount received.", field="amount")
    amount = amount.quantize(Decimal("0.01"))
    reference = str(data.get("reference") or "").strip()[:100]
    invoice = current_invoice(patient)
    if invoice is None:
        raise BillingError("Generate the invoice before recording a payment.", field="invoice")
    outstanding = _outstanding(patient)
    if amount > outstanding:
        raise BillingError(
            f"That is more than the outstanding balance ({_money(outstanding)}).", field="amount"
        )
    claim = None
    if method == "INSURANCE":
        claim = (
            InsuranceClaim.objects.filter(patient=patient, pk=data.get("claim"))
            .exclude(status__in=["DRAFT", "REJECTED"])
            .first()
            if data.get("claim")
            else None
        )
        if claim is None:
            raise BillingError("Choose the submitted claim this remittance pays.", field="claim")
        if not reference:
            raise BillingError("Enter the payer's remittance reference.", field="reference")
    if method == "MPESA" and not reference:
        raise BillingError("Enter the M-Pesa transaction code.", field="reference")
    payment = Payment.objects.create(
        organization=patient.organization,
        invoice=invoice,
        amount=amount,
        method=method,
        reference=reference,
        received_by=user,
        idempotency_key=key,
    )
    if claim is not None:
        Remittance.objects.create(
            organization=patient.organization,
            claim=claim,
            amount_paid=amount,
            reference=reference,
            payment=payment,
        )
    return payment


# ── Read model ──


def _claim_data(claim):
    lines = list(claim.lines.select_related("pre_authorization").order_by("created_at"))
    return {
        "id": str(claim.id),
        "claim_number": claim.claim_number,
        "payer": claim.payer,
        "status": claim.status,
        "status_label": claim.get_status_display(),
        "timeline_stage": timeline_stage(claim),
        "total_claimed_amount": _money(claim.total_claimed_amount),
        "approved_amount": _money(claim.approved_amount)
        if claim.approved_amount is not None
        else None,
        "guarantor": claim.guarantor,
        "submitted_at": claim.submitted_at.isoformat() if claim.submitted_at else None,
        "adjudicated_at": claim.adjudicated_at.isoformat() if claim.adjudicated_at else None,
        "status_history": claim.status_history or [],
        "diagnoses": claim.diagnoses_snapshot or [],
        "lines": [
            {
                "id": str(line.id),
                "charge_item": str(line.charge_item_id),
                "service": line.service_name,
                "quantity": line.quantity,
                "unit_price": _money(line.unit_price),
                "amount": _money(line.amount),
                "payer_code": line.payer_code,
                "requires_preauth": line.requires_preauth,
                "sent_to_sha": bool(line.sha_line_guid),
                "pre_authorization": (
                    {
                        "id": str(line.pre_authorization.id),
                        "status": line.pre_authorization.status,
                        "status_label": line.pre_authorization.get_status_display(),
                        "approval_reference": line.pre_authorization.approval_reference,
                        "sha_state": line.pre_authorization.sha_state,
                    }
                    if line.pre_authorization
                    else None
                ),
            }
            for line in lines
        ],
        "attachments": [
            {
                "id": str(a.id),
                "category": a.category,
                "label": a.get_category_display(),
                "file": (
                    {"id": str(a.file_id), "name": a.file.file.name.rsplit("/", 1)[-1]}
                    if a.file_id
                    else None
                ),
                "sha_document_type": a.sha_document_type,
                "intervention_code": a.intervention_code,
                "sent_to_sha": bool(a.sha_attachment_id),
            }
            for a in claim.attachments.select_related("file")
        ],
        "sha_visit": sha_claims.visit_data(claim.sha_visit) if claim.sha_visit_id else None,
        "sha_missing_documents": sha_claims.missing_documents(claim) if is_sha(claim) else [],
        "checklist": checklist(claim) if claim.status == "DRAFT" else claim.checklist_snapshot,
        "remittances": [
            {
                "id": str(r.id),
                "amount": _money(r.amount_paid),
                "reference": r.reference,
                "date": r.remittance_date.isoformat(),
            }
            for r in claim.remittances.all()
        ],
    }


def workspace(user, patient):
    from apps.care_pathway.services import billing_overview

    overview = billing_overview(patient)
    payer = claim_payer(patient)
    claims = (
        InsuranceClaim.objects.filter(patient=patient)
        .exclude(claim_number="")
        .order_by("-created_at")
    )
    invoice = current_invoice(patient)
    charges = billable_charges(patient)
    payments = Payment.objects.filter(invoice__patient=patient).select_related("received_by")
    paid = sum((p.amount for p in payments), ZERO)
    total = sum((Decimal(e["amount"]) for e in overview["events"]), ZERO)
    coverage = patient.insurance_coverages.order_by("-created_at").first()
    claimed_ids = _claimed_charge_ids(patient)
    invoice_data = None
    if invoice is not None:
        billed = {str(i) for i in invoice.lines.values_list("charge_item_id", flat=True)}
        invoice_data = {
            "id": str(invoice.id),
            "number": invoice.number,
            "version": invoice.version,
            "created_at": invoice.created_at.isoformat(),
            "total": _money(invoice.total_amount),
            "lines": [
                {
                    "service": line.description,
                    "quantity": line.quantity,
                    "amount": _money(line.line_total),
                }
                for line in invoice.lines.all()
            ],
            "stale": billed != {str(c.id) for c in charges},
        }
    return {
        "can_edit": is_finance(user),
        "currency": "KES",
        "payer": {
            "code": patient.payer,
            "label": patient.get_payer_display() if patient.payer else "Not recorded",
            "claimable": payer is not None,
            "claim_payer": payer,
            "coverage": (
                {
                    "scheme": coverage.get_scheme_type_display(),
                    "verified": coverage.sha_verified,
                    "member_status": coverage.sha_member_status,
                }
                if coverage
                else None
            ),
        },
        "overview": overview,
        "totals": {
            "services": _money(total),
            "paid": _money(paid),
            "outstanding": _money(_outstanding(patient)),
        },
        "unclaimed_charges": [str(c.id) for c in charges if c.id not in claimed_ids],
        "claims": [_claim_data(c) for c in claims],
        "invoice": invoice_data,
        "payments": [
            {
                "id": str(p.id),
                "amount": _money(p.amount),
                "method": p.method,
                "method_label": PAYMENT_METHODS.get(p.method, p.get_method_display()),
                "reference": p.reference,
                "paid_at": p.paid_at.isoformat(),
                "received_by": _user_label(p.received_by),
            }
            for p in payments.order_by("paid_at")
        ],
        "payment_methods": [{"value": k, "label": v} for k, v in PAYMENT_METHODS.items()],
        "attachment_categories": [
            {"value": k, "label": v} for k, v in ClaimAttachment.CATEGORY_CHOICES
        ],
        "excluded_attachment_categories": list(ATTACHMENT_EXCLUDED_CATEGORIES),
        "timeline": TIMELINE,
        # Not configured anywhere — never applied (see module docstring).
        "package_ceiling": None,
        "emergency_fund_routing": None,
        "sha": sha_section(patient) if payer == "SHA" else None,
    }


def sha_section(patient):
    """SHA identity, eligibility and visits for the Billing stage."""
    from apps.dha_interop.registries import client_registry_id

    from .sha_eligibility import check_data, latest_check

    branches = Branch.objects.filter(
        organization_id=patient.organization_id, is_active=True, sha_claims_enabled=True
    ).exclude(sha_fr_code="")
    return {
        "cr_id": client_registry_id(patient),
        "eligibility": check_data(latest_check(patient)),
        "visits": [sha_claims.visit_data(v) for v in sha_claims.patient_visits(patient)[:20]],
        "branches": [
            {"id": str(b.id), "name": b.name, "fr_code": b.sha_fr_code} for b in branches
        ],
        "service_types": list(sha_claims.SERVICE_TYPES),
        "outpatient_discharge_reasons": list(sha_claims.OUTPATIENT_DISCHARGE_REASONS),
        "inpatient_discharge_reasons": list(sha_claims.INPATIENT_DISCHARGE_REASONS),
        "close_reasons": list(sha_claims.CLOSE_REASONS),
        "otp_whitelist_reasons": list(sha_claims.OTP_WHITELIST_REASONS),
        "document_types": list(sha_claims.CLAIM_DOCUMENT_TYPES),
    }


def _cell(value):
    """Neutralise spreadsheet formula injection in exported text."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


def export_csv(patient):
    from apps.care_pathway.services import billing_overview

    overview = billing_overview(patient)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(
        [
            "client_number",
            "service",
            "delivered_at",
            "quantity",
            "amount",
            "paid",
            "claimed_balance",
            "unbilled_balance",
            "status",
        ]
    )
    for e in sorted(overview["events"], key=lambda e: e["delivered_at"]):
        writer.writerow(
            [
                _cell(e["client_number"]),
                _cell(e["service"]),
                e["delivered_at"],
                e["quantity"],
                e["amount"],
                e["paid_amount"],
                e["claimed_balance"],
                e["unbilled_balance"],
                e["status"],
            ]
        )
    return out.getvalue()
