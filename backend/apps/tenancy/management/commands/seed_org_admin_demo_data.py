"""
Fills in the operational data the new Org Admin / Super Admin console
screens need to render something real for the demo org: a Branch (there was
none — `onboard_tenant` creates an org + admin but a Branch is optional and
was never added for cafric-demo), Wards/Beds with a realistic occupancy mix,
a SubscriptionPlan + Subscription, and role/on-duty assignments for the
existing demo users.

Idempotent — get_or_creates everything, safe to re-run.
"""

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.ipd_ward.models import Bed, Ward
from apps.tenancy.context import set_tenant_context
from apps.tenancy.models import Branch, Organization, Subscription, SubscriptionPlan

WARDS = [
    ("Male Ward", "General", [("M-01", "OCCUPIED"), ("M-02", "AVAILABLE"), ("M-03", "OCCUPIED")]),
    ("Female Ward", "General", [("F-01", "OCCUPIED"), ("F-02", "AVAILABLE")]),
    (
        "Rehab Wing",
        "SUD Rehab",
        [("R-01", "OCCUPIED"), ("R-02", "RESERVED"), ("R-03", "AVAILABLE")],
    ),
    ("Isolation", "Isolation", [("I-01", "MAINTENANCE"), ("I-02", "AVAILABLE")]),
]


class Command(BaseCommand):
    help = "Seed a Branch, Wards/Beds, Subscription, and staff assignments for the demo org."

    def add_arguments(self, parser):
        parser.add_argument("--org-slug", default="cafric-demo")

    def handle(self, *args, **options):
        try:
            organization = Organization.objects.get(slug=options["org_slug"])
        except Organization.DoesNotExist as exc:
            raise CommandError(f"No Organization with slug '{options['org_slug']}'") from exc

        set_tenant_context(organization_id=organization.id)

        branch, created = Branch.objects.get_or_create(
            organization=organization,
            name="Chiromo Branch",
            defaults={
                "facility_level": "L4",
                "ownership_type": "PRIVATE",
                "address": "Chiromo Road, Westlands, Nairobi County",
                "county": "Nairobi",
                "sub_county": "Westlands",
                "mfl_code": "MFL-14238",
                "phone": "+254700112233",
                "email": "chiromo@cafric-demo.test",
                "outpatient_capacity_per_day": 40,
                "ccp_registration_status": "OPEN",
                "mpesa_paybill_enabled": True,
                "sms_reminders_enabled": True,
            },
        )
        self.stdout.write(f"Branch: {branch.name} ({'created' if created else 'exists'})")

        for ward_name, ward_type, beds in WARDS:
            ward, _ = Ward.objects.get_or_create(
                organization=organization,
                name=ward_name,
                defaults={"branch": branch, "ward_type": ward_type},
            )
            if ward.branch_id != branch.id:
                ward.branch = branch
                ward.save(update_fields=["branch"])
            for bed_number, status in beds:
                bed, _ = Bed.objects.get_or_create(
                    organization=organization,
                    ward=ward,
                    bed_number=bed_number,
                    defaults={"status": status},
                )
                if bed.status != status:
                    bed.status = status
                    bed.save(update_fields=["status"])
        self.stdout.write(f"Wards/beds seeded across {len(WARDS)} wards.")

        plan, _ = SubscriptionPlan.objects.get_or_create(
            code="growth",
            defaults={
                "name": "Growth",
                "max_branches": 5,
                "max_staff_seats": 50,
                "included_modules": organization.enabled_modules,
                "price_monthly": "18500.00",
            },
        )
        if not Subscription.all_objects.filter(organization=organization).exists():
            Subscription.objects.create(
                organization=organization,
                plan=plan,
                billing_cycle="ANNUAL",
                current_period_end=timezone.now().date() + timedelta(days=200),
                seats_used=User.all_objects.filter(organization=organization).count(),
            )
            self.stdout.write("Subscription: created (Growth plan)")
        else:
            self.stdout.write("Subscription: exists")

        clinician = User.all_objects.filter(
            organization=organization, email="demo.clinician@cafric.test"
        ).first()
        if clinician:
            psychiatrist_role = Role.objects.filter(
                name="Psychiatrist", organization__isnull=True
            ).first()
            if psychiatrist_role and not clinician.roles.filter(pk=psychiatrist_role.pk).exists():
                clinician.roles.add(psychiatrist_role)
            clinician.primary_branch = branch
            clinician.branch_access.add(branch)
            clinician.is_on_duty = True
            clinician.save(update_fields=["primary_branch", "is_on_duty"])

        labtech = User.all_objects.filter(
            organization=organization, email="demo.labtech@cafric.test"
        ).first()
        if labtech:
            labtech.primary_branch = branch
            labtech.branch_access.add(branch)
            labtech.is_on_duty = False
            labtech.save(update_fields=["primary_branch", "is_on_duty"])

        org_admin = User.all_objects.filter(
            organization=organization, email="demo.orgadmin@cafric.test"
        ).first()
        if org_admin:
            org_admin.primary_branch = branch
            org_admin.branch_access.add(branch)
            org_admin.save(update_fields=["primary_branch"])

        self.stdout.write(self.style.SUCCESS("Org Admin demo data seeded."))
