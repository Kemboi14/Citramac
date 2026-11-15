"""
New permission clinical.supervision.manage (2026-11-15). Until now only the
supervisor who took a request could complete it, and nobody could supervise
their own request. It is given to the Clinical Supervisor, Supervisor and
Psychiatrist definitions and every organisation's copy of them; Org Admin and
Super Admin can always manage the queue.
"""

from django.db import migrations

CODENAME = "clinical.supervision.manage"
ROLE_KEYS = ("clinical_supervisor", "supervisor", "psychiatrist")


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
    for role in Role.objects.filter(system_key__in=ROLE_KEYS):
        role.permissions.add(perm)


def backwards(apps, schema_editor):
    _bypass_rls(schema_editor)
    apps.get_model("accounts", "Permission").objects.filter(codename=CODENAME).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0027_clinical_care_team_assign")]

    operations = [migrations.RunPython(forwards, backwards)]
