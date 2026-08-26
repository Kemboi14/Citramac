import uuid

from django.db import models

# Mandatory platform controls (citramac_SUPER-ADMIN.html "Mandatory Platform
# Controls" — always-on, structural, not stored as DB rows: tenant isolation
# is the RLS policies in apps.tenancy.rls, RBAC is the Role/Permission model,
# audit logging is apps.sysadmin_audit's signal wiring, API auth is DRF's
# global IsAuthenticated default, encryption in transit is TLS termination
# at the ingress (infra/k8s), encryption at rest is the DB volume + Fernet
# field encryption (apps.tenancy.crypto). Represented here as a constant so
# there's one place the Security Policies screen's "Enforced by Citramac"
# panel reads from — not because it's ever meant to be edited.
MANDATORY_CONTROLS = {
    "tenant_isolation": True,
    "rbac_enforcement": True,
    "audit_logging": True,
    "api_authentication": True,
    "encryption_in_transit": True,
    "encryption_at_rest": True,
    "mfa_required": True,
}


class SecurityPolicy(models.Model):
    """
    Singleton (always pk=1): the platform-wide *configurable* security
    baseline every tenant inherits (citramac_SUPER-ADMIN.html "Tenant
    Configurable Controls"). Org Admins can tighten these within their own
    org (not modeled yet — no per-org override table exists), but never
    loosen below this floor; Super Admin is the only one who can move the
    floor itself, via SecurityPolicyView.
    """

    minimum_password_length = models.PositiveSmallIntegerField(default=12)
    password_complexity = models.CharField(
        max_length=255, default="Upper, lower, number and symbol"
    )
    password_expiry_days = models.PositiveSmallIntegerField(default=90)
    password_history_count = models.PositiveSmallIntegerField(default=5)
    max_failed_login_attempts = models.PositiveSmallIntegerField(default=5)
    lockout_duration_minutes = models.PositiveSmallIntegerField(default=30)
    session_timeout_minutes = models.PositiveSmallIntegerField(default=30)
    max_concurrent_sessions = models.PositiveSmallIntegerField(default=3)
    token_expiry_minutes = models.PositiveSmallIntegerField(default=60)
    rate_limit_per_minute = models.PositiveIntegerField(default=120)
    data_retention_years = models.PositiveSmallIntegerField(default=7)

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name_plural = "security policy"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Platform security baseline"


class SecurityAlert(models.Model):
    """
    Real, threshold-derived findings (never fabricated demo rows) —
    evaluated on read by apps.security.evaluate.evaluate_security_alerts()
    from actual AuditLogEntry/User data whenever the Security Dashboard or
    Alerts screen loads. organization_id is a plain UUID (not a FK), same
    rationale as AuditLogEntry: survives the referenced org's deletion, and
    None means a platform-wide finding.
    """

    SEVERITY_LOW = "LOW"
    SEVERITY_MEDIUM = "MEDIUM"
    SEVERITY_HIGH = "HIGH"
    SEVERITY_CRITICAL = "CRITICAL"
    SEVERITY_CHOICES = [
        (SEVERITY_LOW, "Low"),
        (SEVERITY_MEDIUM, "Medium"),
        (SEVERITY_HIGH, "High"),
        (SEVERITY_CRITICAL, "Critical"),
    ]

    STATUS_NEW = "NEW"
    STATUS_INVESTIGATING = "INVESTIGATING"
    STATUS_RESOLVED = "RESOLVED"
    STATUS_DISMISSED = "DISMISSED"
    STATUS_CHOICES = [
        (STATUS_NEW, "New"),
        (STATUS_INVESTIGATING, "Investigating"),
        (STATUS_RESOLVED, "Resolved"),
        (STATUS_DISMISSED, "Dismissed"),
    ]

    CATEGORY_FAILED_LOGINS = "FAILED_LOGINS"
    CATEGORY_MFA_ADOPTION = "MFA_ADOPTION"
    CATEGORY_CHOICES = [
        (CATEGORY_FAILED_LOGINS, "Failed login spike"),
        (CATEGORY_MFA_ADOPTION, "Low MFA adoption"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization_id = models.UUIDField(null=True, blank=True, db_index=True)
    category = models.CharField(max_length=32, choices=CATEGORY_CHOICES)
    severity = models.CharField(max_length=10, choices=SEVERITY_CHOICES)
    description = models.CharField(max_length=500)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_NEW)
    detected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-detected_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization_id", "category"],
                condition=models.Q(status__in=["NEW", "INVESTIGATING"]),
                name="one_open_alert_per_org_category",
            )
        ]

    def __str__(self):
        return f"{self.get_severity_display()} — {self.description[:60]}"
