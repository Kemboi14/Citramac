# records.identity.merge — merging a temporary (unidentified / unknown) record
# into an identified client. Before this permission existed any signed-in user
# could merge, so it goes to the roles that register and identify clients:
# front desk, records officers and clinical staff (catalogue `default_roles`).


from django.db import migrations

from apps.tenancy.context import platform_admin_context

CODENAME = "records.identity.merge"


def grant(apps, schema_editor):
    from apps.accounts.catalogue import PERMISSIONS

    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    _, module, label, description, scope, default_roles = next(
        p for p in PERMISSIONS if p[0] == CODENAME
    )
    with platform_admin_context():
        perm, _ = Permission.objects.update_or_create(
            codename=CODENAME,
            defaults={
                "label": label,
                "description": description,
                "module": module,
                "scope": scope,
            },
        )
        wanted = {name.lower() for name in default_roles}
        for role in Role.objects.exclude(scope="PLATFORM"):
            if role.name.strip().lower() in wanted:
                role.permissions.add(perm)


def remove(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    with platform_admin_context():
        Permission.objects.filter(codename=CODENAME).delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0016_permission_catalogue")]

    operations = [migrations.RunPython(grant, remove)]
