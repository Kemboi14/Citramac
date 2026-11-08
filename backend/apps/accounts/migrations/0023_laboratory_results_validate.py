"""
New permission laboratory.results.validate (2026-11-08). Until now any signed-in
user could validate a laboratory result. It is given to the Lab Technician
definition and to every organisation's copy of it: the role that already sees
unvalidated results. Auditors keep read access and do not get this one.
"""

from django.db import migrations

CODENAME = "laboratory.results.validate"


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
    for role in Role.objects.filter(system_key="lab_technician"):
        role.permissions.add(perm)


def backwards(apps, schema_editor):
    _bypass_rls(schema_editor)
    apps.get_model("accounts", "Permission").objects.filter(codename=CODENAME).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0022_practitioner_profile_roles")]

    operations = [migrations.RunPython(forwards, backwards)]
