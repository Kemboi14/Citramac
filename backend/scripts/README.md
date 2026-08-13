# Backup & restore runbook

Implements docs/12-DEVOPS-DEPLOYMENT.md §12.6 and docs/09-SECURITY-COMPLIANCE.md
§9.6 — "a backup that has never been restored in a drill is not a backup."

## Prerequisite: a dedicated backup role

The application's runtime role (`citramac`) deliberately does **not** bypass
Row-Level Security — every RLS-protected table is created with `FORCE ROW
LEVEL SECURITY` (see `apps/tenancy/rls.py`), so even a bug or a stray raw
SQL query from the app itself can't leak cross-tenant rows. That's correct
for the running application, but it means `pg_dump`/`pg_restore` running as
that same role **cannot dump RLS-protected tables at all** — Postgres
refuses a plain `COPY tablename TO ...` for any role that isn't exempt from
RLS, regardless of what the policy's `USING` clause would otherwise allow.
(Discovered for real running this drill the first time — see "Drill log"
below.)

The fix is the standard Postgres pattern: a **separate role with
`BYPASSRLS`**, used only for backup/restore, never for application traffic:

```sql
CREATE ROLE citramac_backup LOGIN PASSWORD '<strong-password>'
  BYPASSRLS CREATEDB IN ROLE citramac;
```

- `BYPASSRLS` — lets `pg_dump`/`pg_restore` read/write every row regardless
  of tenant.
- `CREATEDB` — lets `restore_db.sh` create the scratch database for a drill
  without needing a full superuser.
- `IN ROLE citramac` — inherits `citramac`'s table-level grants, so it can
  actually `SELECT`/`COPY` the data once RLS is out of the way.

In production this role's password belongs in the secrets manager
(docs/09-SECURITY-COMPLIANCE.md §9.1), never in `.env`/source control, and
its use should be restricted to the backup job's own service account.

## Scripts

| Script | Purpose |
|---|---|
| `backup_db.sh [output_dir]` | `pg_dump` (custom format) of `$DATABASE_URL` into a timestamped file. |
| `restore_db.sh <dump_file> <target_db_name>` | Creates a **new** database and `pg_restore`s the dump into it. Refuses to restore onto an existing database. |
| `verify_restore.py` | Data-integrity smoke test — docs/12 §12.6 step 3: row counts (diffed against a captured baseline), a referential-integrity spot check, and a sample patient round-trip. |

All three read connection details from `$DATABASE_URL`. Point it at
`citramac_backup`'s credentials, not the application role's.

## Running a drill

```bash
export DATABASE_URL="postgres://citramac_backup:<password>@<host>:5432/citramac"

# 1. Capture a baseline from the live database.
python scripts/verify_restore.py --capture-baseline /tmp/baseline.json

# 2. Back it up.
./scripts/backup_db.sh /tmp/backups

# 3. Restore into an isolated scratch database.
./scripts/restore_db.sh /tmp/backups/citramac-<timestamp>.dump citramac_drill_scratch

# 4. Point DATABASE_URL at the scratch database and verify.
export DATABASE_URL="postgres://citramac_backup:<password>@<host>:5432/citramac_drill_scratch"
python scripts/verify_restore.py --baseline /tmp/baseline.json

# 5. Tear down — never leave a lingering copy of PHI around.
psql "postgres://citramac_backup:<password>@<host>:5432/postgres" \
  -c 'DROP DATABASE citramac_drill_scratch;'
rm -f /tmp/backups/*.dump /tmp/baseline.json
```

## Drill log

**2026-08-13, local dev Postgres (single-node, no managed-service RTO/RPO
SLA to compare against yet — this exercises the mechanism, not production
timing):**

- **First attempt failed** — `pg_dump` as the plain `citramac` role errored
  with `query would be affected by row-level security policy`. Root cause
  and fix: see "Prerequisite" above. This is exactly the kind of problem a
  drill is supposed to catch before it's discovered during a real
  incident.
- After creating `citramac_backup` (`BYPASSRLS`, `CREATEDB`, member of
  `citramac`):
  - Backup: **1s**, 39 encounters / 1 patient / 1 organization, 424 KiB
    dump file.
  - Restore into a fresh scratch database: **11s**.
  - Integrity check: row counts matched the pre-backup baseline exactly
    (`organizations: 1, patients: 1, encounters: 39,
    psychotherapy_sessions: 0`); referential-integrity spot check passed;
    sample patient round-trip (Jane Wanjiru) read back correctly.
  - Scratch database dropped immediately after.
- **RTO observed**: ~12s end-to-end (backup + restore) for this dataset
  size. Not representative of a production-scale restore — re-run this
  drill against a production-sized dataset before using the number for
  capacity planning, and quarterly thereafter per docs/12 §12.6.
- **RPO**: depends entirely on backup cadence, not exercised by this
  mechanism-only drill. Automated continuous WAL-based PITR (docs/09 §9.6)
  is a Phase 8 (managed Postgres) item, not implemented against this local
  dev instance.
