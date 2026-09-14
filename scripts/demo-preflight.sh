#!/usr/bin/env bash
# One pass over every surface the interview demo touches. Prints a PASS/FAIL line per
# check and exits non-zero if any fail. Offline checks first, so a dead network still
# tells you the local half of the demo works.
#
# Usage: bash scripts/demo-preflight.sh
set -uo pipefail
cd "$(dirname "$0")/.."

fails=0
check() {
  local name="$1"; shift
  if out=$("$@" 2>&1); then
    printf 'PASS  %s\n' "$name"
  else
    printf 'FAIL  %s\n%s\n' "$name" "$(printf '%s' "$out" | tail -5 | sed 's/^/      /')"
    fails=$((fails + 1))
  fi
}

# ── offline ──
check "shared package builds" npm run build:shared --silent
check "parser reads the f/50 note as f/2" \
  bash -c 'NO_COLOR=1 npx tsx scripts/parse-demo.ts "Mica M6, Ilford Pan F50, frame 1, F2, 1/125th of a second" | grep -q "f/2"'
check "tier-2 recordings present" \
  bash -c 'ls evals/field-parse/recordings/*.json >/dev/null 2>&1'
check "eval replays tier 2 with no stale recordings" \
  bash -c 'out=$(NO_COLOR=1 npx tsx evals/field-parse/run.ts --sweep); echo "$out" | grep -q "merged @ 0.9" && echo "$out" | grep -q "threshold sweep" && ! echo "$out" | grep -qi stale'
check "eval gate test passes" npx vitest run evals --silent

# ── network ──
check "prod web app up" \
  bash -c '[ "$(curl -s -o /dev/null -w "%{http_code}" https://film.fhwrdh.net/)" = 200 ]'
check "prod OAuth metadata served" \
  bash -c 'curl -sf https://film.fhwrdh.net/.well-known/oauth-authorization-server | grep -q "code_challenge_methods_supported"'
check "prod MCP challenges unauthenticated calls" \
  bash -c 'curl -s -o /dev/null -D - -X POST https://film.fhwrdh.net/mcp | grep -qi "www-authenticate: bearer"'

echo
if [ "$fails" -eq 0 ]; then echo "preflight: all clear"; else echo "preflight: $fails failing"; fi
exit "$fails"
