# reports.nacada.send — emailing the NACADA NDO report out of the system. New
# ability with no prior holders: Org Admin can always send (owner, 2026-11-03),
# and an Org Admin ticks it on whichever other roles should, in Roles &
# Permissions. So this only creates the permission; no role is granted it.


from django.db import migrations

from apps.tenancy.context import platform_admin_context

CODENAME = "reports.nacada.send"


def create(apps, schema_editor):
    from apps.accounts.catalogue import PERMISSIONS

    Permission = apps.get_model("accounts", "Permission")
    _, module, label, description, scope, _ = next(p for p in PERMISSIONS if p[0] == CODENAME)
    with platform_admin_context():
        Permission.objects.update_or_create(
            codename=CODENAME,
            defaults={
                "label": label,
                "description": description,
                "module": module,
                "scope": scope,
            },
        )


def remove(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    with platform_admin_context():
        Permission.objects.filter(codename=CODENAME).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0017_records_identity_merge")]

    operations = [migrations.RunPython(create, remove)]
