#!/usr/bin/env bash
# Every public table has RLS enabled AND forced.
#
# The pgTAP suite asserts this too, so this is belt and braces — but the two
# fail in different ways. pgTAP runs inside a transaction against the schema it
# expects; this asks the live catalogue, so it still speaks up when a migration
# fails halfway and leaves a table exposed with the suite skipped.
#
# FORCE matters as much as ENABLE: without it the table owner bypasses RLS, and
# the owner is who the app connects as during migrations.
set -uo pipefail

DB="${TEST_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

unprotected=$(psql "$DB" -v ON_ERROR_STOP=1 -At -c "
  select c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname <> '_prisma_migrations'
    and (c.relrowsecurity = false or c.relforcerowsecurity = false);
")

if [ -n "$unprotected" ]; then
  printf '\033[31m✗ tables without FORCE RLS:\033[0m\n'
  printf '%s\n' "$unprotected" | sed 's/^/    /'
  exit 1
fi

printf 'ok: every public table has RLS enabled and forced\n'
