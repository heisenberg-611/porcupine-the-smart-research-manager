#!/usr/bin/env bash
# Everything CI checks, run locally, in one command.
#
# CI exists to prove the repo works from a CLEAN checkout on Linux — no stale
# node_modules, no warm database, no leftover state from this machine. That is
# genuinely worth having and genuinely cannot be reproduced here.
#
# Every individual CHECK, though, runs fine locally, and running them here
# first means CI is a confirmation rather than the place mistakes are found.
#
#   pnpm verify           everything except the browser suite
#   pnpm verify --e2e     including it (needs Supabase up)
set -uo pipefail
cd "$(dirname "$0")/.."

run() {
  printf '\n\033[1m▸ %s\033[0m\n' "$1"; shift
  if "$@"; then return 0; fi
  printf '\033[31m✗ failed\033[0m\n'
  exit 1
}

run "typecheck"          pnpm typecheck
run "lint"               pnpm lint
run "format"             pnpm format:check
run "guards"             pnpm guards
run "shared"             pnpm --filter @porcupine/shared test
run "crypto"             pnpm --filter @porcupine/crypto test
run "discovery"          pnpm --filter @porcupine/discovery test
run "anchoring"          pnpm --filter @porcupine/anchoring test
# apps/web had a `test` script and a vitest config that NOTHING invoked. A unit
# test written there would have run green locally and never once in CI.
run "web"                pnpm --filter @porcupine/web test

# Everything below needs the local stack. Say so plainly rather than letting
# psql fail with ECONNREFUSED, which names a port and not a fix.
if ! curl -fsS -m 3 -o /dev/null http://127.0.0.1:54321/auth/v1/health 2>/dev/null; then
  printf '\n\033[33m▸ Supabase is not running.\033[0m\n'
  printf '  The database and browser checks need it:\n\n'
  printf '      pnpm db:start\n\n'
  printf '  Everything that does not need it passed.\n'
  exit 1
fi

if [ "${1:-}" = "--e2e" ]; then
  # `db reset` first so the RLS suite and the browser tests start from the same
  # clean state CI gives them.
  run "migrations"       pnpm exec supabase db reset --no-seed
fi

run "RLS suite"          pnpm db:test
run "RLS coverage"       bash scripts/assert-rls.sh

if [ "${1:-}" = "--e2e" ]; then
  run "schema drift"     pnpm db:diff
  run "build"            pnpm --filter @porcupine/web build
  # A port of its own, so a dev server on 3000 does not have to be killed.
  E2E_PORT="${E2E_PORT:-3100}" run "e2e + axe" pnpm --filter @porcupine/web test:e2e
else
  printf '\n\033[33mSkipped: build and e2e. Run `pnpm verify --e2e` before pushing UI changes.\033[0m\n'
fi

printf '\n\033[32m✓ all green\033[0m\n'
