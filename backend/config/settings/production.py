from .base import *  # noqa: F401,F403

DEBUG = False

SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# TLS terminates at the reverse proxy in front of this app, not here — without
# this, SECURE_SSL_REDIRECT can't tell a proxied HTTPS request from plain HTTP
# and redirect-loops.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Honest stub, same spirit as the Sentry DSN gate in base.py: no EMAIL_HOST
# env var means no real SMTP has been configured yet, so fail loud-but-harmless
# by printing OTP emails to the container logs instead of erroring on send.
# (base.py defaults EMAIL_HOST to "localhost", so check the raw env var here.)
if not env("EMAIL_HOST", default=""):  # noqa: F405
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Secrets (DB creds, SHA API keys, JWT signing keys, SMTP creds) are sourced from
# Kubernetes Secret objects backed by a managed secrets manager, never baked into
# images — per docs/09-SECURITY-COMPLIANCE.md §9.1.
