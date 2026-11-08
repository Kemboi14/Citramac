from .base import *  # noqa: F401,F403

DEBUG = False

SECURE_SSL_REDIRECT = True
# TLS ends at the ingress, as in production: without this every request looks
# like plain HTTP and SECURE_SSL_REDIRECT loops.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 3600
SECURE_HSTS_INCLUDE_SUBDOMAINS = True

ALERT_ON_DEFAULT_SECRETS = True
