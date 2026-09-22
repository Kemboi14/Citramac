from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework import serializers

from apps.security.models import SecurityPolicy
from apps.tenancy.models import Branch, Department, Organization

from .models import Permission, Role, User


class IdentifySerializer(serializers.Serializer):
    activation_token = serializers.CharField()
    name = serializers.CharField()


class ConfirmEmailSerializer(serializers.Serializer):
    activation_token = serializers.CharField()
    email = serializers.EmailField()


class ResendOtpSerializer(serializers.Serializer):
    otp_token = serializers.CharField()
    # Lets the tenant-branded MFA screen (docs/14-TENANT-BRANDED-LOGIN-UX.md)
    # switch delivery channel before resending, e.g. user picks "Email"
    # after the default SMS send. Ignored for non-login OTP purposes.
    channel = serializers.ChoiceField(choices=["EMAIL", "SMS"], required=False)


class VerifyOtpSerializer(serializers.Serializer):
    otp_token = serializers.CharField()
    otp = serializers.RegexField(r"^\d{6}$")


class TenantDiscoverySerializer(serializers.Serializer):
    email = serializers.EmailField()


class SetPasswordSerializer(serializers.Serializer):
    # Deliberately no field-level validate_password() here: the real
    # validate_password() call (SetPasswordView) needs the resolved User
    # (from the password_setup_token) for the reuse-history check in
    # SecurityPolicyPasswordValidator, which isn't known yet at this
    # serializer's field-validation stage.
    password_setup_token = serializers.CharField()
    password = serializers.CharField()


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()
    # "Remember me" (docs/14-TENANT-BRANDED-LOGIN-UX.md) — only controls
    # whether the refresh-token cookie persists across browser restarts, not
    # the token's own lifetime (SIMPLE_JWT.REFRESH_TOKEN_LIFETIME).
    remember = serializers.BooleanField(required=False, default=False)
    # True only when submitted from the dedicated platform-staff sign-in
    # screen (`/login/platform-staff`), which skips tenant discovery.
    # LoginView rejects this unless the account genuinely has
    # organization=None — see LoginView.post.
    no_organization = serializers.BooleanField(required=False, default=False)


class LoginVerifyOtpSerializer(serializers.Serializer):
    otp_token = serializers.CharField()
    otp = serializers.RegexField(r"^\d{6}$")


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()


class RefreshSerializer(serializers.Serializer):
    refresh = serializers.CharField(required=False)


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField(required=False)


# ─────────────────────────────────────────────────────────────────────────
# Governance: Roles & Permissions, Staff / MHP Team rosters
# (citramac_SUPER-ADMIN.html "Global Roles & Permissions" + "Platform Staff",
# citramac_ORG-admin.html "Roles & Permissions" + "Staff / MHP Team").
# ─────────────────────────────────────────────────────────────────────────


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "codename", "description"]


class RoleSerializer(serializers.ModelSerializer):
    permissions = serializers.PrimaryKeyRelatedField(
        queryset=Permission.objects.all(), many=True, required=False
    )
    user_count = serializers.SerializerMethodField()
    organization_name = serializers.CharField(source="organization.name", read_only=True)

    class Meta:
        model = Role
        fields = [
            "id",
            "name",
            "organization",
            "organization_name",
            "scope",
            "description",
            "permissions",
            "user_count",
        ]
        read_only_fields = ["organization", "scope"]

    def get_user_count(self, obj):
        return getattr(obj, "user_count", None) or obj.users.count()

    def validate_permissions(self, value):
        """
        docs/09-SECURITY-COMPLIANCE.md §9.3: "Org Admin cannot grant
        permissions the platform template doesn't allow." When editing an
        org-scoped role, every requested permission must already appear on
        at least one platform ORG_TEMPLATE role — i.e. an org can narrow a
        template's permission set but never invent new grants.
        """
        request = self.context.get("request")
        instance = self.instance
        organization = (instance.organization_id if instance else None) or (
            request.user.organization_id if request and not request.user.is_superuser else None
        )
        if organization is None:
            return value  # platform-scoped role edits — Super Admin only, no ceiling to enforce.

        allowed = set(
            Permission.objects.filter(
                roles__organization__isnull=True, roles__scope=Role.SCOPE_ORG_TEMPLATE
            ).values_list("id", flat=True)
        )
        requested = {perm.id for perm in value}
        disallowed = requested - allowed
        if disallowed:
            raise serializers.ValidationError(
                "Cannot grant a permission no platform role template allows."
            )
        return value


class StaffSerializer(serializers.ModelSerializer):
    roles = serializers.PrimaryKeyRelatedField(
        queryset=Role.objects.all(), many=True, required=False
    )
    role_names = serializers.SerializerMethodField()
    # `Branch.objects`/`Department.objects` are TenantScopedManager-backed —
    # `.all()` bakes in whatever ambient tenant context is active at the
    # moment it's called. For an explicit class-body field declaration
    # like this one, that's Django *startup* (module import), with no
    # tenant context at all — `.all()` would return `.none()` forever,
    # rejecting every real branch/department id on every real request.
    # `all_objects` (the unscoped manager) sidesteps that; validate() below
    # is what actually enforces "must belong to this org" instead.
    branch_access = serializers.PrimaryKeyRelatedField(
        queryset=Branch.all_objects.all(), many=True, required=False
    )
    primary_branch = serializers.PrimaryKeyRelatedField(
        queryset=Branch.all_objects.all(), required=False, allow_null=True
    )
    primary_branch_name = serializers.CharField(source="primary_branch.name", read_only=True)
    department = serializers.PrimaryKeyRelatedField(
        queryset=Department.all_objects.all(), required=False, allow_null=True
    )
    department_name = serializers.CharField(source="department.name", read_only=True, default="")
    organization = serializers.PrimaryKeyRelatedField(read_only=True)
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    is_locked = serializers.SerializerMethodField()
    access_status = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "staff_id",
            "first_name",
            "last_name",
            "email",
            "phone",
            "avatar",
            "roles",
            "role_names",
            "organization",
            "organization_name",
            "primary_branch",
            "primary_branch_name",
            "department",
            "department_name",
            "branch_access",
            "is_active",
            "is_on_duty",
            "last_login",
            "is_locked",
            "access_starts_at",
            "access_ends_at",
            "access_status",
        ]
        # `avatar` is read-only here — it's self-service only (MyProfileView),
        # never set by an Org/Platform Admin on someone else's behalf; this
        # roster view just displays whatever the staff member has set.
        read_only_fields = ["last_login", "avatar"]

    def get_role_names(self, obj):
        return [role.name for role in obj.roles.all()]

    def get_is_locked(self, obj):
        """
        Whether this account is currently in the LoginView lockout window —
        same cache key LoginView (auth_views.py) and the unlock actions
        (views.py) build, so this reflects real lockout state, not a
        separate/derived signal.
        """
        lockout_key = f"login-lockout:{obj.email.strip().casefold()}"
        max_attempts = SecurityPolicy.get_solo().max_failed_login_attempts
        return cache.get(lockout_key, 0) >= max_attempts

    def get_access_status(self, obj):
        """
        None when this account has no time-bound restriction at all (the
        common case) — "not_started"/"active"/"expired" otherwise, driving
        the roster's status badge without duplicating
        User.is_within_access_window's window logic here.
        """
        if not obj.access_starts_at and not obj.access_ends_at:
            return None
        now = timezone.now()
        if obj.access_starts_at and now < obj.access_starts_at:
            return "not_started"
        if obj.access_ends_at and now >= obj.access_ends_at:
            return "expired"
        return "active"

    def validate(self, attrs):
        organization = self.instance.organization if self.instance else None
        if organization is not None:
            for field_name in ("primary_branch", "department"):
                value = attrs.get(field_name)
                if value is not None and value.organization_id != organization.id:
                    raise serializers.ValidationError(
                        {field_name: "Does not belong to this staff member's organization."}
                    )
            branch_access = attrs.get("branch_access")
            if branch_access and any(b.organization_id != organization.id for b in branch_access):
                raise serializers.ValidationError(
                    {"branch_access": "One or more branches do not belong to this organization."}
                )

        starts = attrs.get(
            "access_starts_at", getattr(self.instance, "access_starts_at", None)
        )
        ends = attrs.get("access_ends_at", getattr(self.instance, "access_ends_at", None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError(
                {"access_ends_at": "Must be after the access start date."}
            )
        if attrs.get("is_active") and ends and ends <= timezone.now():
            raise serializers.ValidationError(
                {
                    "is_active": (
                        "Cannot activate — this account's access end date is in the past. "
                        "Update or clear it first."
                    )
                }
            )
        return attrs


class MyProfileSerializer(serializers.ModelSerializer):
    """
    Self-service "My Profile" — every authenticated user, any role, any
    portal (Super Admin/Org Admin/Clinical Workspace), can view/update
    their own name, phone and avatar. Deliberately excludes
    roles/branch_access/is_active/staff_id/organization — those stay
    governance-only, edited via StaffSerializer/PlatformStaffViewSet by an
    admin, never by the user themself.
    """

    role_names = serializers.SerializerMethodField()
    organization_name = serializers.CharField(source="organization.name", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "first_name",
            "last_name",
            "email",
            "phone",
            "avatar",
            "role_names",
            "organization_name",
        ]
        read_only_fields = ["email"]

    def get_role_names(self, obj):
        return [role.name for role in obj.roles.all()]

    def validate_avatar(self, value):
        if value and value.size > settings.AVATAR_MAX_SIZE_BYTES:
            max_mb = settings.AVATAR_MAX_SIZE_BYTES // (1024 * 1024)
            raise serializers.ValidationError(f"Profile picture must be {max_mb}MB or smaller.")
        return value


class StaffInviteSerializer(serializers.Serializer):
    """Provisions an inactive User + ActivationInvite — mirrors the Org
    Admin invite flow used during Organization onboarding.

    `organization` is only meaningful when a Super Admin is the caller
    (StaffViewSet.create): an Org Admin's staff always land in their own
    org regardless of what's submitted here — see StaffViewSet.create.
    """

    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    staff_id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.all())
    # `all_objects`, not `objects` — see StaffSerializer's identical fields
    # for why a TenantScopedManager-backed `.objects.all()` here would bake
    # in an empty queryset forever. `organization` isn't resolved yet at
    # this point (StaffViewSet.create resolves it after validation, from
    # either the caller's own org or a superuser's payload), so the
    # "must belong to this org" check happens in
    # StaffViewSet._create_staff instead of here.
    primary_branch = serializers.PrimaryKeyRelatedField(
        queryset=Branch.all_objects.all(), required=False, allow_null=True
    )
    department = serializers.PrimaryKeyRelatedField(
        queryset=Department.all_objects.all(), required=False, allow_null=True
    )
    organization = serializers.PrimaryKeyRelatedField(
        queryset=Organization.objects.all(), required=False, allow_null=True
    )
    access_starts_at = serializers.DateTimeField(required=False, allow_null=True)
    access_ends_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_email(self, value):
        if User.all_objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        starts = attrs.get("access_starts_at")
        ends = attrs.get("access_ends_at")
        if starts and ends and ends <= starts:
            raise serializers.ValidationError(
                {"access_ends_at": "Must be after the access start date."}
            )
        return attrs
