"""
Custom Prometheus collectors for signals django-prometheus doesn't cover out
of the box — docs/12-DEVOPS-DEPLOYMENT.md §12.5's Celery queue depth and SHA
API failure-rate metrics. Each collect() call queries live state at scrape
time rather than tracking an in-process counter: a counter incremented by
whichever of N backend replicas happened to handle a request would be
meaningless once split across replicas, but a value read fresh from
Redis/Postgres on every scrape is correct regardless of which replica serves
/metrics.
"""

import redis
from django.conf import settings
from django.db.models import Count
from django.utils import timezone
from prometheus_client import REGISTRY
from prometheus_client.core import GaugeMetricFamily

_registered = False

SHA_FAILURE_WINDOW_MINUTES = 15


class CeleryQueueDepthCollector:
    def describe(self):
        # Tells prometheus_client's registry not to call collect() just to
        # learn this collector's metric names at registration time — collect()
        # here touches Redis/settings that aren't safely readable while
        # settings/base.py (which calls init_custom_metrics()) is still
        # mid-import.
        return []

    def collect(self):
        gauge = GaugeMetricFamily(
            "citramac_celery_queue_depth",
            "Number of tasks waiting in the default Celery queue (Redis LLEN).",
        )
        try:
            client = redis.Redis.from_url(settings.CELERY_BROKER_URL)
            depth = client.llen("celery")
        except redis.RedisError:
            depth = -1  # scrape-time failure is a signal in itself, never silently omitted
        gauge.add_metric([], depth)
        yield gauge


class ShaFailureRateCollector:
    def describe(self):
        return []  # see CeleryQueueDepthCollector.describe()

    def collect(self):
        from apps.dha_interop.models import ShaTransactionLog

        gauge = GaugeMetricFamily(
            "citramac_sha_failed_transactions",
            f"SHA gateway transactions that failed in the last {SHA_FAILURE_WINDOW_MINUTES} "
            "minutes, by transaction type.",
            labels=["transaction_type"],
        )
        since = timezone.now() - timezone.timedelta(minutes=SHA_FAILURE_WINDOW_MINUTES)
        rows = (
            ShaTransactionLog.objects.filter(status="FAILED", created_at__gte=since)
            .values("transaction_type")
            .annotate(count=Count("id"))
        )
        counts = {row["transaction_type"]: row["count"] for row in rows}
        for transaction_type, _ in ShaTransactionLog.TRANSACTION_TYPE_CHOICES:
            gauge.add_metric([transaction_type], counts.get(transaction_type, 0))
        yield gauge


def init_custom_metrics():
    """No-ops on a second call — settings modules can be re-imported within a
    single process (autoreloader, some test-runner paths), and re-registering
    the same collector twice raises ValueError in prometheus_client."""
    global _registered
    if _registered:
        return
    REGISTRY.register(CeleryQueueDepthCollector())
    REGISTRY.register(ShaFailureRateCollector())
    _registered = True
