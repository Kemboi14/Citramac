from django.db import transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.response import Response

from apps.accounts.models import ActivationInvite, Role, User
from apps.accounts.permissions import IsPlatformSuperAdmin
from apps.tenancy.context import platform_admin_context

from .models import Organization
from .serializers import CreateOrganizationSerializer, OrganizationSerializer

INVITE_TTL_DAYS = 7


class OrganizationListCreateView(generics.ListCreateAPIView):
    """
    docs/04-MULTI-TENANCY.md §4.5 provisioning flow, step 1: "Super Admin
    creates the Organization record ... system generates a slug and a
    default Org Admin invite." Ties together the Phase 1 exit criteria in
    docs/11-ROADMAP-AND-PHASES.md: create an Organization, invite its Org
    Admin, and have that invite be a real, activatable ActivationInvite.
    """

    permission_classes = [IsPlatformSuperAdmin]
    serializer_class = OrganizationSerializer

    def get_queryset(self):
        with platform_admin_context():
            return list(Organization.objects.all())

    def create(self, request, *args, **kwargs):
        serializer = CreateOrganizationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with platform_admin_context(), transaction.atomic():
            organization = Organization.objects.create(
                name=data["name"], slug=data["slug"], facility_type=data["facility_type"]
            )

            org_admin_data = data["org_admin"]
            org_admin = User.objects.create_user(
                email=org_admin_data["email"],
                organization=organization,
                first_name=org_admin_data["first_name"],
                last_name=org_admin_data["last_name"],
                is_active=False,
            )

            org_admin_role = Role.objects.filter(
                name="Org Admin", organization__isnull=True
            ).first()
            if org_admin_role:
                org_admin.roles.add(org_admin_role)

            invite = ActivationInvite.objects.create(
                organization=organization,
                user=org_admin,
                created_by=request.user,
                expires_at=timezone.now() + timezone.timedelta(days=INVITE_TTL_DAYS),
            )
            _dispatch_invite_email(org_admin.email, organization.name, invite.token)

        return Response(OrganizationSerializer(organization).data, status=status.HTTP_201_CREATED)


def _dispatch_invite_email(email, organization_name, token):
    from apps.notifications.tasks import send_invite_email

    send_invite_email.delay(email, organization_name, token)
