"""
Cache-based rate limiting for the auth flow — docs/05-AUTHENTICATION-FLOW.md
§5.5: every step is rate limited per IP and per identity/token. Uses Django's
cache framework (Redis in staging/production, in-process locmem in dev — see
config/settings/{base,dev}.py) rather than DRF's generic throttle classes,
since the limits here are step-specific (OTP dispatch, OTP verify attempts,
login lockout), not a single global per-view rate.
"""

import time

from django.core.cache import cache


class RateLimitExceeded(Exception):
    def __init__(self, retry_after_seconds):
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"Rate limit exceeded, retry after {retry_after_seconds}s")


def enforce_rate_limit(key, max_attempts, window_seconds):
    """Raise RateLimitExceeded once `key` is hit `max_attempts` times within `window_seconds`."""
    cache_key = f"ratelimit:{key}"
    count = cache.get(cache_key, 0)
    if count >= max_attempts:
        ttl = cache.ttl(cache_key) if hasattr(cache, "ttl") else window_seconds
        raise RateLimitExceeded(retry_after_seconds=ttl or window_seconds)
    if count == 0:
        cache.set(cache_key, 1, timeout=window_seconds)
    else:
        cache.incr(cache_key)


def enforce_cooldown(key, cooldown_seconds):
    """Raise RateLimitExceeded if `key` was hit within the last `cooldown_seconds`."""
    cache_key = f"cooldown:{key}"
    if cache.get(cache_key):
        ttl = cache.ttl(cache_key) if hasattr(cache, "ttl") else cooldown_seconds
        raise RateLimitExceeded(retry_after_seconds=ttl or cooldown_seconds)
    cache.set(cache_key, True, timeout=cooldown_seconds)


def enforce_general_rate_limit(client_ip):
    """
    Coarse per-IP-per-minute safety net backed by the Super Admin's own
    configurable SecurityPolicy.rate_limit_per_minute (Security Policies
    screen) — previously read nowhere in the codebase, so tightening it in
    the UI had no real effect anywhere. Layered on top of, not a
    replacement for, each endpoint's own specifically-tuned window
    (the enforce_rate_limit calls elsewhere in this module/auth_views) —
    this just gives that one dashboard setting real teeth on the
    highest-exposure unauthenticated endpoints.
    """
    from apps.security.models import SecurityPolicy

    max_per_minute = SecurityPolicy.get_solo().rate_limit_per_minute
    minute_bucket = int(time.time() // 60)
    enforce_rate_limit(f"general:{client_ip}:{minute_bucket}", max_per_minute, window_seconds=60)
