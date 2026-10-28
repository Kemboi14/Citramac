"""
Base Django settings shared by every environment.

Environment-specific settings (dev/staging/production) import from this
module and override only what differs, per docs/02-TECH-STACK-AND-ARCHITECTURE.md §2.5.
"""

from pathlib import Path

import environ
import structlog
from celery.schedules import crontab

from config.metrics import init_custom_metrics
from config.observability import init_sentry

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="django-insecure-change-me-in-env")

# Fernet key for at-rest encryption of tenant secrets (apps/tenancy/crypto.py),
# e.g. Branch.sha_api_credentials_encrypted — docs/04-MULTI-TENANCY.md §4.5.
# Dev/test default is fixed (NOT secret) so migrations/fixtures are
# reproducible across a fresh clone; every real environment must set a real
# generated key (`python -c "from cryptography.fernet import Fernet;
# print(Fernet.generate_key().decode())"`) via FIELD_ENCRYPTION_KEY.
FIELD_ENCRYPTION_KEY = env(
    "FIELD_ENCRYPTION_KEY", default="9Z1XUaU8qUf7ln091SpHloEM-TCNclM3dVaFT5ZtpuA="
)

DEBUG = env.bool("DJANGO_DEBUG", default=False)

# "localhost" is always allowed regardless of DJANGO_ALLOWED_HOSTS — k8s's
# kubelet sends liveness/readiness probes straight to the pod IP (never
# through the Service/Ingress), with the Host header patched to "localhost"
# (see infra/k8s/base/backend-deployment.yaml's probe httpHeaders) since the
# real public hostname isn't known to a generic probe definition.
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[]) + ["localhost"]

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
    "django_prometheus",
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
# This deployment is strictly a mental-health/MHP facility (CAfRIC), not a
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
    "apps.mhp_program",
    "apps.dha_interop",
    "apps.notifications",
    "apps.offline_sync",
    "apps.security",
    "apps.retention",
    "apps.care_pathway",
    "apps.compliance",
    "apps.documents",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# Custom user model — UUID pk, email/staff_id based, no username field.
# See docs/06-DATA-MODEL.md §6.1.
AUTH_USER_MODEL = "accounts.User"

# Session auth (Django admin) needs the tenant-context-aware lookup — see
# apps.accounts.backends.TenantAwareModelBackend's docstring for why the
# stock ModelBackend can't resolve a user before tenant context exists.
AUTHENTICATION_BACKENDS = ["apps.accounts.backends.TenantAwareModelBackend"]

MIDDLEWARE = [
    # Request-latency timer — must be the very first middleware so its
    # timing wraps every other middleware below, per django-prometheus's own
    # setup docs. Paired with PrometheusAfterMiddleware at the end of this
    # list. docs/12-DEVOPS-DEPLOYMENT.md §12.5's request-latency/error-rate
    # metrics.
    "django_prometheus.middleware.PrometheusBeforeMiddleware",
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
    # Must be the very last middleware — records the response status/latency
    # after everything else (including RequestMiddleware) has run.
    "django_prometheus.middleware.PrometheusAfterMiddleware",
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
# django-prometheus's wrapper engine, not a different database — exposes
# query-count/latency and connection-pool metrics (docs/12-DEVOPS-DEPLOYMENT.md
# §12.5's "DB connection pool saturation") by proxying the real backend below.
DATABASES["default"]["ENGINE"] = "django_prometheus.db.backends.postgresql"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    # Absolute floor — stays even if SecurityPolicy.minimum_password_length is
    # ever misconfigured lower than this by an admin.
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
    # Live-reads SecurityPolicy.get_solo() (Super Admin's Security Policies
    # screen) at validation time — length/complexity/history, on top of the
    # static floor above.
    {"NAME": "apps.security.password_validators.SecurityPolicyPasswordValidator"},
]

# Argon2 primary hasher, per docs/09-SECURITY-COMPLIANCE.md §9.2.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
# Wall-clock zone of the facilities (deployment configuration, not a clinical
# code): naive facility times — a group session's date + start time, MAR dose
# slots, "today" — are read in this zone and stored as UTC instants. See
# apps/care_pathway/facility_time.py. The current deployment serves Kenyan
# facilities; a deployment elsewhere sets FACILITY_TIME_ZONE in its env.
FACILITY_TIME_ZONE = env("FACILITY_TIME_ZONE", default="Africa/Nairobi")
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

# ── Upload size ceiling ────────────────────────────────────────────────────
# Django's own default (2.5MB) is well below what a real source logo or a
# scanned clinical document needs — raised to match the ingress's
# `proxy-body-size` (infra/k8s/base/ingress.yaml) and the per-field limits in
# apps.tenancy.views (logo) and apps.client_registry.serializers (attachment).
# UPLOAD_MAX_SIZE_BYTES is the actual business limit those validators enforce
# (30MB); DATA_UPLOAD_MAX_MEMORY_SIZE/FILE_UPLOAD_MAX_MEMORY_SIZE are set a
# little higher to give multipart overhead (boundaries, other form fields)
# room — otherwise a request right at the 30MB line would trip Django's own
# request-parsing guard first, returning its generic error page instead of
# the field validators' friendly `{"error": {code, message}}` JSON.
UPLOAD_MAX_SIZE_BYTES = 30 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = UPLOAD_MAX_SIZE_BYTES + (2 * 1024 * 1024)
FILE_UPLOAD_MAX_MEMORY_SIZE = DATA_UPLOAD_MAX_MEMORY_SIZE

# Profile pictures (User.avatar, Patient.photo) are a much smaller, distinct
# ceiling from general clinical-document uploads above — no reason to allow
# a 30MB "avatar".
AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024

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
    # Normalizes every raised exception whose DRF default shape is a bare
    # {"detail": "..."} (AuthenticationFailed, PermissionDenied, Http404,
    # Throttled, ...) into the app's own {"error": {code, message}} shape —
    # see config/exceptions.py's module docstring for scope and why this
    # matters to the frontend.
    "EXCEPTION_HANDLER": "config.exceptions.custom_exception_handler",
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
    # Durable HIE outbox (CLAUDE.md §4): deliver queued / retry-due resources.
    "drain-hie-outbox": {
        "task": "apps.dha_interop.tasks.drain_hie_outbox",
        "schedule": crontab(minute="*/5"),
    },
    # HIE status callbacks are applied as they arrive; this sweeps any left
    # unapplied (worker down at receipt).
    "apply-pending-sha-callbacks": {
        "task": "apps.insurance_claims.tasks.apply_pending_sha_callbacks",
        "schedule": crontab(minute="*/10"),
    },
    "recheck-facility-registry-nightly": {
        "task": "apps.dha_interop.tasks.recheck_facility_registry",
        "schedule": crontab(hour=3, minute=0),
    },
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
    # Appointments Calendar email reminders (docs/07-CLINICAL-MODULES-SPEC.md
    # §7.1) — runs every 15 minutes so a reminder goes out close to the
    # APPOINTMENT_REMINDER_HOURS_BEFORE mark, and quickly for same-day
    # bookings made inside that window. See apps/client_registry/tasks.py.
    "send-appointment-reminders": {
        "task": "apps.client_registry.tasks.send_appointment_reminders",
        "schedule": crontab(minute="*/15"),
    },
    # Time-bound (locum/fixed-term) account access — deactivates any User
    # whose access_ends_at has passed, so `is_active` reflects an expired
    # grant even for someone who never attempts to log in again. Hourly is
    # the enforcement granularity; the reactive checks in
    # authentication.py/auth_views.py close the gap between runs for anyone
    # who *does* attempt to use an already-expired session.
    "enforce-access-windows": {
        "task": "apps.accounts.tasks.enforce_access_windows",
        "schedule": crontab(minute=0),
    },
    # SecurityPolicy.data_retention_years — deliberately scoped to ephemeral
    # auth artifacts only (OTPs, activation/password-setup tokens, expired
    # JWT blacklist rows), NOT clinical/patient records or the audit trail.
    # See apps.security.tasks.purge_expired_auth_artifacts' own docstring for
    # the full scope rationale.
    "purge-expired-auth-artifacts": {
        "task": "apps.security.tasks.purge_expired_auth_artifacts",
        "schedule": crontab(hour=3, minute=0),
    },
    # Tenant subscription lifecycle — reminders before the period ends,
    # PAST_DUE/grace, then EXPIRED (read-only). 05:00 UTC = 08:00 EAT, so
    # reminders land at the start of the working day. See
    # apps/tenancy/subscription_lifecycle.py.
    # Breach notification deadlines (48h facility / 48h Digital Health
    # Agency / 72h ODPC) — checked every 30 minutes so a reminder lands well
    # inside the window. See apps/compliance/tasks.py.
    "remind-breach-notification-deadlines": {
        "task": "apps.compliance.tasks.remind_breach_notification_deadlines",
        "schedule": crontab(minute="*/30"),
    },
    "process-subscription-lifecycle": {
        "task": "apps.tenancy.tasks.process_subscription_lifecycle",
        "schedule": crontab(hour=5, minute=0),
    },
    # Branch facility licence renewal reminders to Org Admins, at each of
    # FACILITY_LICENSE_REMINDER_DAYS before expiry and once it has expired.
    # See apps/tenancy/facility_licence.py.
    "remind-facility-licence-renewals": {
        "task": "apps.tenancy.tasks.remind_facility_licence_renewals",
        "schedule": crontab(hour=5, minute=10),
    },
    # Records retention scan — proposes archive batches for Org Admin
    # approval and sends coming-due notices; never archives on its own.
    # Weekly, Monday 01:00 UTC. See apps/retention/services.py.
    "run-retention-scan": {
        "task": "apps.retention.tasks.run_retention_scan",
        "schedule": crontab(day_of_week=1, hour=1, minute=0),
    },
    # Durable outbox sweep for notification email/SMS — re-attempts
    # deliveries that failed or whose queued task was lost.
    "retry-pending-notification-deliveries": {
        "task": "apps.notifications.tasks.retry_pending_deliveries",
        "schedule": crontab(minute="*/10"),
    },
    # Legal admission status (master prompt LGL-WF-03): review-due / expiry
    # alerts and notice-period risk prompts. See apps/care_pathway/tasks.py.
    "sweep-legal-statuses": {
        "task": "apps.care_pathway.tasks.sweep_legal_statuses",
        "schedule": crontab(minute=5),
    },
}

# How far ahead of an appointment its one reminder email goes out.
APPOINTMENT_REMINDER_HOURS_BEFORE = env.int("APPOINTMENT_REMINDER_HOURS_BEFORE", default=24)

# Configuration: days before a branch's facility licence expires
# (Branch.facility_license_valid_until) that its Org Admins are reminded; 0 is
# the expiry day itself. The largest value is also the window in which a
# licence shows as "expiring". Comma-separated in the environment.
FACILITY_LICENSE_REMINDER_DAYS = env.list(
    "FACILITY_LICENSE_REMINDER_DAYS", cast=int, default=[60, 30, 7, 0]
)

# ── Cache (rate limiting for the auth flow, docs/05-AUTHENTICATION-FLOW.md §5.5) ──
CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": env("REDIS_URL", default="redis://localhost:6379/1"),
    }
}

# ── Email (OTP dispatch via Mailhog in dev, see docs/12-DEVOPS-DEPLOYMENT.md §12.1) ──
# EMAIL_HOST_USER/PASSWORD were missing entirely before this — any real mail
# server (including a plain cPanel mailbox) requires SMTP AUTH, so without
# these Django would attempt an unauthenticated connection and every send
# would fail. EMAIL_USE_SSL covers the cPanel-style implicit-TLS port 465
# alongside EMAIL_USE_TLS's STARTTLS port 587 — set whichever one your mail
# server actually uses via env vars; Django errors clearly if both are true.
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env("EMAIL_HOST", default="localhost")
EMAIL_PORT = env.int("EMAIL_PORT", default=1025)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=False)
EMAIL_USE_SSL = env.bool("EMAIL_USE_SSL", default=False)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-reply@citramac.local")

# ── SMS (OTP + appointment reminders via Onfon Media, see apps/notifications/sms.py) ──
# Platform-wide fallback gateway credentials for any tenant that hasn't
# configured its own under Organization.sms_* — same "opt into as much as
# you configure" resolution order as email above (org -> PlatformSmsSettings
# -> these env vars -> honest stub log if nothing is set anywhere).
ONFON_SENDER_ID = env("ONFON_SENDER_ID", default="")
ONFON_CLIENT_ID = env("ONFON_CLIENT_ID", default="")
ONFON_ACCESS_KEY = env("ONFON_ACCESS_KEY", default="")
ONFON_API_KEY = env("ONFON_API_KEY", default="")

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=["http://localhost:5173"])
# The frontend needs the httpOnly refresh_token cookie sent/received cross-origin
# (localhost:5173 -> localhost:8000 in dev) — see apps/accounts/auth_views.py.
CORS_ALLOW_CREDENTIALS = True
# X-Branch-Id: the branch the user is working in (apps.accounts.access).
from corsheaders.defaults import default_headers  # noqa: E402

CORS_ALLOW_HEADERS = (*default_headers, "x-branch-id")

# The frontend's own public origin — used to build links that go out in
# emails (e.g. the activation link in send_invite_email), since those are
# rendered server-side with no request/Origin header to infer it from.
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:5173")

# ── Security headers (docs/09-SECURITY-COMPLIANCE.md §9.7) ───────────────
# X-Frame-Options comes from XFrameOptionsMiddleware (default DENY);
# Content-Security-Policy/Referrer-Policy/Permissions-Policy come from
# config.middleware.SecurityHeadersMiddleware; HSTS is staging/production-only
# (config/settings/staging.py, production.py) since it doesn't apply over
# the plain-http dev server.
SECURE_CONTENT_TYPE_NOSNIFF = True

# ── DHA/SHA interoperability ──────────────────────────────────────────────
# One middleware serves the registries, eligibility, claims, consent and the
# Shared Health Record (apps/dha_interop/hie_spec/, fetched from
# hie-docs.dha.go.ke). Super Admin's saved settings (tenancy.PlatformHieSettings)
# win; these environment values are the fallback. With no base URL or client
# credentials every call reports "not configured" — never a silent success.
# The production base URL is issued by DHA at onboarding (hie_spec/SOURCE.md);
# the UAT one is the server URL printed in every published spec.
HIE_API_BASE_URL = env("HIE_API_BASE_URL", default="")
HIE_API_CLIENT_ID = env("HIE_API_CLIENT_ID", default="")
HIE_API_CLIENT_SECRET = env("HIE_API_CLIENT_SECRET", default="")
HIE_API_TIMEOUT_SECONDS = env.int("HIE_API_TIMEOUT_SECONDS", default=30)
# Values of eligibility `schemes[].coverage.status` that mean the member's cover
# is active. VERIFY: DHA publishes no enum for this field (hie_spec/SOURCE.md
# gap 3) — empty until confirmed against a real UAT response, so no member is
# marked premium-compliant on a guessed string.
SHA_ACTIVE_COVERAGE_STATUSES = env.list("SHA_ACTIVE_COVERAGE_STATUSES", default=[])
# FHIR Identifier.system per identifier kind (apps.client_registry.PatientIdentifier).
# NATIONAL_ID and SHA_MEMBER default to the Kenya Core Patient profile's
# identifier slices (fhir_validation/kenya_core/ke.fhir.core-1.0.0.tgz,
# kenya-core-patient: nationalId / shaNumber patternUri) — a test pins them to
# the package. VERIFY: PASSPORT, REFUGEE_ID, UNHCR, ALIEN_ID,
# BIRTH_CERTIFICATE, IPRS_UPI and CLIENT_REGISTRY_ID have no system in that IG —
# they stay empty, and an identifier with no configured system is left out of
# outbound FHIR (and the omission is logged) rather than sent under an invented URI.
# CITRAMAC / TEMPORARY / UHID are our own namespaces: set FHIR_LOCAL_SYSTEM_BASE
# to a URI the organisation controls (project owner decision). UHID is made
# per-organisation as <base>/uhid/<org-slug>.
FHIR_LOCAL_SYSTEM_BASE = env("FHIR_LOCAL_SYSTEM_BASE", default="")
_KENYA_CORE_IDENTIFIER_SYSTEMS = {
    "NATIONAL_ID": "https://fhir.dha.go.ke/fhir/identifier/nationalid",
    "SHA_MEMBER": "https://fhir.dha.go.ke/fhir/identifier/shanumber",
}
FHIR_NATIONAL_IDENTIFIER_SYSTEMS = {
    kind: env(f"FHIR_SYSTEM_{kind}", default=_KENYA_CORE_IDENTIFIER_SYSTEMS.get(kind, ""))
    for kind in (
        "NATIONAL_ID",
        "PASSPORT",
        "REFUGEE_ID",
        "UNHCR",
        "ALIEN_ID",
        "BIRTH_CERTIFICATE",
        "IPRS_UPI",
        "SHA_MEMBER",
        "CLIENT_REGISTRY_ID",
    )
}
# Who may do what clinically (prescribe, co-sign, see restricted content,
# manage finance, authorise documents, …) is no longer a settings role list: each
# ability is a permission in apps/accounts/catalogue.py, granted to roles by the
# Org Admin in Roles & Permissions.
# Psychotherapy session note dictation (master prompt X-12). The browser Web
# Speech API sends audio to the browser vendor's speech service in most
# browsers. This is the platform kill switch only: dictation is off for every
# organisation until Super Admin allows it and that organisation's Org Admin
# turns it on after its data-protection review (Organization.psy_dictation_*).
PSYCHOTHERAPY_DICTATION_ENABLED = env.bool("PSYCHOTHERAPY_DICTATION_ENABLED", default=True)
# Psychotherapy note AI assistance (Kiswahili/Sheng → English translation and
# trauma-informed rewording of the generated note sections). When used, the
# clinician's session text is sent server-side to the Anthropic API (the
# browser never calls a model). Platform kill switch + API key here; then, per
# organisation, Super Admin allows and the Org Admin turns on
# (Organization.psy_ai_*), and per client a recorded "AI-assisted note
# processing" consent of Yes is required (care_pathway/psy_ai.py). VERIFY
# before allowing an organisation: the data-processing agreement with Anthropic
# and the organisation's own data-protection review. Otherwise the note is
# organised by the rule-based organiser (care_pathway/psy_organizer.py).
PSYCHOTHERAPY_AI_ENABLED = env.bool("PSYCHOTHERAPY_AI_ENABLED", default=True)
# From the environment only — never committed. A key saved by Super Admin under
# AI Settings (tenancy.PlatformAiSettings, encrypted) takes precedence.
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", default="")
PSYCHOTHERAPY_AI_MODEL = env("PSYCHOTHERAPY_AI_MODEL", default="claude-opus-5-5")
# Per-request timeout (seconds) for the background translation / rewording task.
PSYCHOTHERAPY_AI_TIMEOUT = env.int("PSYCHOTHERAPY_AI_TIMEOUT", default=60)
# DOC-CI-07: investigations per medication, {"<national drug index code>":
# ["<LOINC code>", ...]}. Facility configuration only — no monitoring schedule
# ships in code (CLAUDE.md §6). Empty = the clinician selects the tests.
DOC_MEDICATION_MONITORING = env.json("DOC_MEDICATION_MONITORING", default={})
# Interventions — VERIFY every value against the facility's own policy; these
# are the owner's mockup defaults, labelled illustrative there.
# Continuous-observation maximum minutes per observer before rotation.
OBS_MAX_CONTINUOUS_MINUTES = env.int("OBS_MAX_CONTINUOUS_MINUTES", default=120)
# Timed monitoring checks after a restrictive-practice episode: minutes after
# the start, by kind. Empty list = no automatic checks scheduled.
RESTRICTIVE_CHECK_MINUTES = {
    "RAPID_TRANQUILLISATION": [15, 30, 45, 60],
    "RESTRAINT": [15, 30],
    "SECLUSION": [120, 240, 360, 480],
}
# Seclusion duration (minutes) that triggers an independent senior review.
SECLUSION_MAX_MINUTES = env.int("SECLUSION_MAX_MINUTES", default=480)
# Days after which a repeat PHQ-9 / GAD-7 is flagged as due. VERIFY: clinical
# policy — unset flags none.
MEASURE_REPEAT_DAYS = None

# Statutory forms offered in the record: [{"key", "title", "signer_roles": [...]}].
# VERIFY: form numbers, titles and who may sign come from the regulator — unset
# offers no forms.
LEGAL_FORM_CATALOGUE = []

# Legal admission status (master prompt §7A): the versioned jurisdiction config
# in apps/care_pathway/jurisdiction_config/<name>.json — statutory wording is
# rendered from it verbatim. LEGAL_STATUS_OVERRIDES may override operational
# values only (e.g. {"reviewLeadDays": 21, "requiredRecommendations": 2}).
LEGAL_JURISDICTION_CONFIG = env("LEGAL_JURISDICTION_CONFIG", default="KE-MHA-FORMS-1")
LEGAL_STATUS_OVERRIDES = {}

# Lab order sets and the write-back of results into the intake physical baseline
# need LOINC codes that must come from the facility/terminology server.
LAB_ORDER_SETS = {}
INTAKE_LAB_WRITEBACK = {}  # {"<LOINC code>": "qtc" | "egfr" | "tsh"}

# Minutes a client may wait after triage before a clinician sees them, by priority
# colour, e.g. {"RED": 0, "ORANGE": 15}. VERIFY: facility policy — unset shows no
# "over target" flag (a wait is still shown).
SEEN_BY_CLINICIAN_TARGET_MINUTES = {}

# Follow-up schedule generated when an episode closes as a planned discharge, e.g.
# [{"reason": "POST_DISCHARGE", "after_hours": 72, "mode": "PHONE"}]. VERIFY: the
# facility's own protocol decides the steps and intervals — unset generates none.
FOLLOW_UP_SCHEDULE = []

# Withdrawal-chart protocol. VERIFY: the facility's own withdrawal protocol
# defines these — they are deliberately UNSET (None), and unset means the chart
# is scored and banded but no threshold banner or due-time is generated.
#   prn_threshold      score at/above which the protocol calls for a PRN dose
#   severe_threshold   score at/above which urgent medical review is requested
#   rescore_minutes_high / _low   re-score interval at/above vs below prn_threshold
WITHDRAWAL_PROTOCOL = {
    code: {
        "prn_threshold": None,
        "severe_threshold": None,
        "rescore_minutes_high": None,
        "rescore_minutes_low": None,
    }
    for code in ("CIWA", "COWS")
}
# Confidentiality code applied to psychiatric / substance-use content
# (meta.security). "R" (restricted) from HL7 v3-Confidentiality — the Shared
# Health Record's label catalogue (hie_spec/guides/sharedHealthRecord__…intro.md:
# "N and R for confidentiality, plus the sensitivity codes such as HIV, PSY and
# SUD") confirms R is the restricted code the national exchange recognises.
FHIR_PSYCH_CONFIDENTIALITY_CODE = env("FHIR_PSYCH_CONFIDENTIALITY_CODE", default="R")

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

# Celery queue depth + SHA failure-rate gauges — see config/metrics.py.
init_custom_metrics()
