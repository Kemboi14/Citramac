from celery import shared_task

from . import accommodation


@shared_task
def charge_bed_nights():
    """Count every facility-midnight bed night due and raise its bed-day charge.

    Cross-tenant and idempotent (one BedNight per admission and night) — safe to
    run more than once. See apps.ipd_ward.accommodation.charge_nights.
    """
    return accommodation.charge_nights()
