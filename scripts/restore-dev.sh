#!/usr/bin/env bash
# Restore the dev snapshot into the local Postgres. Destructive — drops existing tables first.
set -euo pipefail

DB_USER="${DB_USER:-filmlog}"
DB_NAME="${DB_NAME:-filmlog}"
DB_HOST="${DB_HOST:-localhost}"
IN="$(cd "$(dirname "$0")" && pwd)/dev-snapshot.sql"

if [ ! -f "$IN" ]; then
  echo "Snapshot not found: $IN" >&2
  exit 1
fi

echo "Restoring $IN into $DB_USER@$DB_HOST/$DB_NAME"
echo "This will drop and recreate all tables. Ctrl-C in 3 seconds to abort..."
sleep 3

psql --host="$DB_HOST" --username="$DB_USER" --dbname="$DB_NAME" --quiet < "$IN"
echo "Restore complete."
