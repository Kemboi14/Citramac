"""
One-time (but safe-to-re-run) data fix: derives each Organization's
`email_domains` from the email addresses of its own real staff, for
organizations that predate `Organization.register_email_domain()` being
called automatically at invite time (see onboard_tenant/invite_staff and
apps.accounts.views.StaffViewSet/apps.tenancy.views.OrganizationListCreateView).

Without this, an org onboarded before that auto-registration existed — or
one created through the Super Admin "Add Organization" screen, whose
CreateOrganizationSerializer never had an email_domains field at all — has
staff whose real, active accounts nonetheless fail the tenant-branded
login's discovery step (apps.accounts.auth_views.TenantDiscoveryView),
since that step only ever matches against Organization.email_domains, never
against User.organization_id directly (see that view's own docstring for
why: matching by domain rather than by a specific user's account keeps the
step from ever confirming "does this exact email have an account").
"""

from django.core.management.base import BaseCommand

from apps.accounts.models import User
from apps.tenancy.context import platform_admin_context
from apps.tenancy.models import Organization


class Command(BaseCommand):
    help = (
        "Backfills Organization.email_domains from each org's actual staff "
        "email addresses, so tenant-branded login's discovery step can find "
        "organizations that were onboarded, or had staff added, before "
        "email_domains was kept automatically in sync. Safe to re-run."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would change without saving anything.",
        )

    def _domain_of(self, email):
        return (email or "").strip().rsplit("@", 1)[-1].casefold()

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        updated = 0
        with platform_admin_context():
            for organization in Organization.objects.all():
                before = {d.casefold() for d in organization.email_domains}
                staff_emails = (
                    User.all_objects.filter(organization=organization)
                    .exclude(email="")
                    .values_list("email", flat=True)
                )
                staff_domains = {self._domain_of(email) for email in staff_emails}
                staff_domains.discard("")
                target = before | staff_domains

                if target == before:
                    continue

                updated += 1
                verb = "Would update" if dry_run else "Updated"
                self.stdout.write(f"{verb} '{organization.slug}': {sorted(target)}")
                if not dry_run:
                    organization.email_domains = sorted(target)
                    organization.save(update_fields=["email_domains"])

        if dry_run:
            self.stdout.write(
                self.style.WARNING(f"--dry-run: {updated} organization(s) would change.")
            )
        else:
            self.stdout.write(self.style.SUCCESS(f"Updated {updated} organization(s)."))
