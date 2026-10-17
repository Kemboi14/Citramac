"""
Tenant isolation (RLS) for BranchIdentifierChange, plus database-level
append-only enforcement — the same trigger approach as
sysadmin_audit/0006_append_only_trigger.py, so a branch's registration and
licence history can't be rewritten by any path (ORM, raw SQL, admin).
TRUNCATE is deliberately not blocked: Django's TransactionTestCase flushes
tables with it.
"""

from django.db import migrations

from apps.tenancy.rls import enable_rls

RLS_FORWARD, RLS_REVERSE = enable_rls("tenancy_branchidentifierchange")

APPEND_ONLY_FORWARD = """
CREATE OR REPLACE FUNCTION tenancy_branchidentifierchange_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'tenancy_branchidentifierchange is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER branchidentifierchange_append_only
    BEFORE UPDATE OR DELETE ON tenancy_branchidentifierchange
    FOR EACH ROW EXECUTE FUNCTION tenancy_branchidentifierchange_reject_mutation();
"""

APPEND_ONLY_REVERSE = """
DROP TRIGGER IF EXISTS branchidentifierchange_append_only ON tenancy_branchidentifierchange;
DROP FUNCTION IF EXISTS tenancy_branchidentifierchange_reject_mutation();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("tenancy", "0016_branch_registration_identifiers"),
    ]

    operations = [
        migrations.RunSQL(RLS_FORWARD, reverse_sql=RLS_REVERSE),
        migrations.RunSQL(APPEND_ONLY_FORWARD, reverse_sql=APPEND_ONLY_REVERSE),
    ]
