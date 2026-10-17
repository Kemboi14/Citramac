from celery import shared_task

from apps.tenancy.context import platform_admin_context


@shared_task
def sweep_legal_statuses():
    """LGL-WF-03 (hourly): involuntary statuses inside the review lead time become
    REVIEW_DUE with LEGAL_STATUS_EXPIRING; past maxExpiryAt without a recorded
    decision they become EXPIRED with LEGAL_STATUS_EXPIRED; a risk alert during a
    voluntary notice period prompts clinical review. Cross-tenant, like the other
    beat tasks."""
    from . import legal_status

    with platform_admin_context():
        legal_status.sweep_all()
