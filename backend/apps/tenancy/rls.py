"""
Generates the standard tenant-isolation RLS policy for a table with an
`organization_id` column — docs/04-MULTI-TENANCY.md §4.2. Used from
migrations across every app via `migrations.RunSQL(*enable_rls(table))`.
See apps/tenancy/migrations/0002_branch_rls.py for the hand-written version
this factors out (still accurate as documentation of what this generates).
"""


def enable_rls(table, extra_read_clause=None):
    """
    Returns (forward_sql, reverse_sql) for migrations.RunSQL.

    extra_read_clause: an additional SQL boolean expression OR'd into the
    read-side (USING) policy only — e.g. "organization_id IS NULL" for a
    table where NULL means "visible to every org" (see accounts_role's
    hand-written policy for why this is a USING-only exception, never
    WITH CHECK).
    """
    read_clause = (
        "organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid "
        "OR current_setting('app.is_platform_admin', true) = 'true'"
    )
    write_clause = read_clause
    if extra_read_clause:
        read_clause = f"{extra_read_clause} OR {read_clause}"

    policy_name = f"tenant_isolation_{table}"
    forward = f"""
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;

CREATE POLICY {policy_name} ON {table}
    USING ({read_clause})
    WITH CHECK ({write_clause});
"""
    reverse = f"""
DROP POLICY IF EXISTS {policy_name} ON {table};
ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;
"""
    return forward, reverse


def enable_rls_for_tables(*tables):
    """Combines enable_rls() for several tables into one (forward_sql, reverse_sql) pair."""
    forwards, reverses = [], []
    for table in tables:
        f, r = enable_rls(table)
        forwards.append(f)
        reverses.append(r)
    return "\n".join(forwards), "\n".join(reversed(reverses))
