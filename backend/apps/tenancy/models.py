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
    max_branches = models.IntegerField()
    max_staff_seats = models.IntegerField()
    included_modules = models.JSONField(default=list, blank=True)
    price_monthly = models.DecimalField(max_digits=14, decimal_places=2)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    facility_type = models.CharField(max_length=32, choices=FACILITY_TYPE_CHOICES)
    dha_facility_code = models.CharField(max_length=64, blank=True)
    sha_provider_code = models.CharField(max_length=64, blank=True)
    subscription_plan = models.ForeignKey(
        SubscriptionPlan, on_delete=models.PROTECT, null=True, blank=True
    )
    theme_overrides = models.JSONField(default=dict, blank=True)
    enabled_modules = models.JSONField(default=list, blank=True)
    isolation_mode = models.CharField(
        max_length=16, choices=ISOLATION_MODE_CHOICES, default="SHARED"
    )
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Branch(TenantScopedModel):
    FACILITY_LEVEL_CHOICES = [
        ("L2", "Level 2"),
        ("L3", "Level 3"),
        ("L4", "Level 4"),
        ("L5", "Level 5"),
        ("L6", "Level 6"),
    ]

    name = models.CharField(max_length=255)
    facility_level = models.CharField(max_length=2, choices=FACILITY_LEVEL_CHOICES)
    address = models.TextField(blank=True)
    county = models.CharField(max_length=100, blank=True)
    gps_coordinates = models.CharField(max_length=64, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta(TenantScopedModel.Meta):
        verbose_name_plural = "branches"

    def __str__(self):
        return f"{self.name} ({self.organization_id})"
