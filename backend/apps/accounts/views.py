from django.db import transaction
from django.utils import timezone
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsPlatformSuperAdmin, IsPlatformSuperAdminOrOrgAdmin
from apps.tenancy.context import platform_admin_context

from .models import ActivationInvite, OneTimePassword, Permission, Role, User
from .serializers import (
    PermissionSerializer,
    RoleSerializer,
    StaffInviteSerializer,
    StaffSerializer,
)

INVITE_TTL_DAYS = 7


class PermissionListView(generics.ListAPIView):
    """Read-only catalog backing the permission matrix checkboxes on both
    Roles & Permissions screens."""

    permission_classes = [IsAuthenticated]
    serializer_class = PermissionSerializer
    queryset = Permission.objects.all()
    pagination_class = None


class RoleViewSet(viewsets.ModelViewSet):
    """
    Super Admin: platform-staff role templates (scope=PLATFORM) — "Global
    Roles & Permissions". Org Admin: their own org's roles PLUS read access
    to the ORG_TEMPLATE platform templates they're seeded from — "Roles &
    Permissions". Creating a role always scopes it to the caller (Super
    Admin -> organization=None/PLATFORM is disallowed via API, platform
    templates are seed/admin-managed; Org Admin -> their own organization).
    """

    serializer_class = RoleSerializer
    permission_classes = [IsPlatformSuperAdminOrOrgAdmin]
    org_admin_can_create = True

    def get_queryset(self):
        from django.db.models import Count

        queryset = Role.objects.annotate(user_count=Count("users", distinct=True)).order_by("name")
        user = self.request.user
        if user.is_superuser:
            return queryset.filter(scope=Role.SCOPE_PLATFORM, organization__isnull=True)
        return queryset.filter(models_q_org_or_template(user.organization_id))

    def perform_create(self, serializer):
        user = self.request.user
        if user.is_superuser:
            serializer.save(organization=None, scope=Role.SCOPE_PLATFORM)
        else:
            serializer.save(organization=user.organization, scope=Role.SCOPE_ORG_TEMPLATE)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context


def models_q_org_or_template(organization_id):
    from django.db.models import Q

    return Q(organization_id=organization_id) | Q(
        organization__isnull=True, scope=Role.SCOPE_ORG_TEMPLATE
    )


class StaffViewSet(viewsets.ModelViewSet):
    """
    Org Admin's "Staff & CCP Team" roster. Always scoped to the caller's own
    organization (Super Admin has no equivalent screen for a single org's
    staff — that's out of scope for the platform console). See
    PlatformStaffViewSet for Super Admin's own team roster.
    """

    serializer_class = StaffSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            User.all_objects.filter(organization=self.request.user.organization)
            .prefetch_related("roles", "branch_access")
            .order_by("first_name", "last_name")
        )

    def create(self, request, *args, **kwargs):
        serializer = StaffInviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        organization = request.user.organization

        with transaction.atomic():
            staff = User.objects.create_user(
                email=data["email"],
                organization=organization,
                first_name=data["first_name"],
                last_name=data["last_name"],
                staff_id=data.get("staff_id", ""),
                is_active=False,
            )
            staff.roles.add(data["role"])
            if data.get("primary_branch"):
                staff.primary_branch = data["primary_branch"]
                staff.branch_access.add(data["primary_branch"])
                staff.save(update_fields=["primary_branch"])

            invite = ActivationInvite.objects.create(
                organization=organization,
                user=staff,
                created_by=request.user,
                expires_at=timezone.now() + timezone.timedelta(days=INVITE_TTL_DAYS),
            )
            _dispatch_invite_email(staff.email, organization.name, invite.token)

        return Response(StaffSerializer(staff).data, status=status.HTTP_201_CREATED)

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

    def create(self, request, *args, **kwargs):
        """
        Platform staff have organization=None, so they can't own an
        ActivationInvite (TenantScopedModel requires a non-null
        organization — see its docstring). Instead: create the account
        active immediately (a Super Admin vouches for a colleague in
        person, unlike self-service tenant onboarding) with an unusable
        random password, then issue the same OTP + set-password challenge
        ForgotPasswordView uses so the new hire sets their own password
        through already-battle-tested plumbing rather than a bespoke path.
        """
        serializer = StaffInviteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with platform_admin_context(), transaction.atomic():
            staff = User.objects.create_user(
                email=data["email"],
                organization=None,
                first_name=data["first_name"],
                last_name=data["last_name"],
                staff_id=data.get("staff_id", ""),
                is_staff=True,
                is_active=True,
            )
            staff.set_unusable_password()
            staff.save(update_fields=["password"])
            staff.roles.add(data["role"])

            otp, code = OneTimePassword.issue(staff, OneTimePassword.PURPOSE_RESET)
            _dispatch_otp_email(staff.email, code, otp.purpose)

        return Response(StaffSerializer(staff).data, status=status.HTTP_201_CREATED)


class EnabledModulesView(APIView):
    """docs/04-MULTI-TENANCY.md §4.4: `GET /api/v1/me/enabled-modules/` —
    documented since Phase 4 but never implemented until now."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        organization = request.user.organization
        return Response({"enabled_modules": organization.enabled_modules if organization else []})


def _dispatch_invite_email(email, organization_name, token):
    from apps.notifications.tasks import send_invite_email

    send_invite_email.delay(email, organization_name, token)


def _dispatch_otp_email(email, code, purpose):
    from apps.notifications.tasks import send_otp_email

    send_otp_email.delay(email, code, purpose)
