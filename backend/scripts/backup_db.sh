#!/usr/bin/env bash
# Backup runbook — docs/12-DEVOPS-DEPLOYMENT.md §12.6, docs/09-SECURITY-COMPLIANCE.md §9.6.
#
# Custom-format pg_dump (not plain SQL) so restore_db.sh can use pg_restore's
# parallel jobs + selective-table restore. Reads connection details from
# DATABASE_URL (same variable Django itself uses via django-environ) so
# this script and the app are never pointed at different databases by
# accident.
#
# Usage: ./scripts/backup_db.sh [output_dir]
set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
mkdir -p "$OUTPUT_DIR"

: "${DATABASE_URL:?DATABASE_URL must be set (e.g. postgres://user:pass@host:5432/dbname)}" # pragma: allowlist secret

TIMESTAMP="$(date +%Y%m%dT%H%M%S)"
OUTPUT_FILE="${OUTPUT_DIR}/citramac-${TIMESTAMP}.dump"

echo "Backing up $DATABASE_URL -> $OUTPUT_FILE"
START=$(date +%s)
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$OUTPUT_FILE"
END=$(date +%s)

echo "Backup complete in $((END - START))s: $OUTPUT_FILE ($(du -h "$OUTPUT_FILE" | cut -f1))"
