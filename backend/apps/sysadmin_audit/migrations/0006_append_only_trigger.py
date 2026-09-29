"""
Database-level append-only enforcement for the audit trail —
docs/09-SECURITY-COMPLIANCE.md §9.4: "Audit entries are append-only:
enforce via a DB trigger ... so even a compromised application credential
cannot rewrite history." Any UPDATE or DELETE on the table raises, whatever
issued it (ORM, raw SQL, a data migration). TRUNCATE is deliberately not
blocked: Django's TransactionTestCase flushes tables with it. See the
AuditLogEntry docstring for what this does and doesn't protect against.
"""

from django.db import migrations

FORWARD_SQL = """
CREATE OR REPLACE FUNCTION sysadmin_audit_reject_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'sysadmin_audit_auditlogentry is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditlogentry_append_only
    BEFORE UPDATE OR DELETE ON sysadmin_audit_auditlogentry
    FOR EACH ROW EXECUTE FUNCTION sysadmin_audit_reject_mutation();
"""

REVERSE_SQL = """
DROP TRIGGER IF EXISTS auditlogentry_append_only ON sysadmin_audit_auditlogentry;
DROP FUNCTION IF EXISTS sysadmin_audit_reject_mutation();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("sysadmin_audit", "0005_alter_auditlogentry_action"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
