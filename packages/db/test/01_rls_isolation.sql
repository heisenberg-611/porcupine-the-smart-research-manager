-- R-02: prove RLS fails closed and does not leak across transactions.
--
-- These are the three assertions named in docs/05-resolution-plan.md R-02.
-- The concurrency half of `rls_no_cross_tenant` lives in scripts/pgtap.mjs,
-- because a single psql session cannot exercise a connection pool.
--
-- Everything here runs as Porcupine_app, not as postgres. Running these as a
-- superuser would pass regardless of policy and prove nothing.

begin;
select plan(12);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Created as the migration owner, before we drop to Porcupine_app.

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev',   'Bob',   now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'mallory@test.dev','Mallory', now(), now());

insert into projects (id, slug, title, created_by, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice-thesis', 'Alice Thesis',
   '11111111-1111-1111-1111-111111111111', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob-review', 'Bob Review',
   '22222222-2222-2222-2222-222222222222', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('a1a1a1a1-0000-0000-0000-000000000001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'OWNER', now(), now(), now()),
  ('b1b1b1b1-0000-0000-0000-000000000001',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'OWNER', now(), now(), now());

insert into project_keys
  (id, project_id, user_id, epoch, wrapped_key, wrapped_by, signature, created_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 1, '\x00'::bytea,
   '11111111-1111-1111-1111-111111111111', '\x00'::bytea, now());

-- ═══════════════ Test 1: rls_denies_without_claim ═══════════════════════════
-- With no claim set, every predicate evaluates NULL and every row is filtered.
-- This is the fail-closed property: an empty result, never another user's rows.

set local role Porcupine_app;

select is(
  (select count(*) from projects)::int, 0,
  'no claim set: projects returns zero rows (fail closed)'
);
select is(
  (select count(*) from project_members)::int, 0,
  'no claim set: project_members returns zero rows'
);
select is(
  (select count(*) from users)::int, 0,
  'no claim set: users returns zero rows'
);
select is(
  (select count(*) from project_keys)::int, 0,
  'no claim set: project_keys returns zero rows'
);
select ok(
  public.current_user_id() is null,
  'no claim set: current_user_id() is NULL, not a default identity'
);

-- ═══════════════ Test 2: a claim scopes to exactly one tenant ═══════════════

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

select is(
  (select count(*) from projects)::int, 1,
  'alice sees exactly her own project'
);
select is(
  (select slug from projects), 'alice-thesis',
  'alice sees alice-thesis, not bob-review'
);
select is(
  (select count(*) from project_keys)::int, 1,
  'alice sees the key wrapped to her'
);

-- Switch claim within the same transaction: the view must switch with it.
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', true);

select is(
  (select slug from projects), 'bob-review',
  'changing the claim changes the visible tenant'
);

-- ═══════════════ Test 3: a non-member sees nothing ══════════════════════════
-- Mallory is a real, authenticated user with no membership anywhere.

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);

select is(
  (select count(*) from projects)::int, 0,
  'authenticated non-member sees no projects'
);
select is(
  (select count(*) from project_keys)::int, 0,
  'authenticated non-member sees no wrapped keys'
);

-- ═══════════════ Test 4: a forged claim buys nothing ════════════════════════
-- The GUC is set by trusted code after JWT verification, but assert that a
-- syntactically valid claim for a nonexistent user still resolves to nothing.

select set_config('request.jwt.claims',
  '{"sub":"99999999-9999-9999-9999-999999999999"}', true);

select is(
  (select count(*) from projects)::int, 0,
  'claim for a nonexistent user sees nothing'
);

select * from finish();
rollback;
