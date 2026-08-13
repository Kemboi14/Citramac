from .base import *  # noqa: F401,F403

DEBUG = False

SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# Secrets (DB creds, SHA API keys, JWT signing keys, SMTP creds) are sourced from
# Kubernetes Secret objects backed by a managed secrets manager, never baked into
# images — per docs/09-SECURITY-COMPLIANCE.md §9.1.
