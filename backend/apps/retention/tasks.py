from celery import shared_task


@shared_task
def run_retention_scan():
    """
    Weekly platform-wide retention scan (CELERY_BEAT_SCHEDULE). Proposes
    archive batches for approval and sends coming-due notices; it never
    archives anything itself. Iterating every tenant is the documented
    exception to docs/04-MULTI-TENANCY.md §4's per-tenant task rule: each
    organization is scanned, recorded and notified separately, and one
    tenant's failure is recorded against it without stopping the others.
    """
    from .services import scan_all_organizations

    runs = scan_all_organizations()
    return {"organizations_scanned": len(runs)}
