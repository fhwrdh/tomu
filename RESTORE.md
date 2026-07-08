# Backup & Restore

The Tomu database is disposable-infrastructure by design: **the data's home is the
private `fhwrdh/filmlog-backups` GitHub repo**, not any particular machine.
Any Postgres 16 box + the latest nightly dump = a working Tomu in minutes.

## How backups run

- `scripts/db-backup.sh` — pg_dump → gzip → commit+push to `filmlog-backups/nightly/`.
  Portable: only needs `pg_dump`, `git`, and a `DATABASE_URL`. Refuses to push
  suspiciously small dumps. Local copies pruned after 60 days; git history keeps all.
- **Laptop**: launchd job `net.fhwrdh.filmlog.backup` (03:00 daily; runs on wake if
  the lid was closed). Logs: `~/Library/Logs/filmlog-backup.log`.
- **Server (when deployed)**: same script from cron. Set `DATABASE_URL` and
  `BACKUP_REPO`; use a repo deploy key with write access.
- **Pre-change snapshots**: before any schema change or import, take a manual
  timestamped dump into `db-backups/` in the main repo (existing convention).

## Restore — anywhere

```bash
# 1. Get the latest dump
git clone https://github.com/fhwrdh/filmlog-backups.git
LATEST=$(ls filmlog-backups/nightly/filmlog-*.sql.gz | sort | tail -1)

# 2. Fresh database (any Postgres 16)
createdb filmlog   # or: CREATE DATABASE filmlog; CREATE USER filmlog ...

# 3. Restore
gunzip -c "$LATEST" | psql "$DATABASE_URL"

# 4. Verify (compare against the counts in the backup commit message / this table)
psql "$DATABASE_URL" -c "SELECT count(*) FROM rolls;"
```

Dumps are taken with `--no-owner --no-privileges`, so they restore under any role.

## Restore drill (do this occasionally)

```bash
createdb filmlog_restore_test
gunzip -c <dump> | psql -d filmlog_restore_test
# compare row counts for rolls, dev_sessions, film_stocks, cameras, film_inventory, frames
dropdb filmlog_restore_test
```

Last verified: **2026-07-07** — 811 rolls, 247 dev_sessions, 75 film_stocks,
24 cameras, 69 film_inventory, 393 frames — restored copy matched live exactly.

## Portability rules (why this survives a host move)

- Stack is commodity: Postgres 16, nginx, PM2/systemd, certbot. No managed-DB,
  no vendor-specific services in the critical path.
- DNS lives at the registrar/DO today but domains move; nothing in the app
  assumes DO.
- Future file storage (scans, voice notes, reference photos) must be
  S3-*compatible* (DO Spaces, Backblaze B2, R2, MinIO…) behind a config URL —
  never SDK-locked to one vendor — and needs its own replication story before
  it holds the only copy of anything.
