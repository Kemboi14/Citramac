"""
Practitioner profiles (owner decisions 2026-11-05, apps.accounts.practitioner_profile):

1. PractitionerCredentialReview gets tenant isolation (RLS) and is append-only
   at the database level — the same trigger as tenancy 0017 — so the history of
   who verified which licence can't be rewritten. TRUNCATE stays allowed
   (TransactionTestCase flushes with it).
2. New permission staff.credentials.verify, given to the Clinical Supervisor
   definition and to every organisation's copy of it.
3. Two new standard roles, Clinical Officer and Counsellor. The definition
   starts with Doctor's / Clinical Psychologist's permissions, and every
   organisation gets its own copy (as provision_organization_roles does for a
   new organisation). Nobody is given either role; nobody's access changes.
"""

from django.db import migrations

from apps.tenancy.rls import enable_rls

RLS_FORWARD, RLS_REVERSE = enable_rls("accounts_practitionercredentialreview")

APPEND_ONLY_FORWARD = """
CREATE OR REPLACE FUNCTION accounts_practitionercredentialreview_reject_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'accounts_practitionercredentialreview is append-only: % is not permitted',
        TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER practitionercredentialreview_append_only
    BEFORE UPDATE OR DELETE ON accounts_practitionercredentialreview
    FOR EACH ROW EXECUTE FUNCTION accounts_practitionercredentialreview_reject_mutation();
"""

APPEND_ONLY_REVERSE = """
DROP TRIGGER IF EXISTS practitionercredentialreview_append_only
    ON accounts_practitionercredentialreview;
DROP FUNCTION IF EXISTS accounts_practitionercredentialreview_reject_mutation();
"""

CODENAME = "staff.credentials.verify"
# new role key → the existing role whose permissions it starts with
NEW_ROLES = {"clinical_officer": "doctor", "counsellor": "clinical_psychologist"}


def _bypass_rls(schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.is_platform_admin', 'true', true)")


def forwards(apps, schema_editor):
    from apps.accounts.catalogue import ORGANISATION_ROLES, PERMISSIONS

    _bypass_rls(schema_editor)
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    Organization = apps.get_model("tenancy", "Organization")

    _, module, label, description, scope, _ = next(p for p in PERMISSIONS if p[0] == CODENAME)
    perm, _ = Permission.objects.update_or_create(
        codename=CODENAME,
        defaults={"label": label, "description": description, "module": module, "scope": scope},
    )
    for role in Role.objects.filter(system_key="clinical_supervisor"):
        role.permissions.add(perm)

    meta = {key: (name, desc) for key, name, desc, _locked, _legacy in ORGANISATION_ROLES}
    for key, source_key in NEW_ROLES.items():
        name, desc = meta[key]
        source = Role.objects.filter(
            organization__isnull=True, scope="ORG_TEMPLATE", system_key=source_key
        ).first()
        definition = Role.objects.filter(organization__isnull=True, system_key=key).first()
        if definition is None:
            definition = Role.objects.create(
                organization=None,
                name=name,
                scope="ORG_TEMPLATE",
                description=desc,
                system_key=key,
            )
        # A definition is only a starting point (nobody holds it), so it always
        # takes the source role's permissions — on a fresh database 0020 has
        # already made it from the catalogue with fewer.
        if source is not None:
            definition.permissions.set(source.permissions.all())
        for organization in Organization.objects.all():
            if Role.objects.filter(organization=organization, system_key=key).exists():
                continue
            # A role the organisation already made with this name becomes its
            # copy, keeping its permissions (as apps.accounts.roles._copy does).
            own = Role.objects.filter(
                organization=organization, name__iexact=name, system_key=""
            ).first()
            if own is not None:
                own.system_key = key
                own.save(update_fields=["system_key"])
                continue
            copy = Role.objects.create(
                organization=organization,
                name=name,
                scope="ORG_TEMPLATE",
                description=desc,
                system_key=key,
            )
            copy.permissions.set(definition.permissions.all())


def backwards(apps, schema_editor):
    _bypass_rls(schema_editor)
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    RoleAssignment = apps.get_model("accounts", "RoleAssignment")
    User = apps.get_model("accounts", "User")
    for key in NEW_ROLES:
        roles = Role.objects.filter(system_key=key)
        held = RoleAssignment.objects.filter(role__in=roles).exists() or (
            User.roles.through.objects.filter(role__in=roles).exists()
        )
        if held:
            # Someone holds it: keep the role (now unkeyed) rather than take access away.
            roles.update(system_key="")
        else:
            roles.delete()
    Permission.objects.filter(codename=CODENAME).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0021_practitioner_profile"),
        ("tenancy", "0022_organization_nacada_report_email"),
    ]

    operations = [
        migrations.RunSQL(RLS_FORWARD, reverse_sql=RLS_REVERSE),
        migrations.RunSQL(APPEND_ONLY_FORWARD, reverse_sql=APPEND_ONLY_REVERSE),
        migrations.RunPython(forwards, backwards),
    ]
