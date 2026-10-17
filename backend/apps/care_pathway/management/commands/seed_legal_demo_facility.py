"""
DEMO ONLY — never run against a real tenant's production data.

Fills one organisation's facility profile (Branch + Organization contact fields)
with the details printed in the CAfRIC form footers quoted in the master prompt
§7A, so the statutory print view can be demonstrated. Production facility data
is entered by the tenant in Branch Settings; nothing here is read by the module.

OQ-13: the two paper forms print different addresses (Lake Bogoria Avenue,
Golf-View Estate vs Githingiri Estate, both Murang'a County). One canonical
address is required; which one is current is unconfirmed, so --address picks it
explicitly and there is no default.
"""

from django.core.management.base import BaseCommand, CommandError

from apps.tenancy.context import platform_admin_context
from apps.tenancy.models import Branch, Organization

ADDRESSES = {
    "golf-view": "Lake Bogoria Avenue, Golf-View Estate, Murang'a County\nP.O. Box 31502-00600 Nairobi",
    "githingiri": "Githingiri Estate, Murang'a County\nP.O. Box 31502-00600 Nairobi",
}


class Command(BaseCommand):
    help = "DEMO ONLY: seed a facility profile from the CAfRIC form footers (master prompt §7A)."

    def add_arguments(self, parser):
        parser.add_argument("org_slug")
        parser.add_argument("--address", choices=sorted(ADDRESSES), required=True,
                            help="OQ-13: which printed address to use (unconfirmed which is current).")
        parser.add_argument("--i-understand-this-is-demo-data", action="store_true", dest="confirmed")

    def handle(self, org_slug, address, confirmed, **_):
        if not confirmed:
            raise CommandError("Demo data only. Re-run with --i-understand-this-is-demo-data.")
        with platform_admin_context():
            org = Organization.objects.filter(slug=org_slug).first()
            if org is None:
                raise CommandError(f"No organisation with slug {org_slug!r}.")
            org.support_email = org.support_email or "info@cafric.org"
            org.website = org.website or "https://www.cafric.org"
            org.save(update_fields=["support_email", "website"])
            branch = Branch.all_objects.filter(organization=org).order_by("created_at").first()
            if branch is None:
                branch = Branch(organization=org, name="CAfRIC Centre", facility_level="L4")
            branch.address = ADDRESSES[address]
            branch.phone = "+254 793 888 475"
            branch.email = branch.email or "info@cafric.org"
            branch.save()
        self.stdout.write(self.style.WARNING(
            f"DEMO facility profile written to {org.name} / {branch.name}. Other printed phones: "
            "+254 768 489 345, +254 768 665 921 (Branch holds one)."
        ))
