"""
New permission clinical.care_team.assign (2026-11-12). Until now only the Org
Admin could assign a client's care team. It is given to the Clinical Supervisor
definition and every organisation's copy of it; Org Admin can always assign.
"""

from django.db import migrations

CODENAME = "clinical.care_team.assign"


def _bypass_rls(schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def forwards(apps, schema_editor):
    from apps.accounts.catalogue import PERMISSIONS

    _bypass_rls(schema_editor)
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    _, module, label, description, scope, _ = next(p for p in PERMISSIONS if p[0] == CODENAME)
    perm, _ = Permission.objects.update_or_create(
        codename=CODENAME,
        defaults={"label": label, "description": description, "module": module, "scope": scope},
    )
    for role in Role.objects.filter(system_key="clinical_supervisor"):
        role.permissions.add(perm)


def backwards(apps, schema_editor):
    _bypass_rls(schema_editor)
    apps.get_model("accounts", "Permission").objects.filter(codename=CODENAME).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0026_practitioner_documents")]

    operations = [migrations.RunPython(forwards, backwards)]
