-- Structural invariants. These are the assertions that stop a future
-- migration from quietly reopening the boundary.
--
-- Run with: pnpm db:test

begin;
select plan(19);

-- ── Rule 1: every public table has RLS enabled AND forced ───────────────────
-- FORCE matters: without it, policies do not apply to the table owner, and a
-- migration that runs as owner silently sees everything.

select is_empty(
  $$ select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname <> '_prisma_migrations'
       and c.relrowsecurity = false $$,
  'every public table has row level security ENABLED'
);

select is_empty(
  $$ select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname <> '_prisma_migrations'
       and c.relforcerowsecurity = false $$,
  'every public table has row level security FORCED'
);

-- ── Rule 2: every table with RLS has at least one policy ────────────────────
-- RLS enabled with no policy denies everything, which is safe but is almost
-- always an oversight rather than a decision.

select is_empty(
  $$ select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname <> '_prisma_migrations'
       and not exists (
         select 1 from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname
       ) $$,
  'every public table has at least one policy'
);

-- ── Rule 3: no permissive escape hatch in any policy ────────────────────────
-- A policy whose qualifier is literally `true` grants everything. This
-- assertion is the reason `OR true` cannot survive review.

select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
     where schemaname = 'public'
       and (
         btrim(coalesce(qual, '')) = 'true'
         or btrim(coalesce(with_check, '')) = 'true'
         or coalesce(qual, '') ~ '\mOR true\M'
         or coalesce(with_check, '') ~ '\mOR true\M'
       ) $$,
  'no policy has an unconditionally true qualifier'
);

-- ── Rule 4: the application role is unprivileged ────────────────────────────

select ok(
  not (select rolbypassrls from pg_roles where rolname = 'Porcupine_app'),
  'Porcupine_app cannot bypass RLS'
);
select ok(
  not (select rolsuper from pg_roles where rolname = 'Porcupine_app'),
  'Porcupine_app is not a superuser'
);
select ok(
  not (select rolcreaterole from pg_roles where rolname = 'Porcupine_app'),
  'Porcupine_app cannot create roles'
);

-- ── Rule 5: append-only tables have no UPDATE or DELETE policy ──────────────
-- The ABSENCE of a policy is the enforcement (docs/01-data-model.md §1 r5).
-- Key epochs must stay readable forever, so old wraps are never mutated.

select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'public' and tablename = 'project_keys'
       and cmd in ('UPDATE', 'DELETE') $$,
  'project_keys is append-only: no UPDATE or DELETE policy'
);

-- ── Helper functions exist and are correctly hardened ───────────────────────

select has_function('public', 'current_claims', 'current_claims() exists');
select has_function('public', 'current_user_id', 'current_user_id() exists');
select has_function('public', 'is_project_member', ARRAY['uuid'],
  'is_project_member(uuid) exists');
select has_function('public', 'has_project_role', ARRAY['uuid', '"AccessRole"[]'],
  'has_project_role(uuid, AccessRole[]) exists');

-- SECURITY DEFINER functions with a mutable search_path are a privilege
-- escalation primitive. Every definer function must pin it.
select is_empty(
  $$ select p.proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
         where cfg like 'search_path=%'
       ) $$,
  'every SECURITY DEFINER function pins its search_path'
);

select ok(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_project_member'),
  'is_project_member is SECURITY DEFINER (policies must not recurse)'
);

-- ── Timestamps are timestamptz, never naive (hazard B-07) ───────────────────

select is_empty(
  $$ select table_name || '.' || column_name
     from information_schema.columns
     where table_schema = 'public'
       and data_type = 'timestamp without time zone'
       and table_name <> '_prisma_migrations' $$,
  'no naive timestamp columns — everything is timestamptz'
);

-- ── Core tables exist with the expected shape ───────────────────────────────

select has_table('public', 'projects', 'projects table exists');
select has_table('public', 'project_members', 'project_members table exists');
select has_column('public', 'projects', 'ownership_model',
  'projects.ownership_model exists (R-09)');
select has_column('public', 'users', 'identity_pub_key',
  'users.identity_pub_key exists — Phase 3 needs no re-enrollment');

select * from finish();
rollback;
