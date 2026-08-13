from django.db import migrations

from apps.tenancy.context import platform_admin_context

# docs/09-SECURITY-COMPLIANCE.md §9.3: "Standard roles ship pre-configured."
# These are platform-level templates (organization=None) — Org Admin assigns
# staff into them and may customize permission subsets within their org, but
# can't grant permissions the template doesn't already allow (§9.3).
#
# Only Phase 1's own areas (tenancy/RBAC/audit) have real permissions to
# attach yet; the clinical/admin roles are seeded now (so Org Admin has a
# roster to assign staff into per docs/07-CLINICAL-MODULES-SPEC.md) but gain
# their actual permission sets as each module's phase lands.
PLATFORM_PERMISSIONS = [
    ("platform.organizations.manage", "Create/edit/suspend Organizations"),
    ("platform.branches.manage", "View/manage Branches across all Organizations"),
    ("platform.subscriptions.manage", "Manage subscription plans and billing"),
    ("platform.roles.manage", "Manage platform-level role templates"),
    ("platform.audit.view", "View the cross-tenant audit log"),
    ("org.branches.manage", "Create/edit Branches within own Organization"),
    ("org.staff.manage", "Invite/manage staff within own Organization"),
    ("org.roles.manage", "Assign/customize roles within own Organization"),
    ("org.settings.manage", "Edit own Organization/Branch settings"),
    ("org.audit.view", "View the org-scoped audit log"),
]

ROLES_WITH_PERMISSIONS = {
    "Super Admin": [codename for codename, _ in PLATFORM_PERMISSIONS if codename.startswith("platform.")],
    "Auditor": ["platform.audit.view", "org.audit.view"],
    "Org Admin": [codename for codename, _ in PLATFORM_PERMISSIONS if codename.startswith("org.")],
}

# Rostered now with no permissions yet — see module comment above.
ROLES_WITHOUT_PERMISSIONS_YET = [
    "Doctor",
    "Nurse",
    "Clinical Psychologist/Therapist",
    "Lab Technician",
    "Radiologist",
    "Pharmacist",
    "Cashier/Billing Clerk",
    "Records Officer",
    "Supervisor",
]

ALL_TEMPLATE_ROLE_NAMES = list(ROLES_WITH_PERMISSIONS) + ROLES_WITHOUT_PERMISSIONS_YET


def seed_roles(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    permissions_by_codename = {
        codename: Permission.objects.get_or_create(codename=codename, defaults={"description": description})[0]
        for codename, description in PLATFORM_PERMISSIONS
    }

    with platform_admin_context():
        for name in ALL_TEMPLATE_ROLE_NAMES:
            role, _ = Role.objects.get_or_create(name=name, organization=None)
            codenames = ROLES_WITH_PERMISSIONS.get(name, [])
            if codenames:
                role.permissions.set([permissions_by_codename[c] for c in codenames])


def unseed_roles(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    Permission = apps.get_model("accounts", "Permission")
    with platform_admin_context():
        Role.objects.filter(organization__isnull=True, name__in=ALL_TEMPLATE_ROLE_NAMES).delete()
    Permission.objects.filter(codename__in=[c for c, _ in PLATFORM_PERMISSIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_rls"),
    ]

    operations = [
        migrations.RunPython(seed_roles, reverse_code=unseed_roles),
    ]
