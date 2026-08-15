#!/usr/bin/env bash
#
# Repeatable Tomu deploy: rsync working tree -> remote, build on the box, reload pm2.
#
#   ./scripts/deploy.sh            # code-only deploy
#   ./scripts/deploy.sh --migrate  # also apply DB schema changes (drizzle push)
#
# Configure the target once in .deploy.env (gitignored). See .deploy.env.example.
#
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

# ── target config ────────────────────────────────────────────────────────────
if [ -f .deploy.env ]; then set -a; . ./.deploy.env; set +a; fi
: "${DEPLOY_HOST:?set DEPLOY_HOST (host/IP of your droplet) in .deploy.env}"
DEPLOY_USER="${DEPLOY_USER:-fhwrdh}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/${DEPLOY_USER}/filmlog}"

MIGRATE=false
[ "${1:-}" = "--migrate" ] && MIGRATE=true

target="${DEPLOY_USER}@${DEPLOY_HOST}"
echo "==> deploying to ${target}:${DEPLOY_PATH}  (migrate=${MIGRATE})"

# ── 1. sync source (never ship node_modules/dist/secrets; --delete keeps it clean)
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '.deploy.env' \
  --exclude 'db-backups' \
  --exclude 'DEPLOY.md' \
  --exclude '*.log' \
  -e ssh ./ "${target}:${DEPLOY_PATH}/"

# ── 2. build + reload on the remote ──────────────────────────────────────────
ssh "${target}" "MIGRATE=${MIGRATE} DEPLOY_PATH='${DEPLOY_PATH}' bash -l -s" <<'REMOTE'
set -euo pipefail
cd "$DEPLOY_PATH"
echo "--> npm install"
npm install --no-audit --no-fund
echo "--> clearing stale tsbuildinfo (else composite tsc skips emit)"
find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete
echo "--> build"
npm run build
if [ "$MIGRATE" = true ]; then
  echo "--> db schema push (drizzle)"
  npm run db:push -w packages/server
fi
echo "--> pm2 reload"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
pm2 list
REMOTE

echo "==> done."
