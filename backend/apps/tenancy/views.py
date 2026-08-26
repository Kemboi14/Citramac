from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework import generics, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import ActivationInvite, Role, User
from apps.accounts.permissions import IsPlatformSuperAdmin, IsPlatformSuperAdminOrOrgAdmin
from apps.ipd_ward.models import Bed
from apps.tenancy.context import platform_admin_context

from .models import Branch, Organization, PlatformBranding, Subscription, SubscriptionPlan
from .serializers import (
    BranchSerializer,
    CreateOrganizationSerializer,
    OrganizationSerializer,
    OrganizationStatusSerializer,
    PlatformBrandingSerializer,
    SubscriptionPlanSerializer,
    SubscriptionSerializer,
)

INVITE_TTL_DAYS = 7


class OrganizationListCreateView(generics.ListCreateAPIView):
    """
    docs/04-MULTI-TENANCY.md §4.5 provisioning flow, step 1: "Super Admin
    creates the Organization record ... system generates a slug and a
    default Org Admin invite." Ties together the Phase 1 exit criteria in
    docs/11-ROADMAP-AND-PHASES.md: create an Organization, invite its Org
    Admin, and have that invite be a real, activatable ActivationInvite.

    Supports the Organizations screen's search/filter/group-by toolbar
    (citramac_SUPER-ADMIN.html): ?q=, ?status=, ?org_type=, ?ownership_type=.
    """

    permission_classes = [IsPlatformSuperAdmin]
    serializer_class = OrganizationSerializer

    def get_queryset(self):
        with platform_admin_context():
            queryset = Organization.objects.annotate(branch_count=Count("branch", distinct=True))
            params = self.request.query_params
            q = params.get("q")
            if q:
                queryset = queryset.filter(
                    Q(name__icontains=q) | Q(slug__icontains=q) | Q(dha_facility_code__icontains=q)
                )
            for field in ("status", "org_type", "ownership_type", "county"):
                value = params.get(field)
                if value:
                    queryset = queryset.filter(**{field: value})
            return list(queryset.order_by("-created_at"))

    def create(self, request, *args, **kwargs):
        serializer = CreateOrganizationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with platform_admin_context(), transaction.atomic():
            organization = Organization.objects.create(
                name=data["name"],
                slug=data["slug"],
                org_type=data.get("org_type", "HOSPITAL"),
                facility_type=data.get("facility_type", ""),
                ownership_type=data.get("ownership_type", "PRIVATE"),
                dha_facility_code=data.get("dha_facility_code", ""),
                county=data.get("county", ""),
                sub_county=data.get("sub_county", ""),
                status=Organization.STATUS_PENDING,
                logo_url=data.get("logo_url", ""),
                tagline=data.get("tagline", ""),
                primary_color=data.get("primary_color") or "#006e51",
                support_email=data.get("support_email", ""),
                support_phone=data.get("support_phone", ""),
                website=data.get("website", ""),
            )

            plan_code = data.get("subscription_plan_code")
            if plan_code:
                plan = SubscriptionPlan.objects.filter(code=plan_code).first()
                if plan:
                    organization.subscription_plan = plan
                    organization.save(update_fields=["subscription_plan"])
                    Subscription.objects.create(
                        organization=organization,
                        plan=plan,
                        billing_cycle=data.get("billing_cycle", "ANNUAL"),
                        current_period_end=timezone.now().date() + timedelta(days=365),
                    )

            org_admin_data = data["org_admin"]
            org_admin = User.objects.create_user(
                email=org_admin_data["email"],
                organization=organization,
                first_name=org_admin_data["first_name"],
                last_name=org_admin_data["last_name"],
                phone=org_admin_data.get("phone", ""),
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


class OrganizationDetailView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsPlatformSuperAdmin]
    serializer_class = OrganizationSerializer

    def get_queryset(self):
        with platform_admin_context():
            return list(Organization.objects.annotate(branch_count=Count("branch", distinct=True)))


class OrganizationStatusView(APIView):
    """
    Suspend/reactivate/verify an organization (row-action menu on the
    Organizations table + Branch Settings "Certification Status" cards).
    A normal field write, so it lands in AuditLogEntry automatically via
    apps.sysadmin_audit's generic signal wiring — no extra logging code
    needed here.
    """

    permission_classes = [IsPlatformSuperAdmin]

    def post(self, request, pk):
        serializer = OrganizationStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with platform_admin_context():
            organization = generics.get_object_or_404(Organization, pk=pk)
            organization.status = serializer.validated_data["status"]
            if (
                organization.status == Organization.STATUS_ACTIVE
                and not organization.mfl_verified_at
            ):
                organization.mfl_verified_at = timezone.now()
            organization.save()
        return Response(OrganizationSerializer(organization).data)


LOGO_ALLOWED_EXTENSIONS = (".png", ".jpg", ".jpeg", ".svg", ".webp")
LOGO_MAX_SIZE_BYTES = 2 * 1024 * 1024


def _validate_logo_upload(request):
    """
    Shared validation for both the platform-wide logo (PlatformBrandingView)
    and a specific organization's logo (OrganizationLogoUploadView) — same
    rules, same error shape (apps.accounts.auth_views's `{"error": {code,
    message}}` convention, not DRF's default `{"detail": ...}`, so the
    frontend's ApiError parsing actually surfaces the message).

    Returns (file, None) on success, or (None, error_response) on failure.
    """
    logo = request.FILES.get("logo")
    if not logo:
        return None, Response(
            {"error": {"code": "NO_FILE", "message": "No file uploaded."}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not logo.name.lower().endswith(LOGO_ALLOWED_EXTENSIONS):
        return None, Response(
            {
                "error": {
                    "code": "UNSUPPORTED_FILE_TYPE",
                    "message": "Logo must be a PNG, JPG, WEBP, or SVG image.",
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if logo.size > LOGO_MAX_SIZE_BYTES:
        return None, Response(
            {"error": {"code": "FILE_TOO_LARGE", "message": "Logo must be 2MB or smaller."}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return logo, None


class OrganizationLogoUploadView(APIView):
    """
    Attach/replace a specific organization's own logo (Add/Edit Organization
    drawer's "Branding" section — citramac_SUPER-ADMIN-v4.html). Distinct
    from PlatformBrandingView: this sets `Organization.logo_url` (already a
    plain URLField, read by TenantDiscoveryView/TenantLoginStep for that
    org's branded login screen — docs/14-TENANT-BRANDED-LOGIN-UX.md), not the
    platform-wide mark. A real file upload, stored via Django's default
    storage under a per-org path, rather than requiring the caller to already
    have the image hosted somewhere and paste a URL — pasting a URL directly
    is still supported too, via the ordinary PATCH on OrganizationDetailView.
    """

    permission_classes = [IsPlatformSuperAdmin]

    def post(self, request, pk):
        from django.core.files.storage import default_storage

        logo, error_response = _validate_logo_upload(request)
        if error_response:
            return error_response

        with platform_admin_context():
            organization = generics.get_object_or_404(Organization, pk=pk)
            extension = logo.name.rsplit(".", 1)[-1].lower()
            stored_path = default_storage.save(
                f"organizations/logos/{organization.slug}.{extension}", logo
            )
            organization.logo_url = request.build_absolute_uri(default_storage.url(stored_path))
            organization.save(update_fields=["logo_url"])
        return Response(OrganizationSerializer(organization).data)


class PlatformBrandingView(APIView):
    """
    The CITRAMAC-the-product logo shown in every shell's sidebar and the
    generic (no-tenant-resolved) login screen — citramac_SUPER-ADMIN-v4.html.
    GET is intentionally open (AllowAny): the logo has to render on the login
    page before anyone has a token, and it isn't sensitive. Only Super Admin
    can upload a new one.
    """

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        return [IsPlatformSuperAdmin()]

    def get(self, request):
        branding = PlatformBranding.get_solo()
        return Response(PlatformBrandingSerializer(branding, context={"request": request}).data)

    def post(self, request):
        logo, error_response = _validate_logo_upload(request)
        if error_response:
            return error_response

        branding = PlatformBranding.get_solo()
        branding.logo = logo
        branding.updated_by = request.user
        branding.save()
        return Response(PlatformBrandingSerializer(branding, context={"request": request}).data)


class BranchViewSet(viewsets.ModelViewSet):
    """
    Super Admin: every branch across every tenant (Branches screen). Org
    Admin: only their own organization's branch(es) (Branch Settings screen)
    — enforced by TenantScopedManager auto-scoping for get_queryset() and
    IsPlatformSuperAdminOrOrgAdmin for object-level writes. Branch *creation*
    is Super-Admin-only (docs/04-MULTI-TENANCY.md §4.1).
    """

    serializer_class = BranchSerializer
    permission_classes = [IsPlatformSuperAdminOrOrgAdmin]
    org_admin_can_create = False

    def get_queryset(self):
        queryset = Branch.objects.annotate(
            ward_count=Count("ward", distinct=True),
        ).select_related("organization")
        params = self.request.query_params
        q = params.get("q")
        if q:
            queryset = queryset.filter(Q(name__icontains=q) | Q(mfl_code__icontains=q))
        for field in ("county", "facility_level", "ccp_registration_status"):
            value = params.get(field)
            if value:
                queryset = queryset.filter(**{field: value})
        return queryset.order_by("name")

    def perform_create(self, serializer):
        organization_id = self.request.data.get("organization")
        with platform_admin_context():
            organization = generics.get_object_or_404(Organization, pk=organization_id)
        serializer.save(
            organization=organization,
            ownership_type=serializer.validated_data.get(
                "ownership_type", organization.ownership_type
            ),
        )


class SubscriptionPlanViewSet(viewsets.ModelViewSet):
    """Catalog is platform-owned: Super Admin has full CRUD, everyone
    authenticated can read it (needed to render plan choices during
    onboarding and the Org Admin's own plan display)."""

    serializer_class = SubscriptionPlanSerializer
    queryset = SubscriptionPlan.objects.all()

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsAuthenticated()]
        return [IsPlatformSuperAdmin()]


class SubscriptionViewSet(viewsets.ModelViewSet):
    """Super Admin: every tenant's subscription (Subscriptions & Billing
    screen). Org Admin: read-only, their own org's subscription only."""

    serializer_class = SubscriptionSerializer
    permission_classes = [IsPlatformSuperAdminOrOrgAdmin]
    org_admin_can_create = False

    def get_queryset(self):
        return Subscription.objects.select_related("organization", "plan").order_by(
            "current_period_end"
        )

    def perform_create(self, serializer):
        organization_id = self.request.data.get("organization")
        with platform_admin_context():
            organization = generics.get_object_or_404(Organization, pk=organization_id)
        if Subscription.all_objects.filter(organization=organization).exists():
            raise ValidationError("This organization already has a subscription.")
        serializer.save(organization=organization)


class PlatformDashboardStatsView(APIView):
    """Stat cards + charts on the Super Admin Platform Dashboard."""

    permission_classes = [IsPlatformSuperAdmin]

    def get(self, request):
        from apps.sysadmin_audit.models import AuditLogEntry

        with platform_admin_context():
            total_orgs = Organization.objects.count()
            pending = Organization.objects.filter(status=Organization.STATUS_PENDING).count()
            active_users = User.all_objects.filter(is_active=True).count()
            total_branches = Branch.objects.count()

            month_start = timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            orgs_added_this_month = Organization.objects.filter(created_at__gte=month_start).count()
            branches_added_this_month = Branch.objects.filter(created_at__gte=month_start).count()
            users_added_this_month = User.all_objects.filter(created_at__gte=month_start).count()

            since = timezone.now() - timedelta(days=210)
            growth = list(
                Organization.objects.filter(created_at__gte=since)
                .annotate(month=TruncMonth("created_at"))
                .values("month")
                .annotate(count=Count("id"))
                .order_by("month")
            )
            by_level = list(
                Branch.objects.values("facility_level")
                .annotate(count=Count("id"))
                .order_by("facility_level")
            )
            recent = OrganizationSerializer(
                Organization.objects.annotate(branch_count=Count("branch", distinct=True)).order_by(
                    "-created_at"
                )[:5],
                many=True,
            ).data

            activity_rows = list(AuditLogEntry.objects.all()[:8])
            actor_ids = {row.actor_user_id for row in activity_rows if row.actor_user_id}
            org_ids = {row.organization_id for row in activity_rows if row.organization_id}
            actors = {
                str(u.id): u.get_full_name() for u in User.all_objects.filter(id__in=actor_ids)
            }
            orgs = {str(o.id): o.name for o in Organization.objects.filter(id__in=org_ids)}
            recent_activity = [
                {
                    "id": str(row.id),
                    "actor_name": actors.get(str(row.actor_user_id), "System"),
                    "organization_name": orgs.get(str(row.organization_id), ""),
                    "action": row.action,
                    "model": row.model,
                    "timestamp": row.timestamp,
                }
                for row in activity_rows
            ]

        return Response(
            {
                "total_organizations": total_orgs,
                "total_branches": total_branches,
                "active_users": active_users,
                "pending_verification": pending,
                "orgs_added_this_month": orgs_added_this_month,
                "branches_added_this_month": branches_added_this_month,
                "users_added_this_month": users_added_this_month,
                "organization_growth": [
                    {"month": row["month"].strftime("%Y-%m"), "count": row["count"]}
                    for row in growth
                ],
                "branches_by_facility_level": by_level,
                "recently_onboarded": recent,
                "recent_activity": recent_activity,
            }
        )


class OrgDashboardStatsView(APIView):
    """Stat cards on the Org Admin dashboard — bed occupancy, admissions
    today, outpatient/CCP volume, staff on duty, ward occupancy breakdown."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.ccp_program.models import PsychotherapySession
        from apps.client_registry.models import Patient
        from apps.ipd_ward.models import Admission, Ward

        organization = request.user.organization
        today = timezone.localdate()

        beds = Bed.objects.select_related("ward").filter(ward__organization=organization)
        total_beds = beds.count()
        occupied_beds = beds.filter(status="OCCUPIED").count()

        admissions_today = Admission.objects.filter(admitted_at__date=today).count()
        outpatient_today = Patient.objects.filter(
            created_at__date=today, patient_category="OUTPATIENT"
        ).count()
        ccp_sessions_today = PsychotherapySession.objects.filter(session_date__date=today).count()
        staff_on_duty = User.all_objects.filter(
            organization=organization, is_on_duty=True, is_active=True
        ).count()

        ward_breakdown = []
        for ward in Ward.objects.filter(organization=organization).order_by("name"):
            ward_beds = beds.filter(ward=ward)
            ward_breakdown.append(
                {
                    "id": str(ward.id),
                    "name": ward.name,
                    "occupied": ward_beds.filter(status="OCCUPIED").count(),
                    "total": ward_beds.count(),
                }
            )

        return Response(
            {
                "bed_occupancy_percent": (
                    round((occupied_beds / total_beds) * 100) if total_beds else 0
                ),
                "beds_occupied": occupied_beds,
                "beds_total": total_beds,
                "admissions_today": admissions_today,
                "outpatient_ccp_volume": outpatient_today + ccp_sessions_today,
                "staff_on_duty": staff_on_duty,
                "ward_occupancy": ward_breakdown,
            }
        )


def _dispatch_invite_email(email, organization_name, token):
    from apps.notifications.tasks import send_invite_email

    send_invite_email.delay(email, organization_name, token)
