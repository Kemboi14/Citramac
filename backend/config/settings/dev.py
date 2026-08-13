from .base import *  # noqa: F401,F403

DEBUG = True
ALLOWED_HOSTS = ["*"]

# Dev always runs a single process, so an in-memory cache is simpler than
# depending on Redis being up — staging/production use the Redis-backed
# CACHES from base.py where multiple replicas need to share rate-limit state.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
