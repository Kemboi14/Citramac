#!/usr/bin/env bash
# Restore runbook — docs/12-DEVOPS-DEPLOYMENT.md §12.6, docs/09-SECURITY-COMPLIANCE.md §9.6.
#
# Restores a backup_db.sh dump into a NEW, isolated database — never onto
# an existing one, so a drill can never clobber real data. Drop the scratch
# database yourself once the drill's integrity check (verify_restore.py)
# has run — "never leave a lingering copy of PHI around" (§12.6 step 5).
#
# Usage: ./scripts/restore_db.sh <dump_file> <target_db_name> [admin_database_url]
#   admin_database_url defaults to $DATABASE_URL with the db name swapped
#   for 'postgres', used only to issue CREATE DATABASE.
set -euo pipefail

DUMP_FILE="${1:?Usage: restore_db.sh <dump_file> <target_db_name> [admin_database_url]}"
TARGET_DB="${2:?Usage: restore_db.sh <dump_file> <target_db_name> [admin_database_url]}"
: "${DATABASE_URL:?DATABASE_URL must be set to derive connection host/user/password}"

ADMIN_URL="${3:-$(echo "$DATABASE_URL" | sed -E 's#/[^/]+$#/postgres#')}"
TARGET_URL="$(echo "$DATABASE_URL" | sed -E "s#/[^/]+\$#/${TARGET_DB}#")"

echo "Creating scratch database '$TARGET_DB'..."
psql --dbname="$ADMIN_URL" -c "CREATE DATABASE \"$TARGET_DB\"" 2>&1 || {
    echo "CREATE DATABASE failed — does '$TARGET_DB' already exist? Refusing to restore onto an existing DB." >&2
    exit 1
}

echo "Restoring $DUMP_FILE -> $TARGET_DB"
START=$(date +%s)
pg_restore --no-owner --no-privileges --dbname="$TARGET_URL" --jobs=4 "$DUMP_FILE"
END=$(date +%s)

echo "Restore complete in $((END - START))s. Connection string for the integrity check:"
echo "$TARGET_URL"
