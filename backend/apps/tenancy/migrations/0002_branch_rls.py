from django.db import migrations

# Defense-in-depth per docs/04-MULTI-TENANCY.md §4.2: even if the ORM-level
# TenantScopedManager has a bug or is bypassed, Postgres itself refuses to
# return/write rows outside the bound organization. FORCE (not just ENABLE)
# is required because the app connects as the table owner, and table owners
# bypass RLS by default unless forced.
ENABLE_RLS_SQL = """
ALTER TABLE tenancy_branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy_branch FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_branch ON tenancy_branch
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
DROP POLICY IF EXISTS tenant_isolation_branch ON tenancy_branch;
ALTER TABLE tenancy_branch NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy_branch DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("tenancy", "0001_initial"),
    ]

    operations = [
        migrations.RunSQL(ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
