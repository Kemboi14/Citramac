"""The price a charge is raised at (guide.md 2026-11-26).

A client whose payer involves a private insurer (Patient.payer PRIVATE or
SHA_PRIVATE) and who is registered with one of the organisation's active
insurers is charged that insurer's rate for a service when the Org Admin has
set one (ServicePayerCode, payer INSURER). Otherwise, and for every other
client, the service's own out-of-pocket rate applies. A rate is never
invented: with neither configured the charge is raised unpriced, as before.

The charge records whose rate it used (ChargeItem.priced_for), so the invoice
can say so and a later change of payer does not reprice it.
"""

from apps.client_registry.models import Patient


def insurer_for(patient):
    """The organisation's Insurer whose rates apply to this client, or None."""
    if patient is None or patient.payer not in Patient.PAYERS_WITH_PRIVATE_INSURER:
        return None
    if not patient.insurer_id:
        return None
    from apps.insurance_claims.models import Insurer

    return Insurer.all_objects.filter(
        pk=patient.insurer_id, organization_id=patient.organization_id, active=True
    ).first()


def price_for(service, patient):
    """(unit_price, insurer or None) for one unit of `service` delivered to `patient`."""
    insurer = insurer_for(patient)
    if insurer is not None:
        from apps.insurance_claims.models import ServicePayerCode

        rate = (
            ServicePayerCode.all_objects.filter(
                organization_id=service.organization_id,
                service=service,
                payer="INSURER",
                insurer=insurer,
                active=True,
                rate__isnull=False,
            )
            .values_list("rate", flat=True)
            .first()
        )
        if rate is not None:
            return rate, insurer
    return service.rate, None


def charge_fields(service, patient):
    """Keyword arguments for ChargeItem.objects.create."""
    unit_price, insurer = price_for(service, patient)
    return {"service": service, "unit_price": unit_price, "priced_for": insurer}
