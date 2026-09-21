import re

from rest_framework import serializers

from .crypto import encrypt_value
from .models import (
    Branch,
    Organization,
    PlatformBranding,
    PlatformEmailSettings,
    PlatformSmsSettings,
    Subscription,
    SubscriptionPlan,
)

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def validate_theme_overrides_shape(value):
    """
    Shared by OrganizationSerializer and OrganizationThemeSerializer — both
    expose the same `theme_overrides` field (Super Admin's Organizations
    drawer and Org Admin's Branch Settings respectively,
    docs/03-DESIGN-SYSTEM.md §3.6), so the validation must match: only
    `primary`/`secondary`, each a `#RRGGBB` hex string. Status colors are
    never part of this shape, so a tenant can never theme away what
    "danger" looks like.
    """
    if not isinstance(value, dict):
        raise serializers.ValidationError("Must be an object.")
    allowed_keys = {"primary", "secondary"}
    extra_keys = set(value) - allowed_keys
    if extra_keys:
        raise serializers.ValidationError(
            f"Unsupported key(s): {', '.join(sorted(extra_keys))}. Only "
            f"{', '.join(sorted(allowed_keys))} are allowed."
        )
    for key, color in value.items():
        if not isinstance(color, str) or not HEX_COLOR_RE.match(color):
            raise serializers.ValidationError(
                f"'{key}' must be a hex color like #006e51, got {color!r}."
            )
    return value


# Per org_type, which label + validation pattern the single "identity code"
# field (Organization.dha_facility_code) should use — mirrors the mockup's
# per-org-type Add Organization drawer (citramac_SUPER-ADMIN.html
# `orgTypeConfig`). Kept server-side too so validation isn't only a UI nicety.
IDENTITY_CODE_PATTERNS = {
    "HOSPITAL": (r"^MFL-\d{4,6}$", "DHA MFL Code", "Expected format: MFL-#####"),
    "SCHOOL": (
        r"^MOE-\d{2}-\d{2}-\d{2,4}$",
        "MoE Registration No.",
        "Expected format: MOE-##-##-###",
    ),
    "UNIVERSITY": (
        r"^CUE/[A-Z]{2,3}/\d{4}/\d{1,3}$",
        "CUE Charter No.",
        "Expected format: CUE/CH/YYYY/##",
    ),
    "CORPORATE": (r"^PVT-[A-Z0-9]{6,10}$", "BRS Registration No.", "Expected format: PVT-########"),
    "INDIVIDUAL": (
        r"^[A-Z]{2,5}-[A-Z0-9]{3,8}$",
        "Practitioner License No.",
        "Expected format: COUNCIL-ID, e.g. KMPDC-A12345",
    ),
}


class OrgAdminInviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    phone = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")


class CreateOrganizationSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    slug = serializers.SlugField(max_length=50)
    org_type = serializers.ChoiceField(choices=Organization.ORG_TYPE_CHOICES, default="HOSPITAL")
    facility_type = serializers.ChoiceField(
        choices=Organization.FACILITY_TYPE_CHOICES, required=False, allow_blank=True
    )
    ownership_type = serializers.ChoiceField(
        choices=Organization.OWNERSHIP_CHOICES, default="PRIVATE"
    )
    dha_facility_code = serializers.CharField(max_length=64, required=False, allow_blank=True)
    county = serializers.CharField(max_length=100, required=False, allow_blank=True)
    sub_county = serializers.CharField(max_length=100, required=False, allow_blank=True)
    subscription_plan_code = serializers.CharField(required=False, allow_blank=True)
    billing_cycle = serializers.ChoiceField(
        choices=Subscription.BILLING_CYCLE_CHOICES, default="ANNUAL"
    )
    # Branding (docs/14-TENANT-BRANDED-LOGIN-UX.md §14.3) — originally only
    # settable via Django admin or onboard_tenant's CLI flags; the Add
    # Organization drawer (citramac_SUPER-ADMIN-v4.html) lets Super Admin set
    # these at creation time too, same fields, same optionality.
    logo_url = serializers.URLField(required=False, allow_blank=True)
    tagline = serializers.CharField(max_length=255, required=False, allow_blank=True)
    primary_color = serializers.CharField(max_length=7, required=False, allow_blank=True)
    support_email = serializers.EmailField(required=False, allow_blank=True)
    support_phone = serializers.CharField(max_length=32, required=False, allow_blank=True)
    website = serializers.URLField(required=False, allow_blank=True)
    # App-wide theme (docs/03-DESIGN-SYSTEM.md §3.6) — composed into
    # Organization.theme_overrides on create. Distinct from primary_color
    # above, which only recolors the pre-login tenant login panel.
    theme_primary = serializers.CharField(max_length=7, required=False, allow_blank=True)
    theme_secondary = serializers.CharField(max_length=7, required=False, allow_blank=True)
    org_admin = OrgAdminInviteSerializer()

    def validate_slug(self, value):
        if Organization.objects.filter(slug=value).exists():
            raise serializers.ValidationError("An organization with this slug already exists.")
        return value

    def validate_theme_primary(self, value):
        if value and not HEX_COLOR_RE.match(value):
            raise serializers.ValidationError(f"Must be a hex color like #006e51, got {value!r}.")
        return value

    def validate_theme_secondary(self, value):
        if value and not HEX_COLOR_RE.match(value):
            raise serializers.ValidationError(f"Must be a hex color like #006e51, got {value!r}.")
        return value

    def validate(self, attrs):
        org_type = attrs.get("org_type", "HOSPITAL")
        if org_type == "HOSPITAL" and not attrs.get("facility_type"):
            raise serializers.ValidationError(
                {"facility_type": "Required for Hospital / Healthcare Provider organizations."}
            )
        code = attrs.get("dha_facility_code", "")
        pattern = IDENTITY_CODE_PATTERNS.get(org_type)
        if code and pattern and not re.match(pattern[0], code, re.I):
            raise serializers.ValidationError({"dha_facility_code": pattern[2]})
        return attrs


class OrganizationSerializer(serializers.ModelSerializer):
    identity_code_label = serializers.SerializerMethodField()
    branch_count = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = [
            "id",
            "name",
            "slug",
            "org_type",
            "facility_type",
            "ownership_type",
            "dha_facility_code",
            "identity_code_label",
            "sha_provider_code",
            "county",
            "sub_county",
            "status",
            "is_active",
            "mfl_verified_at",
            "enabled_modules",
            "branch_count",
            "created_at",
            "logo_url",
            "tagline",
            "primary_color",
            "support_email",
            "support_phone",
            "website",
            "theme_overrides",
        ]
        read_only_fields = ["is_active", "mfl_verified_at", "created_at"]

    def get_identity_code_label(self, obj):
        return IDENTITY_CODE_PATTERNS.get(obj.org_type, (None, "DHA MFL Code", None))[1]

    def get_branch_count(self, obj):
        count = getattr(obj, "branch_count", None)
        return count if count is not None else obj.branch_set.count()

    def validate_theme_overrides(self, value):
        return validate_theme_overrides_shape(value)


class OrganizationStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Organization.STATUS_CHOICES)


class BranchSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    ward_count = serializers.SerializerMethodField()
    bed_count = serializers.SerializerMethodField()
    has_sha_credentials = serializers.BooleanField(read_only=True)
    sha_api_credentials = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        help_text="Write-only. Set to store new SHA claims API credentials (encrypted at rest).",
    )

    class Meta:
        model = Branch
        fields = [
            "id",
            "organization",
            "organization_name",
            "name",
            "facility_level",
            "ownership_type",
            "address",
            "county",
            "sub_county",
            "gps_coordinates",
            "mfl_code",
            "phone",
            "email",
            "outpatient_capacity_per_day",
            "mhp_registration_status",
            "sha_claims_enabled",
            "mpesa_paybill_enabled",
            "sms_reminders_enabled",
            "has_sha_credentials",
            "sha_api_credentials",
            "is_active",
            "ward_count",
            "bed_count",
        ]
        read_only_fields = ["organization"]

    def get_ward_count(self, obj):
        return getattr(obj, "ward_count", None) or obj.ward_set.count()

    def get_bed_count(self, obj):
        if hasattr(obj, "bed_count"):
            return obj.bed_count
        from apps.ipd_ward.models import Bed

        return Bed.all_objects.filter(ward__branch=obj).count()

    def create(self, validated_data):
        credentials = validated_data.pop("sha_api_credentials", None)
        if credentials:
            validated_data["sha_api_credentials_encrypted"] = encrypt_value(credentials)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        credentials = validated_data.pop("sha_api_credentials", None)
        if credentials:
            validated_data["sha_api_credentials_encrypted"] = encrypt_value(credentials)
        return super().update(instance, validated_data)


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionPlan
        fields = [
            "id",
            "code",
            "name",
            "max_branches",
            "max_staff_seats",
            "included_modules",
            "price_monthly",
            "is_active",
        ]


class SubscriptionSerializer(serializers.ModelSerializer):
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    plan_name = serializers.CharField(source="plan.name", read_only=True)
    renewing_soon = serializers.BooleanField(read_only=True)

    class Meta:
        model = Subscription
        fields = [
            "id",
            "organization",
            "organization_name",
            "plan",
            "plan_name",
            "billing_cycle",
            "status",
            "seats_used",
            "current_period_end",
            "renewing_soon",
        ]


class PlatformBrandingSerializer(serializers.ModelSerializer):
    """
    citramac_SUPER-ADMIN-v4.html sidebar brand mark, uploaded once by Super
    Admin and shown across every shell + the generic login screen. `logo` is
    returned as an absolute URL (frontend and backend are different origins
    in dev) rather than the storage-relative path DRF's FileField gives by
    default.
    """

    logo = serializers.SerializerMethodField()

    class Meta:
        model = PlatformBranding
        fields = ["logo", "theme_overrides", "updated_at"]

    def validate_theme_overrides(self, value):
        return validate_theme_overrides_shape(value)

    def get_logo(self, obj):
        if not obj.logo:
            return None
        request = self.context.get("request")
        url = obj.logo.url
        return request.build_absolute_uri(url) if request else url


class PlatformEmailSettingsSerializer(serializers.ModelSerializer):
    """
    Super Admin's platform-wide SMTP fallback (Settings screen) — the
    Organization-level equivalent is OrganizationEmailSettingsSerializer.
    `host_password` is write-only and only ever encrypted-at-rest
    (apps/tenancy/crypto.py), same pattern as BranchSerializer's
    sha_api_credentials.
    """

    has_credentials = serializers.BooleanField(read_only=True)
    host_password = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        help_text="Write-only. Set to store a new SMTP password (encrypted at rest).",
    )

    class Meta:
        model = PlatformEmailSettings
        fields = [
            "host",
            "port",
            "host_user",
            "host_password",
            "has_credentials",
            "use_tls",
            "use_ssl",
            "default_from_email",
            "updated_at",
        ]

    def validate(self, attrs):
        use_tls = attrs.get("use_tls", getattr(self.instance, "use_tls", False))
        use_ssl = attrs.get("use_ssl", getattr(self.instance, "use_ssl", False))
        if use_tls and use_ssl:
            raise serializers.ValidationError(
                "use_tls and use_ssl are mutually exclusive — set only one."
            )
        return attrs

    def update(self, instance, validated_data):
        password = validated_data.pop("host_password", None)
        if password:
            validated_data["host_password_encrypted"] = encrypt_value(password)
        return super().update(instance, validated_data)


class OrganizationEmailSettingsSerializer(serializers.ModelSerializer):
    """
    Self-service SMTP configuration for a single tenant (Org Admin's own
    "Email Configuration" settings screen, or Super Admin editing it on a
    tenant's behalf) — a narrow field subset of Organization, mirroring
    BranchSerializer's write-only-encrypted-credential pattern.
    """

    has_email_credentials = serializers.BooleanField(read_only=True)
    email_host_password = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        help_text="Write-only. Set to store a new SMTP password (encrypted at rest).",
    )

    class Meta:
        model = Organization
        fields = [
            "email_host",
            "email_port",
            "email_host_user",
            "email_host_password",
            "has_email_credentials",
            "email_use_tls",
            "email_use_ssl",
            "email_from_address",
        ]

    def validate(self, attrs):
        use_tls = attrs.get("email_use_tls", getattr(self.instance, "email_use_tls", False))
        use_ssl = attrs.get("email_use_ssl", getattr(self.instance, "email_use_ssl", False))
        if use_tls and use_ssl:
            raise serializers.ValidationError(
                "email_use_tls and email_use_ssl are mutually exclusive — set only one."
            )
        return attrs

    def update(self, instance, validated_data):
        password = validated_data.pop("email_host_password", None)
        if password:
            validated_data["email_host_password_encrypted"] = encrypt_value(password)
        return super().update(instance, validated_data)


HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class OrganizationThemeSerializer(serializers.ModelSerializer):
    """
    Self-service org-wide brand accent (Org Admin's "Brand Colors" settings
    screen) — docs/03-DESIGN-SYSTEM.md §3.6. Also settable by Super Admin
    directly on `OrganizationSerializer` (the Organizations table's create
    +edit drawer) — this narrower endpoint exists so an Org Admin, who
    can't reach `OrganizationDetailView`'s broader Super-Admin-only PATCH,
    still has a scoped way to change just this one field on their own org.
    Distinct from `Organization.primary_color`, which only recolors the
    pre-login tenant login panel.
    """

    class Meta:
        model = Organization
        fields = ["theme_overrides"]

    def validate_theme_overrides(self, value):
        return validate_theme_overrides_shape(value)


class PlatformSmsSettingsSerializer(serializers.ModelSerializer):
    """
    Super Admin's platform-wide Onfon Media SMS gateway fallback (Settings
    screen) — the Organization-level equivalent is
    OrganizationSmsSettingsSerializer. `access_key`/`api_key` are write-only
    and only ever encrypted-at-rest (apps/tenancy/crypto.py), same pattern
    as PlatformEmailSettingsSerializer's host_password.
    """

    has_credentials = serializers.BooleanField(read_only=True)
    access_key = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        help_text="Write-only. Set to store a new Onfon Access Key (encrypted at rest).",
    )
    api_key = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        help_text="Write-only. Set to store a new Onfon API Key (encrypted at rest).",
    )

    class Meta:
        model = PlatformSmsSettings
        fields = [
            "provider",
            "sender_id",
            "client_id",
            "access_key",
            "api_key",
            "has_credentials",
            "updated_at",
        ]

    def update(self, instance, validated_data):
        access_key = validated_data.pop("access_key", None)
        if access_key:
            validated_data["access_key_encrypted"] = encrypt_value(access_key)
        api_key = validated_data.pop("api_key", None)
        if api_key:
            validated_data["api_key_encrypted"] = encrypt_value(api_key)
        return super().update(instance, validated_data)


class OrganizationSmsSettingsSerializer(serializers.ModelSerializer):
    """
    Self-service Onfon Media SMS gateway configuration for a single tenant
    (Org Admin's own "SMS Configuration" settings screen, or Super Admin
    editing it on a tenant's behalf) — a narrow field subset of
    Organization, mirroring OrganizationEmailSettingsSerializer.
    """

    has_sms_credentials = serializers.BooleanField(read_only=True)
    sms_access_key = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        help_text="Write-only. Set to store a new Onfon Access Key (encrypted at rest).",
    )
    sms_api_key = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        help_text="Write-only. Set to store a new Onfon API Key (encrypted at rest).",
    )

    class Meta:
        model = Organization
        fields = [
            "sms_provider",
            "sms_sender_id",
            "sms_client_id",
            "sms_access_key",
            "sms_api_key",
            "has_sms_credentials",
        ]

    def update(self, instance, validated_data):
        access_key = validated_data.pop("sms_access_key", None)
        if access_key:
            validated_data["sms_access_key_encrypted"] = encrypt_value(access_key)
        api_key = validated_data.pop("sms_api_key", None)
        if api_key:
            validated_data["sms_api_key_encrypted"] = encrypt_value(api_key)
        return super().update(instance, validated_data)
