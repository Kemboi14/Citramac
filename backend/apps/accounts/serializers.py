from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.tenancy.models import Branch

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
    password_setup_token = serializers.CharField()
    password = serializers.CharField()

    def validate_password(self, value):
        validate_password(value)
        return value


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()
    # "Remember me" (docs/14-TENANT-BRANDED-LOGIN-UX.md) — only controls
    # whether the refresh-token cookie persists across browser restarts, not
    # the token's own lifetime (SIMPLE_JWT.REFRESH_TOKEN_LIFETIME).
    remember = serializers.BooleanField(required=False, default=False)


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
# Governance: Roles & Permissions, Staff / CCP Team rosters
# (citramac_SUPER-ADMIN.html "Global Roles & Permissions" + "Platform Staff",
# citramac_ORG-admin.html "Roles & Permissions" + "Staff / CCP Team").
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

    class Meta:
        model = Role
        fields = [
            "id",
            "name",
            "organization",
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
    branch_access = serializers.PrimaryKeyRelatedField(
        queryset=Branch.objects.all(), many=True, required=False
    )
    primary_branch_name = serializers.CharField(source="primary_branch.name", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "staff_id",
            "first_name",
            "last_name",
            "email",
            "phone",
            "roles",
            "role_names",
            "primary_branch",
            "primary_branch_name",
            "branch_access",
            "is_active",
            "is_on_duty",
            "last_login",
        ]
        read_only_fields = ["last_login"]

    def get_role_names(self, obj):
        return [role.name for role in obj.roles.all()]


class StaffInviteSerializer(serializers.Serializer):
    """Provisions an inactive User + ActivationInvite — mirrors the Org
    Admin invite flow used during Organization onboarding."""

    email = serializers.EmailField()
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    staff_id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.all())
    primary_branch = serializers.PrimaryKeyRelatedField(
        queryset=Branch.objects.all(), required=False, allow_null=True
    )

    def validate_email(self, value):
        if User.all_objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value
