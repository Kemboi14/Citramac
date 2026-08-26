"""
Operational tenant-onboarding tool — docs/11-ROADMAP-AND-PHASES.md Phase 9
("Onboard CAfRIC Centre as the first production tenant end-to-end: Org
creation -> activation -> module bundle -> staff onboarding") implementing
the provisioning flow in docs/04-MULTI-TENANCY.md §4.5, runnable from the
command line (rather than only through OrganizationListCreateView) so it can
be scripted and re-run idempotently by ops without a Super Admin API session.
"""

import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import ActivationInvite, Role, User
from apps.tenancy.context import platform_admin_context
from apps.tenancy.models import Branch, Organization

INVITE_TTL_DAYS = 7

# docs/04-MULTI-TENANCY.md §4.4's MENTAL_HEALTH_CCP bundle, expressed as the
# app labels actually present in settings.LOCAL_APPS for this deployment.
# This deployment never installs apps.ris_pacs/theatre/mch/mortuary at all
# (see config/settings/base.py), so a GENERAL_HOSPITAL bundle has no meaning
# here — this command deliberately only knows how to onboard the one
# facility type this build can actually serve.
MENTAL_HEALTH_CCP_BUNDLE = [
    "client_registry",
    "triage",
    "clinical_encounter",
    "pharmacy",
    "lims",
    "ipd_ward",
    "billing",
    "insurance_claims",
    "sysadmin_audit",
    "ccp_program",
]


class Command(BaseCommand):
    help = (
        "Onboard a mental-health/CCP tenant Organization end-to-end: create "
        "the Organization, assign its module bundle, create/invite the Org "
        "Admin, and optionally bulk-invite initial staff from a JSON spec "
        "file. Idempotent — safe to re-run against an Organization that "
        "already exists (matched by --slug)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True, help="Organization display name")
        parser.add_argument("--slug", required=True, help="Unique Organization slug")
        parser.add_argument("--dha-facility-code", default="")
        parser.add_argument("--sha-provider-code", default="")
        parser.add_argument("--admin-email", required=True)
        parser.add_argument("--admin-first-name", required=True)
        parser.add_argument("--admin-last-name", required=True)
        parser.add_argument("--branch-name", default="", help="Creates a first Branch if given")
        parser.add_argument(
            "--branch-level",
            default="L4",
            choices=[code for code, _ in Branch.FACILITY_LEVEL_CHOICES],
        )
        parser.add_argument("--county", default="")
        parser.add_argument(
            "--email-domain",
            action="append",
            default=[],
            dest="email_domains",
            help=(
                "Email domain that routes to this tenant on the login screen "
                "(docs/14-TENANT-BRANDED-LOGIN-UX.md), e.g. cafric.org. Repeatable."
            ),
        )
        parser.add_argument("--logo-url", default="")
        parser.add_argument("--login-image-url", default="")
        parser.add_argument("--tagline", default="")
        parser.add_argument("--primary-color", default="")
        parser.add_argument("--support-email", default="")
        parser.add_argument("--support-phone", default="")
        parser.add_argument("--website", default="")
        parser.add_argument(
            "--staff-file",
            default="",
            help=(
                "Path to a JSON file containing a list of staff to bulk-invite, each "
                'as {"email": ..., "first_name": ..., "last_name": ..., "role": ..., '
                '"staff_id": ...}. "role" must match an existing platform template '
                'Role name (e.g. "Doctor", "Clinical Psychologist/Therapist", '
                '"Lab Technician").'
            ),
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Run the full flow and print what would happen, then roll everything back.",
        )

    def handle(self, *args, **options):
        staff_specs = self._load_staff_file(options["staff_file"])

        with platform_admin_context(), transaction.atomic():
            organization = self._upsert_organization(options)
            branch = self._upsert_branch(organization, options)
            self._onboard_admin(organization, options)
            for spec in staff_specs:
                self._onboard_staff_member(organization, branch, spec)

            if options["dry_run"]:
                self.stdout.write(self.style.WARNING("--dry-run: rolling back, nothing was saved."))
                transaction.set_rollback(True)

    def _load_staff_file(self, path):
        if not path:
            return []
        with open(path) as fh:
            specs = json.load(fh)
        for spec in specs:
            missing = {"email", "first_name", "last_name", "role"} - spec.keys()
            if missing:
                raise CommandError(f"Staff entry {spec} missing required field(s): {missing}")
        return specs

    # Branding fields (docs/14-TENANT-BRANDED-LOGIN-UX.md) — CLI flag name to
    # Organization field name, since --primary-color etc. don't match 1:1.
    _BRANDING_FIELDS = {
        "email_domains": "email_domains",
        "logo_url": "logo_url",
        "login_image_url": "login_image_url",
        "tagline": "tagline",
        "primary_color": "primary_color",
        "support_email": "support_email",
        "support_phone": "support_phone",
        "website": "website",
    }

    def _upsert_organization(self, options):
        branding_defaults = {
            field: options[opt_key]
            for opt_key, field in self._BRANDING_FIELDS.items()
            if options.get(opt_key)
        }
        organization, created = Organization.objects.get_or_create(
            slug=options["slug"],
            defaults={
                "name": options["name"],
                "facility_type": "MENTAL_HEALTH_CCP",
                "dha_facility_code": options["dha_facility_code"],
                "sha_provider_code": options["sha_provider_code"],
                "enabled_modules": MENTAL_HEALTH_CCP_BUNDLE,
                **branding_defaults,
            },
        )
        if created:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Created Organization '{organization.name}' ({organization.slug})"
                )
            )
        else:
            self.stdout.write(
                f"Organization '{organization.slug}' already exists — updating module bundle"
            )
            organization.enabled_modules = MENTAL_HEALTH_CCP_BUNDLE
            if options["dha_facility_code"]:
                organization.dha_facility_code = options["dha_facility_code"]
            if options["sha_provider_code"]:
                organization.sha_provider_code = options["sha_provider_code"]
            for field, value in branding_defaults.items():
                setattr(organization, field, value)
            organization.save(
                update_fields=[
                    "enabled_modules",
                    "dha_facility_code",
                    "sha_provider_code",
                    *branding_defaults.keys(),
                ]
            )
        return organization

    def _upsert_branch(self, organization, options):
        if not options["branch_name"]:
            return None
        branch, created = Branch.objects.get_or_create(
            organization=organization,
            name=options["branch_name"],
            defaults={
                "facility_level": options["branch_level"],
                "county": options["county"],
            },
        )
        verb = "Created" if created else "Found existing"
        self.stdout.write(f"{verb} Branch '{branch.name}'")
        return branch

    def _onboard_admin(self, organization, options):
        self._invite_user(
            organization=organization,
            email=options["admin_email"],
            first_name=options["admin_first_name"],
            last_name=options["admin_last_name"],
            role_name="Org Admin",
            branch=None,
        )

    def _onboard_staff_member(self, organization, branch, spec):
        self._invite_user(
            organization=organization,
            email=spec["email"],
            first_name=spec["first_name"],
            last_name=spec["last_name"],
            role_name=spec["role"],
            branch=branch,
            staff_id=spec.get("staff_id", ""),
        )

    def _invite_user(
        self, *, organization, email, first_name, last_name, role_name, branch, staff_id=""
    ):
        user, created = User.objects.get_or_create(
            email=email,
            defaults={
                "organization": organization,
                "first_name": first_name,
                "last_name": last_name,
                "staff_id": staff_id,
                "is_active": False,
            },
        )
        if not created:
            self.stdout.write(f"User '{email}' already exists — leaving activation state untouched")
        else:
            self.stdout.write(f"Created inactive User '{email}'")

        if branch is not None:
            user.branch_access.add(branch)

        role = Role.objects.filter(name=role_name, organization__isnull=True).first()
        if role is None:
            raise CommandError(f"No platform template Role named '{role_name}' exists")
        user.roles.add(role)

        if created:
            invite = ActivationInvite.objects.create(
                organization=organization,
                user=user,
                created_by=None,
                expires_at=timezone.now() + timezone.timedelta(days=INVITE_TTL_DAYS),
            )
            self._dispatch_invite_email(user.email, organization.name, invite.token)
            self.stdout.write(
                f"  -> activation invite dispatched (token starts {invite.token[:8]}...)"
            )

    def _dispatch_invite_email(self, email, organization_name, token):
        from apps.notifications.tasks import send_invite_email

        send_invite_email.delay(email, organization_name, token)
