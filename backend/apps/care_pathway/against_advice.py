"""
Leaving against medical advice — the client's signed acknowledgement (owner
decisions 2026-11-26).

When an admission's discharge (draft or signed) has the disposition AMA ("Left
against medical advice", including a voluntary client leaving before their
written notice runs out — legal_status.record_departure), the client is asked
to sign an acknowledgement against the facility's own wording (ConsentTemplate
DISCHARGE_AGAINST_ADVICE, Org Admin → Consent wording). The system writes no
wording (guide.md §6): with none set, no acknowledgement can be signed and the
discharge screen says so.

The client draws their signature, or is recorded as unable to sign or as
refusing to sign — refusing is itself what happens in many AMA departures —
with the reason; the staff member present always witnesses, signing as
themselves. Rows are append-only (AgainstAdviceAcknowledgement +
documents.PartySignature bound to the wording and admission), so a client who
refused and later signs has both on record.

None of this ever blocks the discharge: a client who is leaving cannot be held
by a missing form.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import AgainstAdviceAcknowledgement, ConsentTemplate, DischargeSummary

WORDING_TYPE = "DISCHARGE_AGAINST_ADVICE"
AMA = "AMA"
NO_WORDING = (
    "The facility has not set its wording for the against-advice acknowledgement "
    "(Org Admin → Consent wording), so the client cannot sign one. The discharge is not "
    "held up by this."
)


def wording():
    """The facility's active wording, or None."""
    return ConsentTemplate.objects.filter(consent_type=WORDING_TYPE, active=True).first()


def _latest_summary(admission):
    return DischargeSummary.objects.filter(admission=admission).order_by("-version").first()


def applies(admission):
    """True when the admission's discharge (draft or signed) is against advice."""
    summary = _latest_summary(admission)
    return bool(summary and summary.disposition == AMA)


def content(ack):
    """What the client's and the witness's signatures attest to."""
    return {
        "acknowledgement": str(ack.pk),
        "patient": str(ack.patient_id),
        "admission": str(ack.admission_id),
        "wording_version": ack.wording_version,
        "wording_text": ack.wording_text,
        "recorded_at": ack.recorded_at.isoformat(),
    }


def signatures_for(ack):
    from apps.documents.signatures import content_sha256

    current = content_sha256(content(ack))
    return [
        row
        for row in ack.signatures.select_related("captured_by").order_by("captured_at")
        if row.content_sha256 == current
    ]


def outcome(ack, rows=None):
    """DRAWN (signed), UNABLE or REFUSED — the client's part."""
    from apps.documents.models import PartySignature

    rows = signatures_for(ack) if rows is None else rows
    client = next((r for r in rows if r.role == PartySignature.ROLE_CLIENT), None)
    return client.method if client else ""


def acknowledgements(admission):
    return list(
        AgainstAdviceAcknowledgement.objects.filter(admission=admission)
        .select_related("recorded_by")
        .order_by("recorded_at")
    )


def row(ack):
    from apps.documents.signatures import signature_row

    from .services import user_display

    rows = signatures_for(ack)
    return {
        "id": str(ack.pk),
        "recorded_at": ack.recorded_at.isoformat(),
        "recorded_by": user_display(ack.recorded_by),
        "wording_version": ack.wording_version,
        "wording_text": ack.wording_text,
        "outcome": outcome(ack, rows),
        "signatures": [signature_row(r) for r in rows],
    }


def status(admission):
    """For the discharge screen."""
    current = wording()
    return {
        "applies": applies(admission),
        "wording": ({"version": current.version, "text": current.text} if current else None),
        "no_wording_message": "" if current else NO_WORDING,
        "acknowledgements": [row(a) for a in acknowledgements(admission)],
    }


@transaction.atomic
def record(admission, user, data):
    """The client's acknowledgement (drawn, unable or refused, with the reason)
    and the staff witness's signature, against the active wording."""
    from apps.documents import signatures as party_signatures
    from apps.documents.models import PartySignature

    if not applies(admission):
        raise ValidationError(
            {
                "detail": "An acknowledgement is taken when the discharge is recorded as "
                "left against medical advice."
            }
        )
    current = wording()
    if current is None:
        raise ValidationError({"detail": NO_WORDING})
    sigs = data.get("signatures") if isinstance(data, dict) else None
    if not isinstance(sigs, dict) or not isinstance(sigs.get("client"), dict):
        raise ValidationError(
            {
                "signatures": "The client signs, or you record that they could not or would "
                "not sign and why; you sign as witness."
            }
        )
    patient = admission.patient
    ack = AgainstAdviceAcknowledgement.objects.create(
        organization_id=admission.organization_id,
        patient=patient,
        admission=admission,
        discharge_summary=_latest_summary(admission),
        wording=current,
        wording_version=current.version,
        wording_text=current.text,
        recorded_by=user,
        recorded_at=timezone.now(),
    )
    party_signatures.sign_target(
        {"ama_acknowledgement": ack},
        patient,
        user,
        PartySignature.ROLE_CLIENT,
        {**sigs["client"], "name": patient.get_full_name()},
        sigs.get("witness"),
        party_signatures.content_sha256(content(ack)),
        allow_unable=True,
        allow_refused=True,
    )
    return ack


def print_context(admission):
    """The acknowledgements as printed on the discharge summary."""
    from apps.documents.signatures import print_rows

    from . import facility_time

    return [
        {
            "recorded_at": facility_time.local_format(ack.recorded_at, "%d %b %Y %H:%M"),
            "wording_version": ack.wording_version,
            "wording_text": ack.wording_text,
            "signatures": print_rows(signatures_for(ack)),
        }
        for ack in acknowledgements(admission)
    ]
