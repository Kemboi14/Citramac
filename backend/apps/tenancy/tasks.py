from celery import shared_task


@shared_task
def process_subscription_lifecycle():
    """Daily — see apps.tenancy.subscription_lifecycle."""
    from .subscription_lifecycle import process_all_subscriptions

    return process_all_subscriptions()


@shared_task
def remind_facility_licence_renewals():
    """Daily — see apps.tenancy.facility_licence."""
    from .facility_licence import remind_all

    return remind_all()
