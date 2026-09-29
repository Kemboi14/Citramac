from celery import shared_task


@shared_task
def process_subscription_lifecycle():
    """Daily — see apps.tenancy.subscription_lifecycle."""
    from .subscription_lifecycle import process_all_subscriptions

    return process_all_subscriptions()
