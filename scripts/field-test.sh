#!/usr/bin/env bash
# Local "field test" stack: API + MCP-over-HTTP + Cloudflare quick tunnel, so the
# claude.ai connector on a phone can reach the branch running on this laptop.
# Nothing touches prod. Ctrl-C stops everything.
#
# Usage: scripts/field-test.sh            (dev token read from `claude mcp get tomu-dev`)
#        TOMU_API_TOKEN=... scripts/field-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

LOG=${LOG:-/tmp/tomu-field-test}
mkdir -p "$LOG"
: "${TOMU_API_TOKEN:=$(claude mcp get tomu-dev 2>/dev/null | sed -n 's/.*TOMU_API_TOKEN=//p' | head -1)}"
[ -n "$TOMU_API_TOKEN" ] || { echo "TOMU_API_TOKEN not set and not found via claude mcp get tomu-dev"; exit 2; }

PATH_SECRET=$(openssl rand -hex 12)
MCP_TOKEN=$(openssl rand -hex 24)
PIDS=()
cleanup() { echo; echo "stopping…"; for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

echo "▶ API (port 3456)"
npm run dev:server >"$LOG/api.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 30); do curl -sf localhost:3456/api/health >/dev/null && break; sleep 1; done
curl -sf localhost:3456/api/health >/dev/null || { echo "API failed to start — see $LOG/api.log"; exit 1; }

echo "▶ tunnel"
cloudflared tunnel --url http://localhost:3457 --no-autoupdate >"$LOG/tunnel.log" 2>&1 & PIDS+=($!)
TUNNEL=""
for i in $(seq 1 40); do
  TUNNEL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG/tunnel.log" | head -1 || true)
  [ -n "$TUNNEL" ] && break; sleep 1
done
[ -n "$TUNNEL" ] || { echo "tunnel URL not found — see $LOG/tunnel.log"; exit 1; }

echo "▶ MCP over HTTP (port 3457)"
npm run build -w packages/mcp >"$LOG/mcp-build.log" 2>&1
TOMU_API_URL=http://localhost:3456/api/v1 TOMU_API_TOKEN="$TOMU_API_TOKEN" \
DATABASE_URL="${DATABASE_URL:-postgres://filmlog:filmlog@localhost:5432/filmlog}" \
OAUTH_ISSUER_URL="$TUNNEL" TOMU_MCP_PATH_SECRET="$PATH_SECRET" TOMU_MCP_TOKEN="$MCP_TOKEN" \
  node packages/mcp/dist/http.js >"$LOG/mcp.log" 2>&1 & PIDS+=($!)
sleep 2
grep -q 'tomu-mcp http' "$LOG/mcp.log" || { echo "MCP failed — see $LOG/mcp.log"; exit 1; }

cat <<MSG

================ FIELD TEST READY ================
claude.ai connector URL (OAuth; log in with your local Tomu account):
  $TUNNEL/mcp

Fallback URL (path secret, no login):
  $TUNNEL/$PATH_SECRET/mcp

Logs: $LOG/{api,mcp,tunnel}.log
Ctrl-C here stops API, MCP and tunnel.
==================================================
MSG
wait
