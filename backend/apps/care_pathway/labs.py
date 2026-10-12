"""
In-record view of a client's lab work, over the lims store (no second store).
Only validated results are shown here; an abnormal one stays an open item until a
prescriber acknowledges it. Order sets and the intake write-back are configuration,
because both need LOINC codes that must come from the facility / terminology server:

  settings.LAB_ORDER_SETS      {"set name": ["<LOINC code>", ...]}      (default {})
  settings.INTAKE_LAB_WRITEBACK {"<LOINC code>": "qtc" | "egfr" | "tsh"} (default {})
"""

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.dha_interop.models import LoincCodeIndex
from apps.lims.models import LabOrder, LabResult

from . import intake, services
from .models import LabResultAcknowledgement


def _results(patient):
    return LabResult.objects.filter(
        lab_order__encounter__patient=patient, is_validated=True
    ).select_related("lab_order__loinc_code", "acknowledgement").order_by("-recorded_at")


def lab_overview(patient):
    orders = LabOrder.objects.filter(encounter__patient=patient).select_related("loinc_code").order_by("-ordered_at")
    return {
        "orders": [{"id": str(o.pk), "code": o.loinc_code_id, "name": o.loinc_code.description,
                    "status": o.status, "ordered_at": o.ordered_at} for o in orders],
        "results": [
            {"id": str(r.pk), "code": r.lab_order.loinc_code_id, "name": r.lab_order.loinc_code.description,
             "value": r.result_value, "unit": r.unit, "reference_range": r.reference_range,
             "abnormal": r.is_abnormal, "recorded_at": r.recorded_at,
             "acknowledged": hasattr(r, "acknowledgement")}
            for r in _results(patient)
        ],
        "order_sets": {k: list(v) for k, v in (getattr(settings, "LAB_ORDER_SETS", None) or {}).items()},
    }


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
