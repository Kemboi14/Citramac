from django.db import migrations

from apps.tenancy.context import platform_admin_context

# Fine-grained module permissions matching the two Roles & Permissions
# screens (citramac_SUPER-ADMIN.html / citramac_ORG-admin.html perm-table
# columns: View/Create/Edit/Delete or Suspend). Coarser "manage"-level
# codenames from migration 0003 stay as-is (still used by onboard_tenant.py
# docs/how-to text) — these are additive, not a replacement.
PLATFORM_MODULE_PERMISSIONS = {
    "organizations": ["view", "create", "edit", "suspend"],
    "branches": ["view", "create", "edit", "suspend"],
    "subscriptions": ["view", "create", "edit", "suspend"],
    "roles": ["view", "create", "edit", "suspend"],
    "audit": ["view"],
}
ORG_MODULE_PERMISSIONS = {
    "wards": ["view", "create", "edit", "delete"],
    "registration": ["view", "create", "edit", "delete"],
    "ccp": ["view", "create", "edit", "delete"],
    "staff": ["view", "create", "edit", "delete"],
    "branch_settings": ["view", "edit"],
    "billing": ["view", "create", "edit", "delete"],
}

# name -> (scope, description, [permission codenames])
PLATFORM_ROLES = {
    "Support Agent": (
        "PLATFORM",
        "Can view organizations and branches to assist with tickets, but cannot edit billing or platform-level roles.",
        ["platform.organizations.view", "platform.branches.view", "platform.audit.view"],
    ),
    "Billing Admin": (
        "PLATFORM",
        "Manages subscriptions, plans, and invoices; read-only on organizations and branches.",
        [
            "platform.organizations.view",
            "platform.branches.view",
            "platform.subscriptions.view",
            "platform.subscriptions.create",
            "platform.subscriptions.edit",
        ],
    ),
    "MFL Verifier": (
        "PLATFORM",
        "Reviews and approves pending organizations against the DHA Master Facility List; cannot touch billing or roles.",
        ["platform.organizations.view", "platform.organizations.edit"],
    ),
}
ORG_ROLES = {
    "Psychiatrist": (
        "ORG_TEMPLATE",
        "Full clinical access: can admit/discharge patients, prescribe, write session notes, and review supervision requests from their team.",
        [
            "org.wards.view",
            "org.wards.edit",
            "org.registration.view",
            "org.registration.create",
            "org.registration.edit",
            "org.ccp.view",
            "org.ccp.create",
            "org.ccp.edit",
            "org.staff.view",
        ],
    ),
    "Ward Nurse": (
        "ORG_TEMPLATE",
        "Manages bed status and vitals within an assigned ward; can view but not edit patient registration or billing.",
        ["org.wards.view", "org.wards.edit", "org.registration.view"],
    ),
    "Therapist": (
        "ORG_TEMPLATE",
        "Runs Individual/Family/Group Psychotherapy sessions and can raise supervision requests; no access to billing or branch settings.",
        [
            "org.registration.view",
            "org.ccp.view",
            "org.ccp.create",
            "org.ccp.edit",
        ],
    ),
    "Clinical Supervisor": (
        "ORG_TEMPLATE",
        "Reviews and closes supervision requests, can view all staff caseloads; read-only on billing.",
        ["org.ccp.view", "org.ccp.edit", "org.staff.view", "org.billing.view"],
    ),
    "Front Desk": (
        "ORG_TEMPLATE",
        "Handles outpatient/CCP registration and appointment check-in; no access to clinical notes or staff management.",
        ["org.registration.view", "org.registration.create", "org.registration.edit"],
    ),
    "Billing Clerk": (
        "ORG_TEMPLATE",
        "Manages invoices, SHA claims and M-Pesa reconciliation; read-only on ward and staff data.",
        [
            "org.billing.view",
            "org.billing.create",
            "org.billing.edit",
            "org.wards.view",
            "org.staff.view",
        ],
    ),
}

SCOPE_BACKFILL = {
    "Super Admin": "PLATFORM",
    "Org Admin": "PLATFORM",
    "Auditor": "PLATFORM",
}


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")

    codename_to_permission = {}
    for module, actions in {**PLATFORM_MODULE_PERMISSIONS, **{f"org.{k}": v for k, v in ORG_MODULE_PERMISSIONS.items()}}.items():
        prefix = module if module.startswith("org.") else f"platform.{module}"
        for action in actions:
            codename = f"{prefix}.{action}"
            perm, _ = Permission.objects.get_or_create(
                codename=codename, defaults={"description": f"{action.title()} — {prefix}"}
            )
            codename_to_permission[codename] = perm

    with platform_admin_context():
        for name, scope in SCOPE_BACKFILL.items():
            Role.objects.filter(name=name, organization__isnull=True).update(scope=scope)

        for name, (scope, description, codenames) in {**PLATFORM_ROLES, **ORG_ROLES}.items():
            role, _ = Role.objects.get_or_create(
                name=name,
                organization=None,
                defaults={"scope": scope, "description": description},
            )
            role.scope = scope
            role.description = description
            role.save(update_fields=["scope", "description"])
            role.permissions.set([codename_to_permission[c] for c in codenames])


def unseed(apps, schema_editor):
    Role = apps.get_model("accounts", "Role")
    with platform_admin_context():
        Role.objects.filter(
            organization__isnull=True, name__in=list(PLATFORM_ROLES) + list(ORG_ROLES)
        ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0006_role_description_role_scope"),
    ]

    operations = [
        migrations.RunPython(seed, reverse_code=unseed),
    ]
