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

# A committed development secret still in use is a CRITICAL platform security
# alert (apps.security.evaluate.default_secret_problems) and a startup error log.
ALERT_ON_DEFAULT_SECRETS = True

# No EMAIL_HOST env var means no SMTP server is configured for platform mail
# (organisations may still have their own). Nothing is sent, and only the fact
# that a message was withheld is logged: the console backend used here before
# printed sign-in codes and activation links into the container log.
# (base.py defaults EMAIL_HOST to "localhost", so check the raw env var here.)
if not env("EMAIL_HOST", default=""):  # noqa: F405
    EMAIL_BACKEND = "apps.notifications.backends.NoSmtpEmailBackend"

# The API schema and Swagger UI describe every endpoint: staff (Django admin
# users) only in production.
SPECTACULAR_SETTINGS = {  # noqa: F405
    **SPECTACULAR_SETTINGS,  # noqa: F405
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAdminUser"],
}

# Secrets (DB creds, SHA API keys, JWT signing keys, SMTP creds) are sourced from
# Kubernetes Secret objects backed by a managed secrets manager, never baked into
# images — per docs/09-SECURITY-COMPLIANCE.md §9.1.
