from celery import shared_task


@shared_task
def apply_sha_callback(event_id):
    """Apply one stored HIE status callback (apps.insurance_claims.sha_callbacks)."""
    from apps.dha_interop.models import ShaCallbackEvent

    from .sha_callbacks import apply_event

    event = ShaCallbackEvent.objects.filter(pk=event_id).first()
    if event is not None:
        apply_event(event)


@shared_task
def apply_pending_sha_callbacks():
    """Sweep: any stored callback not yet applied (worker down at receipt)."""
    from .sha_callbacks import apply_pending

    return apply_pending()
