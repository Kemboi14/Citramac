"""
Read-only probe of the configured DHA HIE (normally UAT): signs in, looks each
SHA branch up in the Facility Registry, and — when given a test identifier —
runs a Client Registry search, an eligibility check and an interventions
lookup. It prints the *shape* of each answer (field names and value types,
with values masked) so the open VERIFY items in hie_spec/SOURCE.md can be
settled against real responses: the eligibility coverage-status vocabulary,
the biometric iframe field, the facility contract-status wording.

Nothing is written except the ShaTransactionLog rows every HIE call leaves and
the branches' Facility Registry snapshot. Use only UAT test identities.

    python manage.py dha_uat_probe
    python manage.py dha_uat_probe --id-type "National ID" --id-number <UAT test id>
"""

from django.core.management.base import BaseCommand

from apps.dha_interop import hie_api, registries
from apps.tenancy.context import platform_admin_context
from apps.tenancy.models import Branch


def shape(value, depth=0):
    """Field names and types, values masked (except short status-like strings)."""
    if isinstance(value, dict):
        return {k: shape(v, depth + 1) for k, v in value.items()} if depth < 4 else "{…}"
    if isinstance(value, list):
        return [shape(value[0], depth + 1)] if value else []
    if isinstance(value, str):
        # Upper-case enum-like tokens are what the VERIFY items need to see.
        if value and value.replace("_", "").replace("-", "").isalpha() and value.isupper():
            return value
        return f"<str len={len(value)}>"
    return type(value).__name__


class Command(BaseCommand):
    help = "Read-only probe of the configured DHA HIE (UAT): prints response shapes."

    def add_arguments(self, parser):
        parser.add_argument("--id-type", default="", choices=["", *registries.CLIENT_ID_TYPE_VALUES])
        parser.add_argument("--id-number", default="")

    def handle(self, *args, **options):
        result = hie_api.test_connection()
        self.stdout.write(("OK  " if result["success"] else "FAIL ") + result["message"])
        if not result["success"]:
            return
        with platform_admin_context():
            branches = list(
                Branch.objects.unscoped().filter(is_active=True).exclude(sha_fr_code="")
            )
            for branch in branches:
                try:
                    registries.verify_branch_facility(branch)
                    self.stdout.write(f"\nFacility {branch.name} ({branch.sha_fr_code}):")
                    self.stdout.write(repr(shape(branch.registry_record)))
                except registries.RegistryError as exc:
                    self.stdout.write(f"\nFacility {branch.name}: {exc.message}")
            if not (options["id_type"] and options["id_number"]):
                return
            branch = next((b for b in branches if b.sha_claims_enabled), None)
            try:
                record = registries.search_client(None, options["id_type"], options["id_number"])
            except registries.RegistryError as exc:
                self.stdout.write(f"\nClient Registry: {exc.message}")
                return
            self.stdout.write("\nClient Registry: " + repr(shape(record)))
            if branch is None or not record:
                return
            for path, params, kind in (
                (
                    "/patients/eligibility",
                    {"identification_type": "ClientRegistry ID", "identification_number": record["id"]},
                    "MEMBER_VERIFICATION",
                ),
                (
                    "/patients/benefits/interventions",
                    {"patient_id": record["id"], "page_size": "5"},
                    "BENEFITS_LOOKUP",
                ),
            ):
                try:
                    body = hie_api.call(
                        "GET", path, transaction_type=kind, branch=branch, params=params
                    )
                    self.stdout.write(f"\n{path}: " + repr(shape(body)))
                except (hie_api.HieError, hie_api.HieNotConfigured) as exc:
                    self.stdout.write(f"\n{path}: {exc}")
