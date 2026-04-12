#!/usr/bin/env bash
# Dump the local dev Postgres to scripts/dev-snapshot.sql for safekeeping.
# Full schema + data, clean + if-exists so the snapshot is self-contained.
set -euo pipefail

DB_USER="${DB_USER:-filmlog}"
DB_NAME="${DB_NAME:-filmlog}"
DB_HOST="${DB_HOST:-localhost}"
OUT="$(cd "$(dirname "$0")" && pwd)/dev-snapshot.sql"

pg_dump \
  --host="$DB_HOST" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --clean --if-exists \
  --no-owner --no-privileges \
  > "$OUT"

echo "Wrote $OUT ($(wc -l < "$OUT") lines, $(du -h "$OUT" | cut -f1))"
