"""
RoleAssignment: row-level security, and the assignments existing staff
already implied — each role held at each branch in branch_access, or
organization-wide for Org Admin and for anyone with no branch at all.

Also stamps the one branch of a single-branch organization onto its
episodes, appointments and encounters that have none: otherwise they would
become visible at every branch the day a second branch is added
(apps.tenancy.branch_scope). Organizations that already have several branches
are left alone — which branch an old record belongs to is not knowable here.
"""

from django.db import migrations

from apps.tenancy.rls import enable_rls


def _bypass_rls(schema_editor):
    # Transaction-local (third argument true): ends with this migration.
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def backfill(apps, schema_editor):
    _bypass_rls(schema_editor)
    User = apps.get_model("accounts", "User")
    RoleAssignment = apps.get_model("accounts", "RoleAssignment")
    Branch = apps.get_model("tenancy", "Branch")

    for user in User.objects.filter(organization__isnull=False).prefetch_related(
        "roles", "branch_access"
    ):
        branches = list(user.branch_access.all())
        for role in user.roles.all():
            org_wide = role.name.strip().lower() == "org admin" or not branches
            for branch in [None] if org_wide else branches:
                RoleAssignment.objects.get_or_create(
                    organization_id=user.organization_id, user=user, role=role, branch=branch
                )

    stamped = [
        apps.get_model("care_pathway", "EpisodeOfCare"),
        apps.get_model("client_registry", "Appointment"),
        apps.get_model("clinical_encounter", "Encounter"),
    ]
    by_org = {}
    for branch in Branch.objects.all():
        by_org.setdefault(branch.organization_id, []).append(branch)
    for organization_id, branches in by_org.items():
        if len(branches) != 1:
            continue
        for model in stamped:
            model.objects.filter(organization_id=organization_id, branch__isnull=True).update(
                branch=branches[0]
            )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0014_role_assignments_nacada"),
        ("care_pathway", "0046_alter_consenttemplate_consent_type"),
        ("client_registry", "0023_alter_consentrecord_consent_type"),
        ("clinical_encounter", "0007_prescription_item_prn_checks"),
    ]

    operations = [
        migrations.RunSQL(*enable_rls("accounts_roleassignment")),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
