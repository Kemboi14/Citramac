"""
Statutory forms. Which forms exist, their titles and who may sign them come from
settings.LEGAL_FORM_CATALOGUE, a list of
  {"key": ..., "title": ..., "signer_roles": ["Psychiatrist", ...] or [], "applies_to": [admission types]}
VERIFY: the form numbers, titles and signing rules come from the statute / regulator
supplied by the project owner. Unset means no forms are offered.
"""

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.access import active_roles

from . import plan_extras
from .models import LegalForm


def catalogue():
    return list(getattr(settings, "LEGAL_FORM_CATALOGUE", None) or [])


def _spec(key):
    spec = next((f for f in catalogue() if f["key"] == key), None)
    if spec is None:
        raise ValidationError({"form_key": "That form is not in this facility's catalogue."})
    return spec


def _may_sign(user, spec):
    roles = spec.get("signer_roles") or []
    return not roles or active_roles(user).filter(name__in=roles).exists()


def prepare(patient, user, form_key, content, admission=None):
    spec = _spec(form_key)
    return LegalForm.objects.create(
        organization_id=patient.organization_id, patient=patient, admission=admission,
        form_key=spec["key"], content=content or {}, prepared_by=user,
    )


@transaction.atomic
def sign(form, user):
    if form.status == "SIGNED":
        raise ValidationError({"detail": "This form is already signed."})
    spec = _spec(form.form_key)
    if _may_sign(user, spec):
        form.status, form.signed_by, form.signed_at = "SIGNED", user, timezone.now()
        form.save()
        return form
    # Not entitled to sign it: ask someone who is, rather than signing on their behalf.
    form.cosign_request = plan_extras.request_cosign(
        form.patient, user, "LEGAL_FORM", spec["title"], "LegalForm", str(form.pk)
    )
    form.status = "COSIGN_REQUESTED"
    form.save()
    return form


def complete_cosigned(request, user):
    """A senior's co-signature finishes the form — but only if they may sign this form."""
    form = LegalForm.objects.select_for_update().get(pk=request.subject_id)
    if not _may_sign(user, _spec(form.form_key)):
        raise ValidationError({"detail": "You are not entitled to sign this form."})
    form.status, form.signed_by, form.signed_at = "SIGNED", user, timezone.now()
    form.save()
