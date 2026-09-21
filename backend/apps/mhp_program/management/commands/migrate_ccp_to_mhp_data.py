from django.core.management.base import BaseCommand
from django.db import connection, transaction

# One-time data migration for the ccp_program -> mhp_program app rename
# (2026-09-21). `manage.py migrate` alone cannot do this: Django computes
# table names from the app label, so once the app is renamed, `migrate`
# would just create brand-new empty mhp_program_* tables and leave the real
# ccp_program_* ones (and any environment that already ran the old
# migrations under that label) orphaned. This command does the physical
# rename in place instead, and fixes the handful of places the rename
# would otherwise silently break: Django's own migration/content-type
# bookkeeping, and the literal "ccp"-bearing data values it created
# (accounts_permission codenames, Organization.facility_type,
# Organization.enabled_modules).
#
# Every step is a no-op if there's nothing matching (fresh database, or a
# database this has already been run against), so this is safe to run
# unconditionally as part of a deploy, before `manage.py migrate`.
TABLE_RENAMES = [
    ("ccp_program_biopsychosocialassessment", "mhp_program_biopsychosocialassessment"),
    ("ccp_program_careteammembership", "mhp_program_careteammembership"),
    ("ccp_program_clinicalreview", "mhp_program_clinicalreview"),
    ("ccp_program_nacadandoreport", "mhp_program_nacadandoreport"),
    ("ccp_program_psychotherapysession", "mhp_program_psychotherapysession"),
    ("ccp_program_rehabmilestone", "mhp_program_rehabmilestone"),
    ("ccp_program_reviewofsystementry", "mhp_program_reviewofsystementry"),
    ("ccp_program_substanceuseentry", "mhp_program_substanceuseentry"),
    ("ccp_program_sudrehabplan", "mhp_program_sudrehabplan"),
    ("ccp_program_supervisionrequest", "mhp_program_supervisionrequest"),
    ("ccp_program_urinedrugscreen", "mhp_program_urinedrugscreen"),
]

PERMISSION_CODENAME_RENAMES = [
    ("org.ccp.view", "org.mhp.view"),
    ("org.ccp.create", "org.mhp.create"),
    ("org.ccp.edit", "org.mhp.edit"),
    ("org.ccp.delete", "org.mhp.delete"),
]


class Command(BaseCommand):
    help = "One-time data fixup for the ccp_program -> mhp_program app rename. Idempotent."

    @transaction.atomic
    def handle(self, *args, **options):
        with connection.cursor() as cur:
            for old, new in TABLE_RENAMES:
                cur.execute(f"ALTER TABLE IF EXISTS {old} RENAME TO {new}")
                self.stdout.write(f"table: {old} -> {new} (or already renamed / never existed)")

            cur.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'tenancy_branch' AND column_name = 'ccp_registration_status'
                """
            )
            if cur.fetchone():
                cur.execute(
                    "ALTER TABLE tenancy_branch "
                    "RENAME COLUMN ccp_registration_status TO mhp_registration_status"
                )
                self.stdout.write("column: tenancy_branch.ccp_registration_status -> mhp_registration_status")
            else:
                self.stdout.write("column: tenancy_branch already has mhp_registration_status, skipped")

            cur.execute("UPDATE django_migrations SET app = 'mhp_program' WHERE app = 'ccp_program'")
            self.stdout.write(f"django_migrations rows repointed: {cur.rowcount}")

            cur.execute(
                "UPDATE django_content_type SET app_label = 'mhp_program' WHERE app_label = 'ccp_program'"
            )
            self.stdout.write(f"django_content_type rows repointed: {cur.rowcount}")

        from apps.accounts.models import Permission
        from apps.tenancy.models import Organization

        for old, new in PERMISSION_CODENAME_RENAMES:
            updated = Permission.objects.filter(codename=old).update(codename=new)
            if updated:
                self.stdout.write(f"permission codename: {old} -> {new} ({updated} row)")

        org_updated = Organization.objects.filter(facility_type="MENTAL_HEALTH_CCP").update(
            facility_type="MENTAL_HEALTH_MHP"
        )
        if org_updated:
            self.stdout.write(f"Organization.facility_type: MENTAL_HEALTH_CCP -> MENTAL_HEALTH_MHP ({org_updated} rows)")

        for org in Organization.objects.filter(enabled_modules__contains=["ccp_program"]):
            org.enabled_modules = [
                "mhp_program" if module == "ccp_program" else module for module in org.enabled_modules
            ]
            org.save(update_fields=["enabled_modules"])
            self.stdout.write(f"Organization({org.pk}).enabled_modules: ccp_program -> mhp_program")

        self.stdout.write(self.style.SUCCESS("ccp_program -> mhp_program data migration complete"))
