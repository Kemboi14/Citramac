from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework import serializers

from apps.security.models import SecurityPolicy
from apps.tenancy.models import Branch, Department, Organization

from .access import branches_for, is_org_admin_role, set_assignments, visible_branch_ids
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
    # True whenever TenantDiscoveryStep resolved a platform-staff email
    # (`{"tenant": null}`) rather than a real organization — see
    # TenantDiscoveryView's docstring. LoginView rejects this unless the
    # account genuinely has organization=None — see LoginView.post.
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
        fields = ["id", "codename", "label", "description", "module", "module_label", "scope"]

    module_label = serializers.SerializerMethodField()

    def get_module_label(self, obj):
        from .catalogue import MODULES

        return MODULES.get(obj.module, obj.module)


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
        docs/09-SECURITY-COMPLIANCE.md §9.3: an organisation grants only
        organisation permissions (catalogue scope ORG — every one of them, the
        legal-form authorities included). Platform-team permissions belong on
        platform-team roles only, whoever is editing.
        """
        instance = self.instance
        platform_role = instance is not None and instance.scope == Role.SCOPE_PLATFORM
        if platform_role:
            return value
        wrong = sorted(p.label or p.codename for p in value if p.scope != "ORG")
        if wrong:
            raise serializers.ValidationError(
                "These are platform-team permissions and can't be given to an "
                "organisation's role: " + ", ".join(wrong) + "."
            )
        return value

    def validate(self, attrs):
        """Org Admin and Auditor are the built-in administrator roles; their
        access is fixed in code, so their permissions are not edited here."""
        if self.instance is not None and "permissions" in attrs:
            if self.instance.name.strip().lower() in TENANT_HELD_PLATFORM_ROLES:
                raise serializers.ValidationError(
                    {"permissions": f"{self.instance.name} is a built-in administrator role; its access is fixed."}
                )
        return attrs


class RoleAssignmentSerializer(serializers.Serializer):
    """One (role, branch) pair; branch null = every branch of the organization."""

    id = serializers.UUIDField(read_only=True)
    role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.all())
    role_name = serializers.CharField(source="role.name", read_only=True)
    # all_objects: see StaffSerializer.branch_access below.
    branch = serializers.PrimaryKeyRelatedField(
        queryset=Branch.all_objects.all(), required=False, allow_null=True
    )
    branch_name = serializers.CharField(source="branch.name", read_only=True, default=None)


# Seeded with PLATFORM scope (accounts migration 0007) but held by a
# facility's own staff — every other PLATFORM role is Softlink's own team.
TENANT_HELD_PLATFORM_ROLES = ("org admin", "auditor")


def validate_assignments(assignments, organization):
    """
    Every role must be one this organization may hand out (its own, or a
    platform ORG_TEMPLATE — never a platform-staff role), every branch one of
    its active branches. Returns [(Role, Branch|None)].
    """
    if not assignments:
        raise serializers.ValidationError({"assignments": "Give the staff member at least one role."})
    pairs = []
    for item in assignments:
        role, branch = item["role"], item.get("branch")
        assignable = role.scope == Role.SCOPE_ORG_TEMPLATE or role.name.strip().lower() in (
            TENANT_HELD_PLATFORM_ROLES
        )
        if not assignable or role.organization_id not in (None, organization.id):
            raise serializers.ValidationError(
                {"assignments": f"“{role.name}” can't be given to this organisation's staff."}
            )
        if branch is not None and branch.organization_id != organization.id:
            raise serializers.ValidationError(
                {"assignments": "One or more branches do not belong to this organization."}
            )
        if branch is not None and not branch.is_active:
            raise serializers.ValidationError(
                {"assignments": f"{branch.name} is no longer active."}
            )
        pairs.append((role, branch))
    return pairs


def _covers_branch(pairs, branch):
    """Whether these assignments let the holder work at `branch`."""
    return any(b is None or b.id == branch.id or is_org_admin_role(r) for r, b in pairs)


class StaffSerializer(serializers.ModelSerializer):
    # Roles and branches are changed only through `assignments` — the union
    # fields are read-only so no PATCH can grant a role around its checks.
    roles = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    assignments = RoleAssignmentSerializer(many=True, required=False, source="role_assignments")
    role_names = serializers.SerializerMethodField()
    # `Branch.objects`/`Department.objects` are TenantScopedManager-backed —
    # `.all()` bakes in whatever ambient tenant context is active at the
    # moment it's called. For an explicit class-body field declaration
    # like this one, that's Django *startup* (module import), with no
    # tenant context at all — `.all()` would return `.none()` forever,
    # rejecting every real branch/department id on every real request.
    # `all_objects` (the unscoped manager) sidesteps that; validate() below
    # is what actually enforces "must belong to this org" instead.
    branch_access = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
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
    nacada_status = serializers.SerializerMethodField()

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
            "assignments",
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
            "nacada_status",
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
                if value is not None and not value.is_active:
                    label = "branch" if field_name == "primary_branch" else "department"
                    raise serializers.ValidationError(
                        {field_name: f"This {label} is no longer active."}
                    )
            if "role_assignments" in attrs:
                attrs["role_assignments"] = validate_assignments(
                    attrs["role_assignments"], organization
                )
            pairs = attrs.get("role_assignments") or [
                (a.role, a.branch) for a in self.instance.role_assignments.all()
            ]
            primary = attrs.get("primary_branch", self.instance.primary_branch)
            if primary is not None and pairs and not _covers_branch(pairs, primary):
                raise serializers.ValidationError(
                    {"primary_branch": "The primary branch must be one this person is assigned to."}
                )

        starts = attrs.get("access_starts_at", getattr(self.instance, "access_starts_at", None))
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

    def get_nacada_status(self, obj):
        credential = getattr(obj, "practitioner_credential", None)
        return credential.nacada_status if credential else None

    def update(self, instance, validated_data):
        pairs = validated_data.pop("role_assignments", None)
        instance = super().update(instance, validated_data)
        if pairs is not None:
            request = self.context.get("request")
            set_assignments(instance, pairs, created_by=getattr(request, "user", None))
        return instance


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
    # Read-only "where am I" context for the topbar organisation · branch
    # pill (frontend/src/shells/OrgBranchPill.tsx). Served here rather than
    # from /platform/branches/ because that list is admin-only, and every
    # clinician needs to see their own branch names.
    primary_branch = serializers.SerializerMethodField()
    branches = serializers.SerializerMethodField()
    all_branches = serializers.SerializerMethodField()
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)

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
            "organization_id",
            "organization_name",
            "primary_branch",
            "branches",
            "all_branches",
            "department_name",
        ]
        read_only_fields = ["email", "organization_id"]

    def get_role_names(self, obj):
        return [role.name for role in obj.roles.all()]

    def get_primary_branch(self, obj):
        branch = obj.primary_branch
        if branch is None or not branch.is_active:
            return None
        return {"id": str(branch.id), "name": branch.name}

    def get_branches(self, obj):
        """Every active branch this person works at — all of them for an org-wide account."""
        if not obj.organization_id:
            return []
        return [
            {
                "id": str(branch.id),
                "name": branch.name,
                "is_primary": branch.id == obj.primary_branch_id,
                "roles": sorted(
                    a.role.name
                    for a in obj.role_assignments.all()
                    if a.branch_id in (None, branch.id) or is_org_admin_role(a.role)
                ),
            }
            for branch in branches_for(obj)
        ]

    def get_all_branches(self, obj):
        """True when this person may work across every branch at once (Org Admin, org-wide role)."""
        return bool(obj.organization_id) and visible_branch_ids(obj) is None

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
    # Either `assignments` (one or more role-at-branch pairs) or the single
    # `role`, which is then held at `primary_branch` (or org-wide without one).
    role = serializers.PrimaryKeyRelatedField(queryset=Role.objects.all(), required=False)
    assignments = RoleAssignmentSerializer(many=True, required=False)
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
        if not attrs.get("assignments"):
            if not attrs.get("role"):
                raise serializers.ValidationError({"assignments": "Give the staff member a role."})
            attrs["assignments"] = [
                {"role": attrs["role"], "branch": attrs.get("primary_branch")}
            ]
        return attrs
