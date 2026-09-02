"""
Add a single staff member to an *existing* Organization, real activation
email and all. Deliberately narrower than `onboard_tenant`: that command
upserts the Organization itself (name, branding, module bundle) alongside
staff, which is exactly right for provisioning a brand-new tenant but risks
silently overwriting a live org's branding/config fields if re-run with
slightly different flags. This command only ever reads the Organization
(errors if the slug doesn't exist) and touches the one User being invited —
same User/Role/ActivationInvite pattern as onboard_tenant's own
`_invite_user`, just without any Organization-level side effects.
"""

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.accounts.models import ActivationInvite, Role, User
from apps.tenancy.context import platform_admin_context
from apps.tenancy.models import Branch, Organization

INVITE_TTL_DAYS = 7


class Command(BaseCommand):
    help = (
        "Invite one staff member into an existing Organization (matched by "
        "--org-slug) — creates an inactive User, assigns a platform template "
        "Role, and dispatches a real ActivationInvite email. Safe to re-run: "
        "an existing User with that email is left untouched, not re-invited."
    )

    def add_arguments(self, parser):
        parser.add_argument("--org-slug", required=True)
        parser.add_argument("--email", required=True)
        parser.add_argument("--first-name", required=True)
        parser.add_argument("--last-name", required=True)
        parser.add_argument(
            "--role",
            required=True,
            help=(
                "Must match an existing platform template Role name, e.g. "
                '"Doctor", "Nurse", "Clinical Psychologist/Therapist", '
                '"Lab Technician", "Pharmacist".'
            ),
        )
        parser.add_argument("--staff-id", default="")
        parser.add_argument(
            "--branch-name",
            default="",
            help="Existing Branch name within this org to grant branch_access to.",
        )

    def handle(self, *args, **options):
        with platform_admin_context():
            organization = Organization.objects.filter(slug=options["org_slug"]).first()
            if organization is None:
                raise CommandError(f"No Organization with slug '{options['org_slug']}' exists")

            role = Role.objects.filter(name=options["role"], organization__isnull=True).first()
            if role is None:
                raise CommandError(f"No platform template Role named '{options['role']}' exists")

            branch = None
            if options["branch_name"]:
                branch = Branch.objects.filter(
                    organization=organization, name=options["branch_name"]
                ).first()
                if branch is None:
                    raise CommandError(
                        f"No Branch named '{options['branch_name']}' in "
                        f"'{organization.name}' exists"
                    )

            email = options["email"].strip().lower()
            user, created = User.objects.get_or_create(
                email=email,
                defaults={
                    "organization": organization,
                    "first_name": options["first_name"],
                    "last_name": options["last_name"],
                    "staff_id": options["staff_id"],
                    "is_active": False,
                },
            )
            if not created:
                self.stdout.write(
                    self.style.WARNING(f"User '{email}' already exists — nothing to invite")
                )
                return

            if branch is not None:
                user.branch_access.add(branch)
            user.roles.add(role)

            invite = ActivationInvite.objects.create(
                organization=organization,
                user=user,
                created_by=None,
                expires_at=timezone.now() + timezone.timedelta(days=INVITE_TTL_DAYS),
            )

            from apps.notifications.tasks import send_invite_email

            send_invite_email.delay(
                user.email, organization.name, invite.token, organization_id=organization.id
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Created inactive User '{email}' with role '{options['role']}' in "
                f"'{organization.name}'; activation invite dispatched "
                f"(token starts {invite.token[:8]}...)."
            )
        )
