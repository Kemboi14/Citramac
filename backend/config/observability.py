"""
Error tracking (Sentry) — docs/12-DEVOPS-DEPLOYMENT.md §12.5. Structured
JSON logging is configured directly in settings/base.py (django-structlog +
structlog's own processor pipeline) since it has to be wired into
`LOGGING`/`MIDDLEWARE` at settings-module level, not a one-shot init call.
"""

import sentry_sdk
from sentry_sdk.integrations.django import DjangoIntegration


def _scrub_phi(event, hint):
    """
    Never let patient data leak into Sentry — §12.5: "scrubbing PHI from
    error payloads before send (critical — never let patient data leak
    into an error-tracking SaaS)." Rather than enumerating every
    PHI-bearing field (a list that's always incomplete as new clinical
    models are added), this strips the request body/query string entirely:
    a stack trace + URL path + status code is enough to debug from, and is
    never itself PHI.
    """
    request = event.get("request")
    if request:
        request.pop("data", None)
        request.pop("query_string", None)
    return event


def init_sentry(dsn, environment, release=None):
    """No-ops when `dsn` is empty — matches this project's honest-stub
    pattern (apps.dha_interop.hie_client, apps.insurance_claims.sha_gateway):
    no real Sentry project is configured in this environment, so error
    tracking is silently disabled rather than erroring or faking activity."""
    if not dsn:
        return
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        integrations=[DjangoIntegration()],
        send_default_pii=False,
        before_send=_scrub_phi,
        traces_sample_rate=0.1,
    )
