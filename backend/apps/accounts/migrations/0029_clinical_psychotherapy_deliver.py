"""
New permission clinical.psychotherapy.deliver (2026-11-24). Until now any
signed-in user could start, write and sign a psychotherapy session note or record
a group session. It is given to the Clinical Psychologist/Therapist, Therapist,
Counsellor, Clinical Supervisor and Supervisor definitions and every
organisation's copy of them. An Org Admin can give it to any other role.
"""

from django.db import migrations

CODENAME = "clinical.psychotherapy.deliver"
ROLE_KEYS = ("clinical_psychologist", "therapist", "counsellor", "clinical_supervisor", "supervisor")


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
    dependencies = [("accounts", "0028_clinical_supervision_manage")]

    operations = [migrations.RunPython(forwards, backwards)]
