import structlog
from celery import shared_task
from django.db.models import Q
from django.utils import timezone

from apps.tenancy.context import platform_admin_context

logger = structlog.get_logger(__name__)


@shared_task
def purge_expired_auth_artifacts():
    """
    Periodic scan (CELERY_BEAT_SCHEDULE, daily) enforcing
    SecurityPolicy.data_retention_years — same platform_admin_context()
    pattern as apps.accounts.tasks.enforce_access_windows.

    Deliberately scoped to ephemeral auth plumbing only — OneTimePassword,
    ActivationInvite, PasswordSetupToken (all already used-or-expired, just
    old ones that lingered), plus simplejwt's own OutstandingToken/
    BlacklistedToken rows past their own expiry (equivalent to simplejwt's
    `flushexpiredtokens` management command). This does NOT touch clinical/
    patient records, Organization/User rows, or AuditLogEntry (the audit
    trail is a distinct, longer-retention safety control per CLAUDE.md, not
    shortened by this policy) — a real clinical-data retention policy is a
    separate decision requiring per-resource rules, not something to infer
    from one platform-wide integer.

    Bulk-deleted (not per-row like enforce_access_windows) since none of
    these models are wired into apps.sysadmin_audit's signal-based audit
    trail — they're throwaway auth tokens, not identity/clinical records.
    """
    from apps.accounts.models import ActivationInvite, OneTimePassword, PasswordSetupToken
    from apps.security.models import SecurityPolicy

    policy = SecurityPolicy.get_solo()
    now = timezone.now()
    cutoff = now - timezone.timedelta(days=365 * policy.data_retention_years)

    counts = {}
    with platform_admin_context():
        counts["otp"], _ = OneTimePassword.objects.filter(
            created_at__lt=cutoff
        ).filter(Q(is_used=True) | Q(expires_at__lt=now)).delete()

        counts["activation_invite"], _ = ActivationInvite.objects.filter(
            created_at__lt=cutoff
        ).filter(Q(used_at__isnull=False) | Q(expires_at__lt=now)).delete()

        counts["password_setup_token"], _ = PasswordSetupToken.objects.filter(
            created_at__lt=cutoff
        ).filter(Q(used_at__isnull=False) | Q(expires_at__lt=now)).delete()

    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

    # Not gated by data_retention_years — token expiry is already short-lived
    # by design (session_timeout_minutes), this is just standard housekeeping
    # equivalent to simplejwt's own `flushexpiredtokens` command.
    # BlacklistedToken rows cascade-delete with their OutstandingToken
    # (OneToOneField, on_delete=CASCADE) — nothing extra needed for those.
    counts["outstanding_token"], _ = OutstandingToken.objects.filter(expires_at__lt=now).delete()

    total = sum(counts.values())
    if total:
        logger.info("auth_artifacts_purged", total=total, **counts)
    return counts
