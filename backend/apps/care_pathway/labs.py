"""
In-record view of a client's lab work, over the lims store (no second store).
Only validated results are shown here; an abnormal one stays an open item until a
prescriber acknowledges it. Order sets and the intake write-back are configuration,
because both need LOINC codes that must come from the facility / terminology server:

  settings.LAB_ORDER_SETS      {"set name": ["<LOINC code>", ...]}      (default {})
  settings.INTAKE_LAB_WRITEBACK {"<LOINC code>": "qtc" | "egfr" | "tsh"} (default {})

A result typed in here (from a laboratory report) goes through the same lims
validation gate as one entered in the laboratory: it is only shown, and only
needs acknowledging, once a laboratory scientist has validated it. No reference
range is supplied by this code — only what the report states.
"""

from django.conf import settings
from django.db import transaction
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.dha_interop.models import LoincCodeIndex
from apps.lims.models import LabOrder, LabResult

from . import intake, services
from .interventions import can_prescribe
from .models import LabResultAcknowledgement


def _by(user):
    return (user.get_full_name() or str(user)) if user else ""


def _results(patient):
    return LabResult.objects.filter(
        lab_order__encounter__patient=patient, is_validated=True
    ).select_related(
        "lab_order__loinc_code", "lab_order__ordered_by", "acknowledgement__acknowledged_by"
    ).order_by("-recorded_at")


def _result_row(r):
    ack = getattr(r, "acknowledgement", None)
    return {
        "id": str(r.pk), "order": str(r.lab_order_id), "code": r.lab_order.loinc_code_id,
        "name": r.lab_order.loinc_code.description, "value": r.result_value, "unit": r.unit,
        "reference_range": r.reference_range, "abnormal": r.is_abnormal,
        "critical": r.interpretation == "CRITICAL", "interpretation": r.interpretation,
        "recorded_at": r.recorded_at, "ordered_at": r.lab_order.ordered_at,
        "ordered_by": _by(r.lab_order.ordered_by), "acknowledged": ack is not None,
        "acknowledged_by": _by(ack.acknowledged_by) if ack else "",
        "acknowledged_at": ack.acknowledged_at if ack else None,
    }


def lab_overview(patient, user=None):
    orders = LabOrder.objects.filter(encounter__patient=patient).select_related(
        "loinc_code", "ordered_by"
    ).order_by("-ordered_at")
    return {
        "orders": [{"id": str(o.pk), "code": o.loinc_code_id, "name": o.loinc_code.description,
                    "status": o.status, "ordered_at": o.ordered_at, "ordered_by": _by(o.ordered_by)}
                   for o in orders],
        "results": [_result_row(r) for r in _results(patient)],
        "order_sets": {k: list(v) for k, v in (getattr(settings, "LAB_ORDER_SETS", None) or {}).items()},
        "can_acknowledge": can_prescribe(user),
    }


@transaction.atomic
def enter_result(order, user, data):
    """A result from the laboratory report, flagged Normal / Abnormal / Critical
    as the report states. It waits for laboratory validation like any other."""
    if order.status in ("RESULT_VALIDATED", "CANCELLED"):
        raise ValidationError({"detail": "This order is closed — no further result can be entered."})
    if order.results.exists():
        raise ValidationError({"detail": "A result is already entered for this order and is awaiting validation."})
    value = str(data.get("value") or "").strip()
    if not value:
        raise ValidationError({"value": "Enter the result value."})
    flag = data.get("interpretation")
    if flag not in dict(LabResult.INTERPRETATION_CHOICES):
        raise ValidationError({"interpretation": "Flag the result Normal, Abnormal or Critical."})
    result = LabResult.objects.create(
        organization_id=order.organization_id, lab_order=order, result_value=value[:255],
        unit=str(data.get("unit") or "").strip()[:50],
        reference_range=str(data.get("reference_range") or "").strip()[:100],
        is_abnormal=flag != "NORMAL", interpretation=flag, recorded_by=user,
    )
    order.status = "RESULT_PENDING"
    order.save(update_fields=["status", "updated_at"])
    return result


def unacknowledged_abnormal(patient):
    return [r for r in _results(patient) if r.is_abnormal and not hasattr(r, "acknowledgement")]


@transaction.atomic
def place_orders(patient, user, codes):
    if not codes:
        raise ValidationError({"codes": "Choose at least one test."})
    found = set(LoincCodeIndex.objects.filter(code__in=codes).values_list("code", flat=True))
    missing = set(codes) - found
    if missing:
        raise ValidationError({"codes": f"Unknown test code: {', '.join(sorted(missing))}"})
    episode = services.get_or_open_episode(patient, user)
    encounter = services.clinical_encounter_for(patient, episode, user)
    return [
        LabOrder.objects.create(organization_id=patient.organization_id, encounter=encounter,
                                loinc_code_id=c, ordered_by=user)
        for c in codes
    ]


@transaction.atomic
def acknowledge(result, user, note=""):
    if not can_prescribe(user):
        raise PermissionDenied("Only a prescriber can acknowledge a result.")
    if not result.is_validated:
        raise ValidationError({"detail": "Only a validated result can be acknowledged."})
    if hasattr(result, "acknowledgement"):
        raise ValidationError({"detail": "This result was already acknowledged."})
    patient = result.lab_order.encounter.patient
    ack = LabResultAcknowledgement.objects.create(
        organization_id=result.organization_id, result=result, patient=patient,
        acknowledged_by=user, note=note,
    )
    field = (getattr(settings, "INTAKE_LAB_WRITEBACK", None) or {}).get(result.lab_order.loinc_code_id)
    if field in ("qtc", "egfr", "tsh"):
        draft = intake.open_draft(patient, user)
        medical = dict(draft.sections.get("medical") or {})
        medical[field] = result.result_value
        draft.sections = {**draft.sections, "medical": medical}
        draft.save(update_fields=["sections", "updated_at"])
    return ack
