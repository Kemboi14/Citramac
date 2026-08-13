from django.db import migrations

# See apps/tenancy/migrations/0002_branch_rls.py for the general pattern and
# rationale (docs/04-MULTI-TENANCY.md §4.2). Three tables here:
#
# - accounts_user: organization is nullable (platform Super Admin staff have
#   no organization — docs/04-MULTI-TENANCY.md §4.1). A NULL organization_id
#   row is only visible via the platform-admin clause, never via org-match,
#   which is correct: ordinary tenant users must never see Super Admin rows.
#
# - accounts_role: organization is nullable too, but for a different reason —
#   NULL there means a platform-level *template* role every org is meant to
#   see (so Org Admin can assign/customize from it), not a platform-only row.
#   So its policy has an extra "organization_id IS NULL" clause that
#   accounts_user's does not.
#
# - accounts_activationinvite: same pattern as Branch — organization is
#   always set, straightforward org-match-or-platform-admin policy. The
#   pre-auth "identify" lookup (before the invitee's org is known) goes
#   through apps.tenancy.context.platform_admin_context(), the same sanctioned
#   bypass used for the User lookups in the auth flow.
ENABLE_RLS_SQL = """
ALTER TABLE accounts_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_user FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_user ON accounts_user
    USING (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        OR current_setting('app.is_platform_admin', true) = 'true'
    )
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        OR current_setting('app.is_platform_admin', true) = 'true'
    );

ALTER TABLE accounts_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_role FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_role ON accounts_role
    USING (
        organization_id IS NULL
        OR organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        OR current_setting('app.is_platform_admin', true) = 'true'
    )
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        OR current_setting('app.is_platform_admin', true) = 'true'
    );

ALTER TABLE accounts_activationinvite ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts_activationinvite FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_activationinvite ON accounts_activationinvite
    USING (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        OR current_setting('app.is_platform_admin', true) = 'true'
    )
    WITH CHECK (
        organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
        OR current_setting('app.is_platform_admin', true) = 'true'
    );
"""

DISABLE_RLS_SQL = """
DROP POLICY IF EXISTS tenant_isolation_activationinvite ON accounts_activationinvite;
ALTER TABLE accounts_activationinvite NO FORCE ROW LEVEL SECURITY;
ALTER TABLE accounts_activationinvite DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_role ON accounts_role;
ALTER TABLE accounts_role NO FORCE ROW LEVEL SECURITY;
ALTER TABLE accounts_role DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_user ON accounts_user;
ALTER TABLE accounts_user NO FORCE ROW LEVEL SECURITY;
ALTER TABLE accounts_user DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
