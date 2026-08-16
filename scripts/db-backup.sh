#!/usr/bin/env bash
# Nightly Tomu database backup: pg_dump → gzip → commit+push to the private
# tomu-backups repo. Safe to run anytime; used by launchd (laptop) and,
# post-deploy, cron (droplet).
#
# Env (all optional):
#   DATABASE_URL  postgres URL          (default: postgres://filmlog:filmlog@localhost:5432/filmlog)
#   BACKUP_REPO   path to backups clone (default: ~/dev/fhwrdh/tomu-backups)
#   RETAIN_DAYS   local retention       (default: 60; git history keeps everything anyway)
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://filmlog:filmlog@localhost:5432/filmlog}"
BACKUP_REPO="${BACKUP_REPO:-$HOME/dev/fhwrdh/tomu-backups}"
RETAIN_DAYS="${RETAIN_DAYS:-60}"
HOST_TAG="$(hostname -s)"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$BACKUP_REPO/nightly"
OUT="$OUT_DIR/filmlog-$STAMP-$HOST_TAG.sql.gz"

mkdir -p "$OUT_DIR"

# Dump. --no-owner/--no-privileges so restores work under any role name.
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"

# Sanity: a real dump of this DB is never tiny.
BYTES=$(wc -c < "$OUT" | tr -d ' ')
if [ "$BYTES" -lt 10000 ]; then
  echo "backup suspiciously small ($BYTES bytes) — refusing to prune or push" >&2
  exit 1
fi

# Prune local copies older than RETAIN_DAYS (git history still has them).
find "$OUT_DIR" -name 'filmlog-*.sql.gz' -mtime +"$RETAIN_DAYS" -delete

# Ship it.
cd "$BACKUP_REPO"
git add -A nightly/
if ! git diff --cached --quiet; then
  ROLLS=$(gunzip -c "$OUT" | grep -c '^INSERT INTO' || true)
  git -c user.name="tomu-backup" -c user.email="backup@tomu.local" \
    commit -q -m "nightly $STAMP ($HOST_TAG, $(numfmt --to=iec "$BYTES" 2>/dev/null || echo "${BYTES}B"))"
  git push -q origin HEAD
fi

echo "ok: $OUT ($BYTES bytes)"
