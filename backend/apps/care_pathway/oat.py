"""OAT referral/enrolment and naloxone supply. Records what the OAT prescriber and
the clinician decided; contains no dosing or protocol logic (VERIFY: protocol and
clinic list belong to the facility / national programme)."""

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import LocalConcept, NaloxoneSupply, OatEnrolment


def refer(patient, user, data):
    if not LocalConcept.objects.filter(valueset_id="oat-medicine", code=data.get("medicine")).exists():
        raise ValidationError({"medicine": "Choose the medicine the OAT clinic is considering."})
    if not str(data.get("clinic", "")).strip():
        raise ValidationError({"clinic": "Name the OAT clinic or service."})
    return OatEnrolment.objects.create(
        organization_id=patient.organization_id, patient=patient, medicine=data["medicine"],
        clinic=data["clinic"].strip(), recorded_by=user,
    )


def update_status(enrolment, user, status, dose="", reason="", supervised=None):
    if status not in dict(OatEnrolment.STATUS_CHOICES):
        raise ValidationError({"status": "Unknown status."})
    if status == "ENROLLED" and not str(dose).strip():
        raise ValidationError({"dose": "Record the dose as written by the OAT prescriber."})
    if status == "STOPPED" and not str(reason).strip():
        raise ValidationError({"reason": "Say why OAT was stopped."})
    enrolment.status, enrolment.recorded_by = status, user
    if dose:
        enrolment.prescribed_dose = dose
    if reason:
        enrolment.status_reason = reason
    if supervised is not None:
        enrolment.supervised_dispensing = bool(supervised)
    enrolment.save()
    return enrolment


def record_naloxone(patient, user, outcome, quantity=None, training=False):
    if outcome not in dict(NaloxoneSupply.OUTCOME_CHOICES):
        raise ValidationError({"outcome": "Record whether naloxone was supplied or declined."})
    if outcome == "SUPPLIED" and not quantity:
        raise ValidationError({"quantity": "Record how many kits were supplied."})
    return NaloxoneSupply.objects.create(
        organization_id=patient.organization_id, patient=patient, outcome=outcome,
        quantity=quantity if outcome == "SUPPLIED" else None, training_given=bool(training),
        given_by=user, given_at=timezone.now(),
    )
