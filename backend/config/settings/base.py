"""
Base Django settings shared by every environment.

Environment-specific settings (dev/staging/production) import from this
module and override only what differs, per docs/02-TECH-STACK-AND-ARCHITECTURE.md §2.5.
"""

from pathlib import Path

import environ
import structlog
from celery.schedules import crontab

from config.observability import init_sentry

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="django-insecure-change-me-in-env")

DEBUG = env.bool("DJANGO_DEBUG", default=False)

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

# ── Applications ──────────────────────────────────────────────────────────
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "drf_spectacular",
    "django_structlog",
]

# One entry per app in apps/, mirrors docs/02-TECH-STACK-AND-ARCHITECTURE.md §2.5.
# Apps are scaffolded ahead of their build phase (docs/11-ROADMAP-AND-PHASES.md) but
# stay logic-free until their phase begins.
#
# This deployment is strictly a mental-health/CCP facility (CAfRIC), not a
# general hospital — apps.ris_pacs/theatre/mch/mortuary (Modules 5/8/9/12) are
# general-hospital-only per docs/07-CLINICAL-MODULES-SPEC.md §7.14 and are
# deliberately not installed; their app directories stay in apps/ as inert
# scaffolding (matching docs/02 §2.5's repo layout) but are never registered.
LOCAL_APPS = [
    "apps.tenancy",
    "apps.accounts",
    "apps.client_registry",
    "apps.triage",
    "apps.clinical_encounter",
    "apps.lims",
    "apps.pharmacy",
    "apps.ipd_ward",
    "apps.billing",
    "apps.insurance_claims",
    "apps.sysadmin_audit",
    "apps.ccp_program",
    "apps.dha_interop",
    "apps.notifications",
    "apps.offline_sync",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# Custom user model — UUID pk, email/staff_id based, no username field.
# See docs/06-DATA-MODEL.md §6.1.
AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # CSP/Referrer-Policy/Permissions-Policy — docs/09-SECURITY-COMPLIANCE.md §9.7.
    "config.middleware.SecurityHeadersMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Resolves the current Organization from the authenticated request and
    # binds it to thread-local/request context + the `app.current_org_id`
    # Postgres session variable that the RLS policies key off — must run
    # after AuthenticationMiddleware. See docs/04-MULTI-TENANCY.md §4.2.
    "apps.tenancy.middleware.TenantMiddleware",
    # Writes an AuditLogEntry for every request that mutates state.
    # See docs/09-SECURITY-COMPLIANCE.md §9.4.
    "apps.sysadmin_audit.middleware.AuditMiddleware",
    # Binds request_id/user_id/etc. into every structlog log line for the
    # duration of the request — docs/12-DEVOPS-DEPLOYMENT.md §12.5's
    # "structured JSON logging ... shipped to a log aggregator." Last, so
    # it wraps (and its timing includes) every middleware/view above it.
    "django_structlog.middlewares.RequestMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# ── Database (docs/02-TECH-STACK-AND-ARCHITECTURE.md §2.4 — PostgreSQL) ──
DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://citramac:citramac@localhost:5432/citramac",  # pragma: allowlist secret
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Argon2 primary hasher, per docs/09-SECURITY-COMPLIANCE.md §9.2.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Local filesystem in dev; production uses S3 via django-storages (already in
# requirements/production.txt) per docs/12-DEVOPS-DEPLOYMENT.md §12.1's
# "S3/GCS/equivalent object storage ... for attachments, lab PDFs, imaging
# references" — swap DEFAULT_FILE_STORAGE in production.py when that's wired up.
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "mediafiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── DRF / JWT (docs/05-AUTHENTICATION-FLOW.md §5.3, docs/10-API-SPECIFICATION.md) ──
REST_FRAMEWORK = {
    # Not plain JWTAuthentication — this subclass also binds the resolved
    # user's tenant context (see apps.accounts.authentication). DRF resolves
    # request.user inside the view, after classic middleware has already run,
    # so TenantMiddleware alone can't see a JWT-authenticated user; this class
    # is what actually sets the context for API requests.
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.accounts.authentication.TenantAwareJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 25,
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

from datetime import timedelta  # noqa: E402

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "CITRAMAC API",
    "DESCRIPTION": "Multi-tenant, DHA-certifiable, SHA-integrated HMIS.",
    "VERSION": "0.1.0",
}

# ── Celery (docs/02-TECH-STACK-AND-ARCHITECTURE.md §2.4) ──────────────────
CELERY_BROKER_URL = env("REDIS_URL", default="redis://localhost:6379/0")
CELERY_RESULT_BACKEND = env("REDIS_URL", default="redis://localhost:6379/0")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
# Only set true in an environment with no Celery worker/broker (e.g. a sandbox
# without Redis) — docker-compose/staging/production never set this, so OTP
# dispatch always goes through the real worker there.
CELERY_TASK_ALWAYS_EAGER = env.bool("CELERY_TASK_ALWAYS_EAGER", default=False)
CELERY_TASK_EAGER_PROPAGATES = CELERY_TASK_ALWAYS_EAGER

# Nightly terminology mirror sync — docs/08-DHA-SHA-INTEGRATION.md §8.2. Each
# task honestly no-ops (SKIPPED_NOT_CONFIGURED) until its source URL setting
# is set, so enabling beat here is safe even with no live source configured.
CELERY_BEAT_SCHEDULE = {
    "sync-icd11-nightly": {
        "task": "apps.dha_interop.tasks.sync_icd11",
        "schedule": crontab(hour=2, minute=0),
    },
    "sync-loinc-nightly": {
        "task": "apps.dha_interop.tasks.sync_loinc",
        "schedule": crontab(hour=2, minute=15),
    },
    "sync-national-drug-index-nightly": {
        "task": "apps.dha_interop.tasks.sync_national_drug_index",
        "schedule": crontab(hour=2, minute=30),
    },
}

# ── Cache (rate limiting for the auth flow, docs/05-AUTHENTICATION-FLOW.md §5.5) ──
CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": env("REDIS_URL", default="redis://localhost:6379/1"),
    }
}

# ── Email (OTP dispatch via Mailhog in dev, see docs/12-DEVOPS-DEPLOYMENT.md §12.1) ──
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=1025)
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-reply@citramac.local")

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:5173"])
# The frontend needs the httpOnly refresh_token cookie sent/received cross-origin
# (localhost:5173 -> localhost:8000 in dev) — see apps/accounts/auth_views.py.
CORS_ALLOW_CREDENTIALS = True

# ── Security headers (docs/09-SECURITY-COMPLIANCE.md §9.7) ───────────────
# X-Frame-Options comes from XFrameOptionsMiddleware (default DENY);
# Content-Security-Policy/Referrer-Policy/Permissions-Policy come from
# config.middleware.SecurityHeadersMiddleware; HSTS is staging/production-only
# (config/settings/staging.py, production.py) since it doesn't apply over
# the plain-http dev server.
SECURE_CONTENT_TYPE_NOSNIFF = True

# ── DHA/SHA interoperability (docs/08-DHA-SHA-INTEGRATION.md) ─────────────
# All empty by default — no real HIE/SHA sandbox credentials exist in this
# environment. apps.dha_interop.hie_client and apps.insurance_claims.sha_gateway
# honestly report a skipped/stubbed transmission rather than faking success
# when these are unset; set them (and flip SHA_GATEWAY_MODE) only once a real
# facility certificate and sandbox/production endpoint are provisioned.
HIE_ENDPOINT_URL = env("HIE_ENDPOINT_URL", default="")
HIE_MTLS_CLIENT_CERT = env("HIE_MTLS_CLIENT_CERT", default="")
HIE_MTLS_CLIENT_KEY = env("HIE_MTLS_CLIENT_KEY", default="")

# "stub" (default): sha_gateway logs to ShaTransactionLog and makes no live
# call. "sandbox"/"production": makes a real signed HTTP call — requires
# SHA_GATEWAY_ENDPOINT_URL and a signing key to also be configured.
SHA_GATEWAY_MODE = env("SHA_GATEWAY_MODE", default="stub")
SHA_GATEWAY_ENDPOINT_URL = env("SHA_GATEWAY_ENDPOINT_URL", default="")
SHA_GATEWAY_SIGNING_KEY_PATH = env("SHA_GATEWAY_SIGNING_KEY_PATH", default="")

# ── Data Protection Act compliance (docs/09-SECURITY-COMPLIANCE.md §9.5) ──
# Statutory minimum retention for clinical records — confirm the exact
# figure with legal/DHA guidance before production go-live (§9.6 notes the
# same 7-year figure for backup cold-storage archives).
CLINICAL_RECORD_MINIMUM_RETENTION_YEARS = env.int(
    "CLINICAL_RECORD_MINIMUM_RETENTION_YEARS", default=7
)

# Terminology mirror sync sources (docs/08-DHA-SHA-INTEGRATION.md §8.2) —
# empty by default; apps.dha_interop.sync honestly records a
# SKIPPED_NOT_CONFIGURED run rather than fabricating a sync when unset.
ICD11_SYNC_SOURCE_URL = env("ICD11_SYNC_SOURCE_URL", default="")
LOINC_SYNC_SOURCE_URL = env("LOINC_SYNC_SOURCE_URL", default="")
NATIONAL_DRUG_INDEX_SYNC_SOURCE_URL = env("NATIONAL_DRUG_INDEX_SYNC_SOURCE_URL", default="")

# ── Observability (docs/12-DEVOPS-DEPLOYMENT.md §12.5) ────────────────────
# Structured JSON logging in every environment except local dev (where a
# human-readable console renderer is more useful) — django_structlog's
# RequestMiddleware (above) binds request_id/user_id into every line.
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.filter_by_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
    ],
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": structlog.stdlib.ProcessorFormatter,
            "processor": structlog.processors.JSONRenderer(),
        },
        "console": {
            "()": structlog.stdlib.ProcessorFormatter,
            "processor": structlog.dev.ConsoleRenderer(colors=True),
        },
    },
    "handlers": {
        "default": {
            "class": "logging.StreamHandler",
            "formatter": "console" if DEBUG else "json",
        },
    },
    "root": {
        # Catches app-code loggers too (structlog.get_logger(__name__) in
        # any apps/* module) — without this, only the two names below would
        # ever reach a handler.
        "handlers": ["default"],
        "level": "INFO",
    },
    "loggers": {
        "django_structlog": {"handlers": ["default"], "level": "INFO", "propagate": False},
        "django": {"handlers": ["default"], "level": "INFO", "propagate": False},
    },
}

# Error tracking — empty SENTRY_DSN (the default) means init_sentry() no-ops,
# consistent with this project's honest-stub pattern for unconfigured
# third-party integrations.
SENTRY_DSN = env("SENTRY_DSN", default="")
SENTRY_ENVIRONMENT = env("SENTRY_ENVIRONMENT", default="development")
SENTRY_RELEASE = env("SENTRY_RELEASE", default="") or None
init_sentry(SENTRY_DSN, SENTRY_ENVIRONMENT, SENTRY_RELEASE)
