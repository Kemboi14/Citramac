import contextlib

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from rest_framework import generics, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import (
    IsOrgAdminForWrites,
    IsPlatformSuperAdmin,
    IsPlatformSuperAdminOrOrgAdmin,
)
from apps.notifications.dispatch import queue_activation_invite
from apps.tenancy.context import platform_admin_context
from config.errors import error_response

from .models import ActivationInvite, OneTimePassword, Permission, Role, User
from .access import set_assignments
from .serializers import (
    MyProfileSerializer,
    PermissionSerializer,
    RoleSerializer,
    StaffInviteSerializer,
    StaffSerializer,
    _covers_branch,
    validate_assignments,
)

INVITE_TTL_DAYS = 7


class PermissionListView(generics.ListAPIView):
    """Read-only catalogue (apps.accounts.catalogue) backing both Roles &
    Permissions screens. An organisation's staff see only the permissions an
    organisation can grant. Super Admin sees both kinds, or one with
    ?scope=PLATFORM / ?scope=ORG."""

    permission_classes = [IsAuthenticated]
    serializer_class = PermissionSerializer
    pagination_class = None

    def get_queryset(self):
        queryset = Permission.objects.all()
        if not self.request.user.is_superuser:
            return queryset.filter(scope="ORG")
        scope = self.request.query_params.get("scope")
        if scope in ("ORG", "PLATFORM"):
            queryset = queryset.filter(scope=scope)
        return queryset


def _permission_codenames(role):
    return set(role.permissions.values_list("codename", flat=True))


def _audit_permission_change(role, before):
    """Who changed which permissions on a role — the many-to-many change the
    generic write signals don't see."""
    from apps.sysadmin_audit.audit import write_event
    from apps.sysadmin_audit.models import AuditLogEntry

    after = _permission_codenames(role)
    if after == before:
        return
    write_event(
        role.organization_id,
        AuditLogEntry.ACTION_UPDATE,
        "accounts.role",
        role.pk,
        {
            "role": {"old": None, "new": role.name},
            "permissions_added": {"old": None, "new": sorted(after - before)},
            "permissions_removed": {"old": sorted(before - after), "new": None},
        },
    )


class RoleViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """
    Roles, kept on two sides that never mix (apps.accounts.catalogue, "Roles"):

    - Super Admin: the platform team's roles. With ?organization=<id> (the
      Organizations screen's Add Staff drawer) the list is that organisation's
      roles instead, read-only — they are the organisation's to change.
    - Org Admin: their own organisation's roles — its copies of the standard
      roles and the custom ones it made.

    Nothing is deleted: a role nobody holds can be retired, and reactivated.
    """

    serializer_class = RoleSerializer
    permission_classes = [IsPlatformSuperAdminOrOrgAdmin]
    org_admin_can_create = True
    pagination_class = None

    def get_queryset(self):
        from django.db.models import Count

        queryset = (
            Role.objects.annotate(user_count=Count("users", distinct=True))
            .select_related("organization")
            .prefetch_related("permissions")
            .order_by("name")
        )
        user = self.request.user
        if user.is_superuser:
            organization_id = self.request.query_params.get("organization")
            if organization_id and self.action == "list":
                return queryset.filter(
                    organization_id=organization_id, scope=Role.SCOPE_ORG_TEMPLATE
                )
            return queryset.filter(organization__isnull=True, scope=Role.SCOPE_PLATFORM)
        return queryset.filter(
            organization_id=user.organization_id, scope=Role.SCOPE_ORG_TEMPLATE
        )

    def _copy_source(self):
        copy_from = self.request.data.get("copy_from")
        if copy_from in (None, ""):
            return None
        source = None
        if str(copy_from).isdigit():
            source = self.get_queryset().filter(pk=copy_from).first()
        if source is None:
            raise ValidationError({"copy_from": "Choose one of your roles to copy."})
        if source.is_locked:
            raise ValidationError(
                {"copy_from": f"{source.name} is a built-in role and can't be copied."}
            )
        return source

    def perform_create(self, serializer):
        user = self.request.user
        source = self._copy_source()
        if user.is_superuser:
            role = serializer.save(organization=None, scope=Role.SCOPE_PLATFORM)
        else:
            role = serializer.save(organization=user.organization, scope=Role.SCOPE_ORG_TEMPLATE)
        if source is not None and "permissions" not in serializer.validated_data:
            role.permissions.set(source.permissions.all())
        _audit_permission_change(role, set())

    def perform_update(self, serializer):
        before = _permission_codenames(serializer.instance)
        role = serializer.save()
        _audit_permission_change(role, before)

    @action(detail=True, methods=["get"])
    def members(self, request, pk=None):
        """Everyone holding this role, with the branches they hold it at."""
        role = self.get_object()
        with platform_admin_context():
            if role.scope == Role.SCOPE_PLATFORM:
                rows = [
                    (u, ["Platform"]) for u in role.users.all().order_by("first_name", "last_name")
                ]
            else:
                by_user = {}
                for a in (
                    role.assignments.select_related("user", "branch")
                    .order_by("user__first_name", "user__last_name")
                ):
                    held = by_user.setdefault(a.user_id, (a.user, []))[1]
                    held.append(a.branch.name if a.branch_id else "All branches")
                rows = list(by_user.values())
        return Response(
            [
                {
                    "id": str(u.pk),
                    "first_name": u.first_name,
                    "last_name": u.last_name,
                    "email": u.email,
                    "is_active": u.is_active,
                    "branches": sorted(branches),
                }
                for u, branches in rows
            ]
        )

    @action(detail=True, methods=["post"])
    def retire(self, request, pk=None):
        role = self.get_object()
        if role.is_locked:
            raise ValidationError(
                {"detail": f"{role.name} is a built-in role and can't be retired."}
            )
        with platform_admin_context():
            holders = role.users.count()
        if holders:
            raise ValidationError(
                {
                    "detail": (
                        f"{holders} {'person holds' if holders == 1 else 'people hold'} this "
                        "role. Give them another role first, then retire it."
                    )
                }
            )
        role.is_active = False
        role.save(update_fields=["is_active", "updated_at"])
        return Response(self.get_serializer(self.get_queryset().get(pk=role.pk)).data)

    @action(detail=True, methods=["post"])
    def reactivate(self, request, pk=None):
        role = self.get_object()
        role.is_active = True
        role.save(update_fields=["is_active", "updated_at"])
        return Response(self.get_serializer(self.get_queryset().get(pk=role.pk)).data)


class StaffViewSet(viewsets.ModelViewSet):
    """
    Org Admin's "Staff & MHP Team" roster, scoped to their own organization.
    A Super Admin caller instead sees/creates staff across every org — they
    must specify which one via `organization` on create (see
    StaffInviteSerializer) since they have no organization of their own.
    See PlatformStaffViewSet for Super Admin's own platform-staff roster.
    """

    serializer_class = StaffSerializer
    # Reading the roster stays open to every member of the organization (the
    # registration screen picks a care coordinator from it); changing anyone's
    # roles, branches, access or status is the Org Admin's — or Super Admin's.
    permission_classes = [IsAuthenticated, IsOrgAdminForWrites]

    def get_queryset(self):
        user = self.request.user
        if user.is_superuser:
            with platform_admin_context():
                return list(
                    User.all_objects.filter(organization__isnull=False)
                    .select_related("organization")
                    .prefetch_related("roles", "branch_access", "role_assignments__role", "role_assignments__branch")
                    .order_by("organization__name", "first_name", "last_name")
                )
        return (
            User.all_objects.filter(organization=user.organization)
            .prefetch_related("roles", "branch_access", "role_assignments__role", "role_assignments__branch")
            .order_by("first_name", "last_name")
        )

    def get_object(self):
        """
        Mirrors PlatformStaffViewSet.get_object() — see its docstring.
        get_queryset() above returns a plain list for a superuser caller
        (platform_admin_context() must be active while it's evaluated, not
        just constructed), and a plain list has no .get() for DRF's default
        get_object_or_404() lookup, so the superuser path is re-queried here
        instead of relying on the base implementation.
        """
        if self.request.user.is_superuser:
            with platform_admin_context():
                obj = generics.get_object_or_404(
                    User.all_objects.filter(organization__isnull=False)
                    .select_related("organization")
                    .prefetch_related("roles", "branch_access", "role_assignments__role", "role_assignments__branch"),
                    pk=self.kwargs["pk"],
                )
            self.check_object_permissions(self.request, obj)
            return obj
        return super().get_object()

    def create(self, request, *args, **kwargs):
        serializer = StaffInviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        is_superuser = request.user.is_superuser

        if is_superuser:
            organization = data.get("organization")
            if organization is None:
                return Response(
                    {"organization": ["Required when a Super Admin creates org staff."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            # An Org Admin's staff always land in their own org — any
            # `organization` submitted here is silently ignored, not just
            # unauthorized, since only a Super Admin has a legitimate reason
            # to send it at all.
            organization = request.user.organization

        from apps.tenancy.models import Organization

        if organization.status in Organization.BLOCKED_STATUSES:
            raise ValidationError(
                {
                    "organization": (
                        "This organisation is suspended or archived — new staff cannot be " "added."
                    )
                }
            )

        with platform_admin_context() if is_superuser else contextlib.nullcontext():
            staff = self._create_staff(request, organization, data)
        return Response(StaffSerializer(staff).data, status=status.HTTP_201_CREATED)

    def _create_staff(self, request, organization, data):
        primary_branch = data.get("primary_branch")
        if primary_branch is not None and primary_branch.organization_id != organization.id:
            raise ValidationError({"primary_branch": "Does not belong to this organization."})
        if primary_branch is not None and not primary_branch.is_active:
            raise ValidationError({"primary_branch": "This branch is no longer active."})
        department = data.get("department")
        if department is not None and department.organization_id != organization.id:
            raise ValidationError({"department": "Does not belong to this organization."})
        if department is not None and not department.is_active:
            raise ValidationError({"department": "This department is no longer active."})

        pairs = validate_assignments(data["assignments"], organization)
        if primary_branch is not None and not _covers_branch(pairs, primary_branch):
            raise ValidationError(
                {"primary_branch": "The primary branch must be one this person is assigned to."}
            )

        with transaction.atomic():
            staff = User.objects.create_user(
                email=data["email"],
                organization=organization,
                first_name=data["first_name"],
                last_name=data["last_name"],
                staff_id=data.get("staff_id", ""),
                is_active=False,
            )
            # Keeps tenant-branded login's discovery step
            # (apps.accounts.auth_views.TenantDiscoveryView) able to find
            # this org for every real staff member automatically, rather
            # than depending on Organization.email_domains being kept
            # manually in sync by an admin.
            organization.register_email_domain(staff.email)
            if primary_branch is not None:
                staff.primary_branch = primary_branch
                staff.save(update_fields=["primary_branch"])
            set_assignments(staff, pairs, created_by=request.user)
            if data.get("department") or data.get("access_starts_at") or data.get("access_ends_at"):
                staff.department = data.get("department")
                staff.access_starts_at = data.get("access_starts_at")
                staff.access_ends_at = data.get("access_ends_at")
                staff.save(update_fields=["department", "access_starts_at", "access_ends_at"])

            invite = ActivationInvite.objects.create(
                organization=organization,
                user=staff,
                created_by=request.user,
                expires_at=timezone.now() + timezone.timedelta(days=INVITE_TTL_DAYS),
            )
            queue_activation_invite(invite)

        return staff

    def destroy(self, request, *args, **kwargs):
        """Deactivate, never hard-delete a staff account (preserves audit/clinical FKs)."""
        staff = self.get_object()
        staff.is_active = False
        staff.is_on_duty = False
        staff.save(update_fields=["is_active", "is_on_duty"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def toggle_duty(self, request, pk=None):
        staff = self.get_object()
        staff.is_on_duty = not staff.is_on_duty
        staff.save(update_fields=["is_on_duty"])
        return Response(StaffSerializer(staff).data)

    @action(detail=True, methods=["post"])
    def resend_invite(self, request, pk=None):
        """
        Re-dispatches the activation invite email. Also self-heals the case
        where no ActivationInvite exists at all (e.g. a staff row created
        out-of-band) by issuing a fresh one, and reissues rather than reuses
        an expired/already-used invite.
        """
        staff = self.get_object()
        if staff.is_active:
            return error_response(
                "ACCOUNT_ALREADY_ACTIVE",
                "This staff member has already activated their account.",
                status.HTTP_400_BAD_REQUEST,
            )
        organization = staff.organization
        with platform_admin_context() if request.user.is_superuser else contextlib.nullcontext():
            invite = (
                ActivationInvite.objects.filter(user=staff, used_at__isnull=True)
                .order_by("-created_at")
                .first()
            )
            if invite is None or not invite.is_valid():
                invite = ActivationInvite.objects.create(
                    organization=organization,
                    user=staff,
                    created_by=request.user,
                    expires_at=timezone.now() + timezone.timedelta(days=INVITE_TTL_DAYS),
                )
            queue_activation_invite(invite, resend=True)
        return Response(StaffSerializer(staff).data)

    @action(detail=True, methods=["post"])
    def unlock(self, request, pk=None):
        """
        Clears an in-progress login lockout early. Rebuilds the exact cache
        key LoginView (auth_views.py) uses — `.strip().casefold()` on the
        email guarantees a match regardless of how the local-part case was
        originally stored, since login lookups are already case-insensitive
        (User.all_objects.filter(email__iexact=...)) and invite-time
        uniqueness is enforced the same way (StaffInviteSerializer.validate_email).
        """
        staff = self.get_object()
        lockout_key = f"login-lockout:{staff.email.strip().casefold()}"
        cache.delete(lockout_key)
        return Response(StaffSerializer(staff).data)

    @action(detail=True, methods=["post"])
    def reset_credentials(self, request, pk=None):
        """
        Admin-triggered credential reset — issues the exact same
        PURPOSE_RESET OneTimePassword + email ForgotPasswordView issues for
        a self-service request, just triggered by an admin selecting the
        account instead of the user submitting their own email. Never
        generates or returns a password: the code only ever reaches the
        account's own inbox, and the existing OTP -> PasswordSetupToken ->
        SetPasswordView flow (auth_views.py) is what actually sets the new
        password, entirely in the user's own session. The account's current
        password keeps working until they complete that flow.
        """
        staff = self.get_object()
        if not staff.is_active:
            return error_response(
                "ACCOUNT_NOT_ACTIVATED",
                "This account hasn't been activated yet — resend the invite instead.",
                status.HTTP_400_BAD_REQUEST,
            )
        from apps.accounts.auth_views import _dispatch_otp_email

        with platform_admin_context() if request.user.is_superuser else contextlib.nullcontext():
            otp, code = OneTimePassword.issue(staff, OneTimePassword.PURPOSE_RESET)
        _dispatch_otp_email(staff, code, otp.purpose)
        return Response({"detail": "A password reset code has been emailed to this user."})


def _require_platform_role(role):
    """A platform account holds an active platform-team role only — never an
    organisation's role, and never Super Admin, which comes with a Super
    Admin account rather than being handed out."""
    from .catalogue import ROLE_KEY_SUPER_ADMIN

    if (
        role is None
        or role.scope != Role.SCOPE_PLATFORM
        or role.organization_id is not None
        or not role.is_active
        or role.system_key == ROLE_KEY_SUPER_ADMIN
    ):
        raise ValidationError(
            {
                "role": (
                    "Choose a platform-team role. Organisation staff are added to "
                    "their organisation."
                )
            }
        )
    return role


class PlatformStaffViewSet(viewsets.ModelViewSet):
    """Softlink Options' own team (organization=None) — the "Platform
    Staff" table on the Super Admin Global Roles & Permissions screen."""

    serializer_class = StaffSerializer
    permission_classes = [IsPlatformSuperAdmin]

    def get_queryset(self):
        with platform_admin_context():
            return list(
                User.all_objects.filter(organization__isnull=True)
                .prefetch_related("roles")
                .order_by("first_name", "last_name")
            )

    def get_object(self):
        """
        Overridden rather than left to the list-returning get_queryset()
        above: DRF's default get_object() calls get_object_or_404() on
        whatever get_queryset() returns, and a plain list has no .get() —
        that 404s on every retrieve/update/destroy regardless of whether
        the row exists (get_queryset() itself stays list-based since the
        list action needs platform_admin_context() active while it's
        actually evaluated, not just while it's constructed).
        """
        with platform_admin_context():
            obj = generics.get_object_or_404(
                User.all_objects.filter(organization__isnull=True).prefetch_related("roles"),
                pk=self.kwargs["pk"],
            )
        self.check_object_permissions(self.request, obj)
        return obj

    def create(self, request, *args, **kwargs):
        """
        Platform staff have organization=None. ActivationInvite.organization
        is nullable for exactly this case (see its docstring and
        migrations/0009_alter_activationinvite_organization.py), so this
        mirrors StaffViewSet._create_staff's real "Welcome to CITRAMAC"
        activation-invite flow instead of the OTP-reset-code email this view
        used before — same activate/set-password experience every other
        invited staff member gets, not a bespoke one.
        """
        serializer = StaffInviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        role = _require_platform_role(data.get("role"))

        with platform_admin_context(), transaction.atomic():
            staff = User.objects.create_user(
                email=data["email"],
                organization=None,
                first_name=data["first_name"],
                last_name=data["last_name"],
                staff_id=data.get("staff_id", ""),
                is_staff=True,
                is_active=False,
            )
            staff.roles.add(role)

            invite = ActivationInvite.objects.create(
                organization=None,
                user=staff,
                created_by=request.user,
                expires_at=timezone.now() + timezone.timedelta(days=INVITE_TTL_DAYS),
            )
            queue_activation_invite(invite)

        return Response(StaffSerializer(staff).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def change_role(self, request, pk=None):
        """Give a platform-team member a different platform-team role. (The
        console used to PATCH `roles` on the organisation staff endpoint,
        which ignored it — role changes there silently did nothing.)"""
        staff = self.get_object()
        role_id = request.data.get("role")
        with platform_admin_context():
            role = Role.objects.filter(pk=role_id).first() if str(role_id).isdigit() else None
            role = _require_platform_role(role)
            staff.roles.set([role])
            staff.refresh_from_db()
            data = StaffSerializer(staff).data
        return Response(data)

    @action(detail=True, methods=["post"])
    def resend_invite(self, request, pk=None):
        """Platform-staff mirror of StaffViewSet.resend_invite."""
        staff = self.get_object()
        if staff.is_active:
            return error_response(
                "ACCOUNT_ALREADY_ACTIVE",
                "This staff member has already activated their account.",
                status.HTTP_400_BAD_REQUEST,
            )
        with platform_admin_context():
            invite = (
                ActivationInvite.objects.filter(user=staff, used_at__isnull=True)
                .order_by("-created_at")
                .first()
            )
            if invite is None or not invite.is_valid():
                invite = ActivationInvite.objects.create(
                    organization=None,
                    user=staff,
                    created_by=request.user,
                    expires_at=timezone.now() + timezone.timedelta(days=INVITE_TTL_DAYS),
                )
            queue_activation_invite(invite, resend=True)
        return Response(StaffSerializer(staff).data)

    @action(detail=True, methods=["post"])
    def unlock(self, request, pk=None):
        """Platform-staff mirror of StaffViewSet.unlock."""
        staff = self.get_object()
        lockout_key = f"login-lockout:{staff.email.strip().casefold()}"
        cache.delete(lockout_key)
        return Response(StaffSerializer(staff).data)

    @action(detail=True, methods=["post"])
    def reset_credentials(self, request, pk=None):
        """Platform-staff mirror of StaffViewSet.reset_credentials."""
        staff = self.get_object()
        if not staff.is_active:
            return error_response(
                "ACCOUNT_NOT_ACTIVATED",
                "This account hasn't been activated yet — resend the invite instead.",
                status.HTTP_400_BAD_REQUEST,
            )
        from apps.accounts.auth_views import _dispatch_otp_email

        with platform_admin_context():
            otp, code = OneTimePassword.issue(staff, OneTimePassword.PURPOSE_RESET)
        _dispatch_otp_email(staff, code, otp.purpose)
        return Response({"detail": "A password reset code has been emailed to this user."})


class EnabledModulesView(APIView):
    """docs/04-MULTI-TENANCY.md §4.4: `GET /api/v1/me/enabled-modules/` —
    documented since Phase 4 but never implemented until now."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        organization = request.user.organization
        return Response({"enabled_modules": organization.enabled_modules if organization else []})


class MyProfileView(APIView):
    """
    `GET/PATCH /api/v1/me/profile/` — self-service profile for every
    authenticated user regardless of role or portal (Super Admin/Org
    Admin/Clinical Workspace), including uploading/replacing their own
    avatar. See MyProfileSerializer's docstring for what's excluded and why.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        return Response(MyProfileSerializer(request.user, context={"request": request}).data)

    def patch(self, request):
        serializer = MyProfileSerializer(
            request.user, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

