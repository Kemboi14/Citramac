# The permission catalogue becomes the real access control (apps/accounts/catalogue.py).
#
# - Permission gains label / module / scope, and every catalogue entry is
#   written with its plain-language label and description.
# - Each organisation permission is granted to exactly the roles that passed
#   the role-name check it replaces (catalogue `default_roles`, matched by name
#   on platform templates and organisations' own roles alike), so nobody gains
#   or loses access on the day the code switches over.
# - platform.<area>.suspend becomes platform.<area>.deactivate (grants kept).
# - Permissions that never controlled anything are removed: org.*.delete and
#   the other org.* screen ticks, the former CCP-era codenames, and the
#   platform.*.manage duplicates. Platform-team permissions are taken off every
#   organisation role, and "CCP" left in role descriptions becomes "MHP".

from django.db import migrations, models

from apps.tenancy.context import platform_admin_context


def apply_catalogue(apps, schema_editor):
    from apps.accounts.catalogue import CODENAMES, PERMISSIONS, SCOPE_PLATFORM

    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    with platform_admin_context():
        for old in Permission.objects.filter(codename__endswith=".suspend"):
            new = old.codename[: -len("suspend")] + "deactivate"
            if not Permission.objects.filter(codename=new).exists():
                old.codename = new
                old.save(update_fields=["codename"])

        Permission.objects.exclude(codename__in=CODENAMES).delete()

        roles = list(Role.objects.all())
        for codename, module, label, description, scope, default_roles in PERMISSIONS:
            perm, _ = Permission.objects.update_or_create(
                codename=codename,
                defaults={
                    "label": label,
                    "description": description,
                    "module": module,
                    "scope": scope,
                },
            )
            wanted = {name.lower() for name in default_roles}
            for role in roles:
                if role.name.strip().lower() in wanted:
                    role.permissions.add(perm)

        platform = Permission.objects.filter(scope=SCOPE_PLATFORM)
        for role in Role.objects.exclude(scope="PLATFORM"):
            role.permissions.remove(*platform)

        # The ccp_program -> mhp_program rename left "CCP" in role descriptions.
        for role in Role.objects.filter(description__icontains="ccp"):
            role.description = role.description.replace("CCP", "MHP").replace("ccp", "mhp")
            role.save(update_fields=["description"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0015_role_assignments_rls_backfill")]

    operations = [
        migrations.AddField(
            model_name="permission",
            name="label",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="permission",
            name="module",
            field=models.CharField(blank=True, max_length=40),
        ),
        migrations.AddField(
            model_name="permission",
            name="scope",
            field=models.CharField(
                choices=[("ORG", "Organisation"), ("PLATFORM", "Platform team")],
                default="ORG",
                max_length=10,
            ),
        ),
        migrations.AlterField(
            model_name="permission",
            name="description",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AlterModelOptions(name="permission", options={"ordering": ["module", "codename"]}),
        migrations.RunPython(apply_catalogue, migrations.RunPython.noop),
    ]
