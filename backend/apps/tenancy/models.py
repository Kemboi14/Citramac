import uuid

from django.db import models

from .managers import TenantScopedManager


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class TenantScopedModel(TimestampedModel):
    """
    Base for every tenant-scoped table (docs/04-MULTI-TENANCY.md §4.2, §4.3).
    `objects` is the safe, auto-filtered manager; `all_objects` is the
    unfiltered manager Django uses internally (cascades, etc.) so those
    don't get silently short-circuited by tenant scoping.
    """

    # UUID primary keys platform-wide, per docs/06-DATA-MODEL.md §6.7 (avoids
    # sequential ID leakage across tenants, simplifies future sharding).
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        "tenancy.Organization", on_delete=models.PROTECT, db_index=True
    )

    objects = TenantScopedManager()
    all_objects = models.Manager()

    class Meta:
        abstract = True
        base_manager_name = "all_objects"


class SubscriptionPlan(models.Model):
    name = models.CharField(max_length=100)
    code = models.SlugField(max_length=32, unique=True)
    max_branches = models.IntegerField()
    max_staff_seats = models.IntegerField(null=True, blank=True, help_text="Blank = unlimited.")
    included_modules = models.JSONField(default=list, blank=True)
    price_monthly = models.DecimalField(max_digits=14, decimal_places=2)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["price_monthly"]

    def __str__(self):
        return self.name


class Organization(TimestampedModel):
    """The tenant itself — not tenant-scoped (it IS the tenant)."""

    FACILITY_TYPE_CHOICES = [
        ("GENERAL_HOSPITAL", "General Hospital"),
        ("MENTAL_HEALTH_CCP", "Mental Health / CCP Centre"),
        ("DISPENSARY", "Dispensary / Level 2-3"),
        ("CLINIC", "Outpatient Clinic"),
    ]
    ISOLATION_MODE_CHOICES = [
        ("SHARED", "Shared"),
        ("DEDICATED_DB", "Dedicated"),
    ]
    # CITRAMAC is sold beyond hospitals (school clinics, corporate wellness,
    # solo practitioners) — org_type is the tenant-vertical axis, orthogonal
    # to facility_type (which is a *clinical* facility classification that
    # only makes sense for org_type=HOSPITAL).
    ORG_TYPE_CHOICES = [
        ("HOSPITAL", "Hospital / Healthcare Provider"),
        ("SCHOOL", "School"),
        ("UNIVERSITY", "University"),
        ("CORPORATE", "Corporate"),
        ("INDIVIDUAL", "Individual Practitioner"),
    ]
    OWNERSHIP_CHOICES = [
        ("PRIVATE", "Private"),
        ("PUBLIC", "Public"),
        ("FAITH_BASED", "Faith-Based"),
        ("NGO", "NGO / Not-for-profit"),
        ("PARTNERSHIP", "Partnership"),
        ("OTHER", "Other"),
    ]
    STATUS_PENDING = "PENDING_VERIFICATION"
    STATUS_ACTIVE = "ACTIVE"
    STATUS_SUSPENDED = "SUSPENDED"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending Verification"),
        (STATUS_ACTIVE, "Active"),
        (STATUS_SUSPENDED, "Suspended"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    org_type = models.CharField(max_length=16, choices=ORG_TYPE_CHOICES, default="HOSPITAL")
    facility_type = models.CharField(max_length=32, choices=FACILITY_TYPE_CHOICES)
    ownership_type = models.CharField(max_length=16, choices=OWNERSHIP_CHOICES, default="PRIVATE")
    # The registration/identity code required of every org type — DHA MFL
    # code for hospitals, MoE registration for schools, CUE charter for
    # universities, BRS registration for corporates, professional council
    # license number for individual practitioners. Kept as one field/label
    # driven by org_type rather than five mutually-exclusive columns.
    dha_facility_code = models.CharField(max_length=64, blank=True)
    sha_provider_code = models.CharField(max_length=64, blank=True)
    county = models.CharField(max_length=100, blank=True)
    sub_county = models.CharField(max_length=100, blank=True)
    subscription_plan = models.ForeignKey(
        SubscriptionPlan, on_delete=models.PROTECT, null=True, blank=True
    )
    theme_overrides = models.JSONField(default=dict, blank=True)
    enabled_modules = models.JSONField(default=list, blank=True)
    isolation_mode = models.CharField(
        max_length=16, choices=ISOLATION_MODE_CHOICES, default="SHARED"
    )
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    # Kept in sync with `status` by save() below — several existing call
    # sites (admin, onboard_tenant, DHA sandbox seeding) already read/write
    # this boolean directly and predate `status`.
    is_active = models.BooleanField(default=True)
    mfl_verified_at = models.DateTimeField(null=True, blank=True)

    # Tenant-branded login (docs/14-TENANT-BRANDED-LOGIN-UX.md) — surfaced by
    # AuthTenantDiscoveryView before any credential is touched, so a staff
    # member sees their own org's mark, not a generic CITRAMAC page.
    email_domains = models.JSONField(
        default=list,
        blank=True,
        help_text="Email domains (e.g. 'cafric.org') that route to this tenant at login.",
    )
    logo_url = models.URLField(blank=True)
    login_image_url = models.URLField(
        blank=True, help_text="Optional background image for the tenant login panel."
    )
    tagline = models.CharField(max_length=255, blank=True)
    primary_color = models.CharField(
        max_length=7,
        default="#006e51",
        help_text=(
            "Hex color, e.g. #006e51 — overrides the default brand green "
            "on this tenant's login page only."
        ),
    )
    support_email = models.EmailField(blank=True)
    support_phone = models.CharField(max_length=32, blank=True)
    website = models.URLField(blank=True)

    # Self-service SMTP (Org Admin's own "Email Configuration" settings
    # screen) — lets a tenant send its own OTP/invite/notification email
    # through its own mail server instead of the platform default. Blank
    # email_host means "not configured"; apps.notifications.email falls
    # back to PlatformEmailSettings, then settings.py, in that order.
    email_host = models.CharField(max_length=255, blank=True)
    email_port = models.PositiveIntegerField(null=True, blank=True)
    email_host_user = models.CharField(max_length=255, blank=True)
    # Fernet-encrypted (apps/tenancy/crypto.py), same pattern as
    # Branch.sha_api_credentials_encrypted — never round-tripped in
    # plaintext via the API.
    email_host_password_encrypted = models.TextField(blank=True)
    email_use_tls = models.BooleanField(default=True)
    email_use_ssl = models.BooleanField(default=False)
    email_from_address = models.CharField(
        max_length=255,
        blank=True,
        help_text="e.g. 'Cafric Demo <notifications@cafric.org>'. Blank uses the platform default.",
    )

    def save(self, *args, **kwargs):
        self.is_active = self.status == self.STATUS_ACTIVE
        super().save(*args, **kwargs)

    @property
    def has_email_configured(self):
        return bool(self.email_host)

    @property
    def has_email_credentials(self):
        return bool(self.email_host_password_encrypted)

    def __str__(self):
        return self.name


class PlatformBranding(models.Model):
    """
    Singleton (always pk=1): the CITRAMAC-the-product mark shown across every
    shell's sidebar and the generic (no-tenant-resolved) login screen — e.g.
    Super Admin login, or any platform staff account. Distinct from
    Organization.logo_url, which is a specific *tenant's* own branding shown
    only on that tenant's branded login screen. Same singleton pattern as
    apps.security.SecurityPolicy.
    """

    logo = models.FileField(upload_to="platform/branding/", blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name_plural = "platform branding"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Platform branding"


class PlatformEmailSettings(models.Model):
    """
    Singleton (always pk=1): the platform-wide default SMTP used for
    Softlink Options' own platform staff email and as the fallback for any
    tenant that hasn't configured its own SMTP via Organization.email_* —
    see apps.notifications.email for the org -> platform -> settings.py
    resolution order. Same singleton pattern as PlatformBranding.
    """

    host = models.CharField(max_length=255, blank=True)
    port = models.PositiveIntegerField(null=True, blank=True)
    host_user = models.CharField(max_length=255, blank=True)
    # Fernet-encrypted (apps/tenancy/crypto.py).
    host_password_encrypted = models.TextField(blank=True)
    use_tls = models.BooleanField(default=True)
    use_ssl = models.BooleanField(default=False)
    default_from_email = models.CharField(max_length=255, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name_plural = "platform email settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def has_credentials(self):
        return bool(self.host_password_encrypted)

    def __str__(self):
        return "Platform email settings"


class Branch(TenantScopedModel):
    FACILITY_LEVEL_CHOICES = [
        ("L2", "Level 2"),
        ("L3", "Level 3"),
        ("L4", "Level 4"),
        ("L5", "Level 5"),
        ("L6", "Level 6"),
    ]
    CCP_STATUS_CHOICES = [
        ("OPEN", "Open"),
        ("WAITLIST", "Waitlist Only"),
        ("CLOSED", "Closed"),
    ]

    name = models.CharField(max_length=255)
    facility_level = models.CharField(max_length=2, choices=FACILITY_LEVEL_CHOICES)
    # Defaults to the parent org's ownership but is independently editable
    # from Branch Settings (citramac_ORG-admin.html) — Org Admin can write
    # their own Branch but never the parent Organization (that stays
    # Super-Admin-only, see OrganizationDetailView), so this lives here
    # rather than requiring cross-tier write access for one form field.
    ownership_type = models.CharField(
        max_length=16, choices=Organization.OWNERSHIP_CHOICES, default="PRIVATE"
    )
    address = models.TextField(blank=True)
    county = models.CharField(max_length=100, blank=True)
    sub_county = models.CharField(max_length=100, blank=True)
    gps_coordinates = models.CharField(max_length=64, blank=True)
    # Branch-level registration code (docs/04-MULTI-TENANCY.md §4.5) —
    # distinct from Organization.dha_facility_code, which is the org's own
    # top-level registration; a branch's MFL code identifies that specific
    # physical facility on the Master Facility List.
    mfl_code = models.CharField(max_length=64, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    email = models.EmailField(blank=True)
    outpatient_capacity_per_day = models.PositiveIntegerField(null=True, blank=True)
    ccp_registration_status = models.CharField(
        max_length=10, choices=CCP_STATUS_CHOICES, default="OPEN"
    )
    sha_claims_enabled = models.BooleanField(default=False)
    mpesa_paybill_enabled = models.BooleanField(default=False)
    sms_reminders_enabled = models.BooleanField(default=True)
    # Fernet-encrypted JSON blob (apps/tenancy/crypto.py) — SHA claims API
    # key/certificate, never round-tripped in plaintext via the API.
    sha_api_credentials_encrypted = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "branches"

    @property
    def has_sha_credentials(self):
        return bool(self.sha_api_credentials_encrypted)

    def __str__(self):
        return f"{self.name} ({self.organization_id})"


class Subscription(TenantScopedModel):
    """
    A tenant's SaaS billing subscription to CITRAMAC itself — distinct from
    `Organization.status` (account-provisioning status) and unrelated to
    patient/encounter billing (apps/billing). One active row per
    organization at a time.
    """

    BILLING_CYCLE_CHOICES = [("MONTHLY", "Monthly"), ("ANNUAL", "Annual")]
    STATUS_ACTIVE = "ACTIVE"
    STATUS_PAST_DUE = "PAST_DUE"
    STATUS_CANCELED = "CANCELED"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_PAST_DUE, "Past Due"),
        (STATUS_CANCELED, "Canceled"),
    ]

    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="+")
    billing_cycle = models.CharField(max_length=8, choices=BILLING_CYCLE_CHOICES, default="ANNUAL")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    seats_used = models.PositiveIntegerField(default=0)
    current_period_end = models.DateField()

    class Meta(TenantScopedModel.Meta):
        constraints = [
            models.UniqueConstraint(fields=["organization"], name="unique_subscription_per_org")
        ]

    @property
    def renewing_soon(self):
        from datetime import timedelta

        from django.utils import timezone

        return self.status == self.STATUS_ACTIVE and self.current_period_end <= (
            timezone.now().date() + timedelta(days=30)
        )

    def __str__(self):
        return f"{self.organization.name} — {self.plan.name}"
