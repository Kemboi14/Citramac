import uuid

from django.db import models

from .managers import TenantScopedManager

# Never auto-registered against a tenant's email_domains (register_email_domain
# below) — a free-mail domain shared by millions of unrelated people can't be
# meaningfully "owned" by one organization, and doing so anyway makes every
# other user of that provider resolve to this org's branding at tenant
# discovery (apps.accounts.auth_views.TenantDiscoveryView).
PUBLIC_EMAIL_DOMAINS = frozenset(
    {
        "gmail.com",
        "yahoo.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "icloud.com",
        "aol.com",
        "protonmail.com",
        "gmx.com",
        "mail.com",
        "yandex.com",
        "zoho.com",
    }
)


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
        ("MENTAL_HEALTH_MHP", "Mental Health / MHP Centre"),
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

    # Self-service SMS gateway (Org Admin's own "SMS Configuration" settings
    # screen, right next to Email Configuration) — used for OTP-over-SMS
    # (apps.accounts.auth_views) and appointment reminders
    # (apps.client_registry.tasks.send_appointment_reminders). Onfon Media
    # (https://www.docs.onfonmedia.co.ke/rest/sms/) is the only gateway
    # wired up today (sms_provider exists so a second gateway can be added
    # later without another migration); blank sms_sender_id/sms_client_id
    # means "not configured", same fallback semantics as email_host: falls
    # back to PlatformSmsSettings, then settings.py's ONFON_* env vars, then
    # an honest stub log — see apps.notifications.sms.
    SMS_PROVIDER_CHOICES = [("onfon", "Onfon Media")]
    sms_provider = models.CharField(max_length=20, choices=SMS_PROVIDER_CHOICES, default="onfon")
    sms_sender_id = models.CharField(
        max_length=32,
        blank=True,
        help_text="Onfon 'Sender ID' — must be an Approved Sender ID on your Onfon account.",
    )
    sms_client_id = models.CharField(max_length=255, blank=True, help_text="Onfon 'Client ID'.")
    # Fernet-encrypted (apps/tenancy/crypto.py), same pattern as
    # email_host_password_encrypted — never round-tripped in plaintext via
    # the API.
    sms_access_key_encrypted = models.TextField(
        blank=True, help_text="Onfon 'Access Key' (sent as the AccessKey header)."
    )
    sms_api_key_encrypted = models.TextField(blank=True, help_text="Onfon 'API Key'.")

    def save(self, *args, **kwargs):
        self.is_active = self.status == self.STATUS_ACTIVE
        if self.email_domains:
            # Normalize on every save so a manually-typed "Cafric.org" in
            # Django admin still matches TenantDiscoveryView's casefolded
            # lookup (apps.accounts.auth_views._email_domain) — this field
            # used to be written with no normalization at all, so mixed-case
            # values already on a row would otherwise never match.
            normalized = []
            for domain in self.email_domains:
                cleaned = domain.strip().casefold()
                if cleaned and cleaned not in normalized:
                    normalized.append(cleaned)
            self.email_domains = normalized
        super().save(*args, **kwargs)

    def register_email_domain(self, email):
        """
        Ensures this org's `email_domains` includes the domain of `email` —
        call this whenever a real staff member (org_admin invite, staff
        invite, onboard_tenant/invite_staff CLI) is provisioned for this
        organization, so the tenant-branded login's discovery step
        (TenantDiscoveryView, apps.accounts.auth_views) can actually find
        this org for that person going forward instead of relying on an
        admin to remember to edit `email_domains` by hand (or an org
        created via the API, whose CreateOrganizationSerializer never had
        an email_domains field at all). A no-op if the domain is already
        registered (case-insensitively) — safe to call on every invite.

        Silently skipped (not an error — provisioning must still succeed)
        for two cases where registering would corrupt tenant discovery
        rather than help it: a public/free-mail domain (PUBLIC_EMAIL_DOMAINS
        above), and a domain another organization has already claimed —
        first claim wins, since TenantDiscoveryView's lookup can only ever
        return one organization for a given domain.
        """
        domain = (email or "").strip().rsplit("@", 1)[-1].casefold()
        if not domain or domain in PUBLIC_EMAIL_DOMAINS:
            return
        existing = {d.casefold() for d in self.email_domains}
        if domain in existing:
            return
        already_claimed = (
            type(self)
            .objects.exclude(pk=self.pk)
            .filter(email_domains__contains=[domain])
            .exists()
        )
        if already_claimed:
            return
        self.email_domains = [*self.email_domains, domain]
        self.save(update_fields=["email_domains"])

    @property
    def has_email_configured(self):
        return bool(self.email_host)

    @property
    def has_email_credentials(self):
        return bool(self.email_host_password_encrypted)

    @property
    def has_sms_configured(self):
        return bool(self.sms_sender_id and self.sms_client_id)

    @property
    def has_sms_credentials(self):
        return bool(self.sms_access_key_encrypted and self.sms_api_key_encrypted)

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
    # Platform-wide default primary/secondary accent (docs/03-DESIGN-SYSTEM.md
    # §3.6) — the baseline every user sees (including Super Admin, who has
    # no Organization to theme). An org's own theme_overrides
    # (Organization.theme_overrides) is applied on top of this, not instead
    # of it, for anyone who belongs to one.
    theme_overrides = models.JSONField(default=dict, blank=True)
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


class PlatformSmsSettings(models.Model):
    """
    Singleton (always pk=1): the platform-wide default Onfon Media SMS
    gateway credentials, used as the fallback for any tenant that hasn't
    configured its own via Organization.sms_* — see apps.notifications.sms
    for the org -> platform -> settings.py resolution order. Same singleton
    pattern as PlatformEmailSettings.
    """

    provider = models.CharField(
        max_length=20, choices=Organization.SMS_PROVIDER_CHOICES, default="onfon"
    )
    sender_id = models.CharField(max_length=32, blank=True)
    client_id = models.CharField(max_length=255, blank=True)
    # Fernet-encrypted (apps/tenancy/crypto.py).
    access_key_encrypted = models.TextField(blank=True)
    api_key_encrypted = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name_plural = "platform sms settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def has_credentials(self):
        return bool(self.access_key_encrypted and self.api_key_encrypted)

    def __str__(self):
        return "Platform SMS settings"


class Branch(TenantScopedModel):
    FACILITY_LEVEL_CHOICES = [
        ("L2", "Level 2"),
        ("L3", "Level 3"),
        ("L4", "Level 4"),
        ("L5", "Level 5"),
        ("L6", "Level 6"),
    ]
    MHP_STATUS_CHOICES = [
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
    mhp_registration_status = models.CharField(
        max_length=10, choices=MHP_STATUS_CHOICES, default="OPEN"
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


class Department(TenantScopedModel):
    """
    An organisational unit within a tenant — docs/04-MULTI-TENANCY.md §4.1's
    hierarchy stops at Branch, but real facilities subdivide further (a
    branch's Nursing department, Pharmacy, Records, etc.). Deliberately not
    required to belong to a Branch at creation time: a department can be
    created first and assigned/reassigned afterward (Org Admin's Branches &
    Departments screen), so `branch` is nullable rather than `PROTECT`.
    """

    branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, null=True, blank=True, related_name="departments"
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta(TenantScopedModel.Meta):
        ordering = ["name"]

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
