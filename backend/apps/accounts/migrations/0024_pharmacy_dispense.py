"""
New permission pharmacy.dispense (2026-11-08). Until now any signed-in user
could dispense against any prescription. It is given to the Pharmacist
definition and every organisation's copy of it.
"""

from django.db import migrations

CODENAME = "pharmacy.dispense"


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
    for role in Role.objects.filter(system_key="pharmacist"):
        role.permissions.add(perm)


def backwards(apps, schema_editor):
    _bypass_rls(schema_editor)
    apps.get_model("accounts", "Permission").objects.filter(codename=CODENAME).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0023_laboratory_results_validate")]

    operations = [migrations.RunPython(forwards, backwards)]
