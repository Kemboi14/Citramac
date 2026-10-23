from celery import shared_task

from .sync import sync_terminology_source


@shared_task
def sync_icd11():
    run = sync_terminology_source("ICD11")
    return str(run.id)


@shared_task
def sync_loinc():
    run = sync_terminology_source("LOINC")
    return str(run.id)


@shared_task
def sync_national_drug_index():
    run = sync_terminology_source("NATIONAL_DRUG_INDEX")
    return str(run.id)


@shared_task
def recheck_facility_registry():
    """Nightly: re-check every SHA branch's FR code against the DHA Facility
    Registry, so a suspension or contract change shows in Branch Settings."""
    import logging

    from apps.tenancy.context import platform_admin_context
    from apps.tenancy.models import Branch

    from .registries import RegistryError, verify_branch_facility

    checked = 0
    with platform_admin_context():
        for branch in Branch.objects.unscoped().filter(is_active=True).exclude(sha_fr_code=""):
            try:
                verify_branch_facility(branch)
                checked += 1
            except RegistryError as exc:
                logging.getLogger(__name__).warning(
                    "Facility Registry re-check for branch %s failed: %s", branch.id, exc.message
                )
    return checked


@shared_task
def drain_hie_outbox():
    """Deliver queued / retry-due HIE resources (CLAUDE.md §4 durable outbox)."""
    from .hie_client import drain_outbox

    return drain_outbox()
