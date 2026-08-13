"""
Base Django settings shared by every environment.

Environment-specific settings (dev/staging/production) import from this
module and override only what differs, per docs/02-TECH-STACK-AND-ARCHITECTURE.md §2.5.
"""

from pathlib import Path

import environ

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
]

# One entry per app in apps/, mirrors docs/02-TECH-STACK-AND-ARCHITECTURE.md §2.5.
# Apps are scaffolded ahead of their build phase (docs/11-ROADMAP-AND-PHASES.md) but
# stay logic-free until their phase begins.
LOCAL_APPS = [
    "apps.tenancy",
    "apps.accounts",
    "apps.client_registry",
    "apps.triage",
    "apps.clinical_encounter",
    "apps.lims",
    "apps.ris_pacs",
    "apps.pharmacy",
    "apps.ipd_ward",
    "apps.theatre",
    "apps.mch",
    "apps.billing",
    "apps.insurance_claims",
    "apps.mortuary",
    "apps.sysadmin_audit",
    "apps.ccp_program",
    "apps.dha_interop",
    "apps.notifications",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# Custom user model — UUID pk, email/staff_id based, no username field.
# See docs/06-DATA-MODEL.md §6.1.
AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
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
