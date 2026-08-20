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

# ── Storage buckets ─────────────────────────────────────────────────────────
#
# The check above asks `where nspname = 'public'`, so storage.objects — the
# table that will hold every PDF in the product — was invisible to the one
# guard that has caught every unprotected table so far.
#
# It cannot simply be added to that query. storage.objects is owned by
# supabase_storage_admin and is deliberately not FORCE'd, because the storage
# service needs owner access for its own maintenance; requiring FORCE here
# would fail against a correctly configured project.
#
# The hazard is a different shape anyway. RLS is already enabled on
# storage.objects, so a table-level check would always pass while the actual
# mistake went unnoticed: adding a BUCKET and forgetting its policies. Every
# policy is written `bucket_id = '<name>' and ...`, so a bucket nobody wrote a
# rule for is unreachable by users and — far worse — one dashboard click away
# from being public with nothing objecting. This asks the question that matches
# the mistake.
if psql "$DB" -At -c "select to_regclass('storage.objects')" | grep -q .; then

  rls_off=$(psql "$DB" -v ON_ERROR_STOP=1 -At -c "
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname in ('objects', 'buckets')
      and c.relrowsecurity = false;
  ")

  if [ -n "$rls_off" ]; then
    printf '\033[31m✗ storage tables without RLS:\033[0m\n'
    printf '%s\n' "$rls_off" | sed 's/^/    /'
    exit 1
  fi

  # A public bucket serves every object to anyone holding the URL, with no
  # policy consulted at all. For a paywalled PDF that is a copyright incident
  # rather than a misconfiguration, so it is named separately from the
  # missing-policy case below.
  public_buckets=$(psql "$DB" -v ON_ERROR_STOP=1 -At -c "
    select id from storage.buckets where public;
  ")

  if [ -n "$public_buckets" ]; then
    printf '\033[31m✗ public storage buckets (anyone with the URL reads these):\033[0m\n'
    printf '%s\n' "$public_buckets" | sed 's/^/    /'
    exit 1
  fi

  # quote_literal so the match is against the same token the policy carries —
  # 'papers' with its quotes — rather than a bare substring that a bucket named
  # `paper` would also satisfy.
  unruled=$(psql "$DB" -v ON_ERROR_STOP=1 -At -c "
    select b.id from storage.buckets b
    where not exists (
      select 1 from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage' and c.relname = 'objects'
        and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
         || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
            like '%' || quote_literal(b.id) || '%'
    );
  ")

  if [ -n "$unruled" ]; then
    printf '\033[31m✗ storage buckets with no policy naming them:\033[0m\n'
    printf '%s\n' "$unruled" | sed 's/^/    /'
    exit 1
  fi

  printf 'ok: every storage bucket is private and named by a policy\n'
fi
