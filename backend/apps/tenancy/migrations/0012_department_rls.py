from django.db import migrations

# Same defense-in-depth as 0002_branch_rls.py, for the new Department table.
ENABLE_RLS_SQL = """
ALTER TABLE tenancy_department ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy_department FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_department ON tenancy_department
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
DROP POLICY IF EXISTS tenant_isolation_department ON tenancy_department;
ALTER TABLE tenancy_department NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenancy_department DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("tenancy", "0011_department"),
    ]

    operations = [
        migrations.RunSQL(ENABLE_RLS_SQL, reverse_sql=DISABLE_RLS_SQL),
    ]
