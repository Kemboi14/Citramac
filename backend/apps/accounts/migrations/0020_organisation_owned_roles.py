"""
Platform roles stay on the platform; organisation roles move into the
organisations (apps.accounts.catalogue "Roles", apps.accounts.roles).

1. Every built-in role gets its key. Built-in roles were recognised by name
   until now, so a custom role called "Org Admin" was an administrator and
   one called "Org Admin Nairobi" was not.
2. Auditor becomes an organisation role (it was filed under the platform team
   although only an organisation's own staff ever held it). The platform team
   gets its own Platform Auditor.
3. Each organisation gets its own copy of each standard role, with the
   definition's current permissions, and everyone holding a shared definition
   moves to their organisation's copy. A role the organisation already made
   with the same name becomes its copy, unless people hold both and the two
   differ in permissions; then the copy is named "<name> (standard)" so nobody's
   access changes. Legacy duplicates (Therapist, Supervisor, Billing Clerk) are
   copied only into organisations where someone holds them.
4. Platform accounts keep only platform roles and organisation accounts only
   organisation roles. A role on the wrong side granted nothing (a platform
   account has no organisation records to open; platform permissions are not
   checked on organisation staff), so removing it changes nobody's access.
5. New permission clinical.risk_alerts.receive replaces the name check that
   sent MSE risk alerts to roles called "Supervisor": it goes to exactly those
   roles, and to the Clinical Supervisor definition.

Nobody gains or loses a permission. Reversible in the sense that matters:
assignments move between role rows with identical permissions; the reverse
step sends holders back to the shared definitions.
"""

from django.db import migrations


def _bypass_rls(schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def _move_holders(Role, RoleAssignment, through, organization_id, user_ids, source, target):
    for a in RoleAssignment.objects.filter(organization_id=organization_id, role=source):
        clash = RoleAssignment.objects.filter(user_id=a.user_id, role=target, branch_id=a.branch_id)
        if clash.exists():
            a.delete()
        else:
            a.role = target
            a.save(update_fields=["role"])
    for row in through.objects.filter(user_id__in=user_ids, role=source):
        if through.objects.filter(user_id=row.user_id, role=target).exists():
            row.delete()
        else:
            row.role = target
            row.save(update_fields=["role"])


def forwards(apps, schema_editor):
    from apps.accounts.catalogue import (
        LOCKED_ROLE_KEYS,
        ORGANISATION_ROLES,
        PERMISSIONS,
        PLATFORM_ROLES,
        SCOPE_PLATFORM,
    )

    _bypass_rls(schema_editor)
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    User = apps.get_model("accounts", "User")
    RoleAssignment = apps.get_model("accounts", "RoleAssignment")
    Organization = apps.get_model("tenancy", "Organization")
    through = User.roles.through

    for codename, module, label, description, scope, _ in PERMISSIONS:
        perm, created = Permission.objects.update_or_create(
            codename=codename,
            defaults={"label": label, "description": description, "module": module, "scope": scope},
        )
        if created and codename == "clinical.risk_alerts.receive":
            for role in Role.objects.filter(name__iexact="supervisor"):
                role.permissions.add(perm)
    platform_perms = list(Permission.objects.filter(scope=SCOPE_PLATFORM))
    org_perms = list(Permission.objects.exclude(scope=SCOPE_PLATFORM))

    for key, name, description, _locked, _legacy in PLATFORM_ROLES:
        role = Role.objects.filter(organization__isnull=True, name__iexact=name).first()
        if role is None:
            role = Role.objects.create(name=name, organization=None, scope="PLATFORM")
            if key == "platform_auditor":
                role.permissions.set(Permission.objects.filter(codename="platform.audit.view"))
        role.scope = "PLATFORM"
        role.system_key = key
        role.description = description
        role.save(update_fields=["scope", "system_key", "description"])
        role.permissions.remove(*org_perms)

    for key, name, description, _locked, _legacy in ORGANISATION_ROLES:
        role = Role.objects.filter(organization__isnull=True, name__iexact=name).first()
        if role is None:
            # A missing definition starts with the catalogue's defaults for
            # this role (live: Psychiatrist had been moved into one org).
            role = Role.objects.create(name=name, organization=None, scope="ORG_TEMPLATE")
            role.permissions.set(
                Permission.objects.filter(
                    codename__in=[
                        p[0] for p in PERMISSIONS if name.lower() in {r.lower() for r in p[5]}
                    ]
                )
            )
        role.scope = "ORG_TEMPLATE"
        role.system_key = key
        role.description = description
        role.save(update_fields=["scope", "system_key", "description"])
        role.permissions.remove(*platform_perms)
        if key == "clinical_supervisor":
            role.permissions.add(
                *Permission.objects.filter(codename="clinical.risk_alerts.receive")
            )

    # Any other organization=None row is an organisation role with no key
    # (none exist today); it stays as it is.
    for user in User.objects.filter(organization__isnull=True):
        through.objects.filter(user_id=user.id).exclude(role__scope="PLATFORM").delete()
    org_user_ids = User.objects.filter(organization__isnull=False).values_list("id", flat=True)
    through.objects.filter(user_id__in=org_user_ids, role__scope="PLATFORM").delete()
    RoleAssignment.objects.filter(role__scope="PLATFORM").delete()

    legacy = {key for key, _, _, _, is_legacy in ORGANISATION_ROLES if is_legacy}
    definitions = list(
        Role.objects.filter(organization__isnull=True, scope="ORG_TEMPLATE").exclude(system_key="")
    )
    for organization in Organization.objects.all():
        user_ids = list(User.objects.filter(organization=organization).values_list("id", flat=True))
        held = set(
            RoleAssignment.objects.filter(
                organization_id=organization.id, role__organization__isnull=True
            ).values_list("role_id", flat=True)
        ) | set(
            through.objects.filter(
                user_id__in=user_ids, role__organization__isnull=True
            ).values_list("role_id", flat=True)
        )
        for definition in definitions:
            key = definition.system_key
            if key in legacy and definition.id not in held:
                continue
            copy = Role.objects.filter(organization=organization, system_key=key).first()
            if copy is None:
                same = Role.objects.filter(
                    organization=organization, name__iexact=definition.name, system_key=""
                ).first()
                same_perms = same is not None and set(
                    same.permissions.values_list("id", flat=True)
                ) == set(definition.permissions.values_list("id", flat=True))
                if same is not None and (
                    key in LOCKED_ROLE_KEYS or definition.id not in held or same_perms
                ):
                    same.system_key = key
                    if key in LOCKED_ROLE_KEYS:
                        same.name = definition.name
                        same.description = definition.description
                    same.save(update_fields=["system_key", "name", "description"])
                    copy = same
                else:
                    copy = Role.objects.create(
                        organization=organization,
                        name=definition.name if same is None else f"{definition.name} (standard)",
                        scope="ORG_TEMPLATE",
                        description=definition.description,
                        system_key=key,
                    )
                    copy.permissions.set(definition.permissions.all())
            _move_holders(
                Role, RoleAssignment, through, organization.id, user_ids, definition, copy
            )


def backwards(apps, schema_editor):
    """Send holders back to the shared definitions; the organisation copies stay."""
    _bypass_rls(schema_editor)
    Role = apps.get_model("accounts", "Role")
    User = apps.get_model("accounts", "User")
    RoleAssignment = apps.get_model("accounts", "RoleAssignment")
    through = User.roles.through
    definitions = {
        r.system_key: r
        for r in Role.objects.filter(organization__isnull=True, scope="ORG_TEMPLATE").exclude(
            system_key=""
        )
    }
    for copy in Role.objects.filter(organization__isnull=False).exclude(system_key=""):
        definition = definitions.get(copy.system_key)
        if definition is None:
            continue
        user_ids = list(
            User.objects.filter(organization_id=copy.organization_id).values_list("id", flat=True)
        )
        _move_holders(
            Role, RoleAssignment, through, copy.organization_id, user_ids, copy, definition
        )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0019_role_system_key"),
        ("tenancy", "0022_organization_nacada_report_email"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
