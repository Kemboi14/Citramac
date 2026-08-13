"""
POS validation gate — docs/07-CLINICAL-MODULES-SPEC.md §7.10: "clinical staff
cannot order a lab test, X-ray, or dispense a drug until billing validates
the transaction (upfront cash, active corporate pre-auth, or verified SHA
coverage) — implement as a hard backend check in ClinicalOrder/Prescription
creation, not just a UI warning." Wired into
apps.clinical_encounter.views.EncounterViewSet's orders/prescriptions
actions (docs/11-ROADMAP-AND-PHASES.md Phase 4 exit criteria).

Real tariff/pricing calculation is out of scope here (a much larger,
separate feature) — clearance is a yes/no check against the three paths the
doc names, not a computed balance-due amount.
"""

from .models import Invoice


class BillingNotCleared(Exception):
    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def check_billing_clearance(encounter):
    """Raises BillingNotCleared if none of the three sanctioned payment paths are satisfied."""
    patient = encounter.patient

    if Invoice.objects.filter(
        patient=patient, encounter=encounter, status__in=["PAID", "PARTIALLY_PAID"]
    ).exists():
        return

    if patient.insurance_coverages.filter(sha_verified=True, sha_premium_compliant=True).exists():
        return

    from apps.insurance_claims.models import PreAuthorization

    if PreAuthorization.objects.filter(encounter=encounter, status="APPROVED").exists():
        return

    raise BillingNotCleared(
        "No cleared payment method on file for this encounter — upfront cash payment, an "
        "active corporate pre-authorization, or verified SHA coverage is required before "
        "ordering labs/procedures or dispensing medication."
    )
