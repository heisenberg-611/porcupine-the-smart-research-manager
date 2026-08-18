-- `project_activity` — the realtime doorbell, and what it must never leak.
--
-- This table is the ONLY one in the `supabase_realtime` publication, which
-- means it is the only table whose rows are pushed over a websocket to
-- subscribed browsers. Everything about its safety rests on two claims:
--
--   1. It holds no content. A project id, a word, a timestamp. Asserted here
--      by pinning the column list — if a future migration adds `work_id` or
--      `decided_by` to it, this fails, and it should, because that column
--      would be on the wire.
--   2. A non-member sees nothing. SELECT is the only policy; there is no
--      insert, update or delete policy at all, so with FORCE ROW LEVEL
--      SECURITY the rows can be written by nothing except the SECURITY
--      DEFINER trigger.
--
-- Realtime's own enforcement of (2) is NOT tested here and cannot be: CI
-- starts Supabase with `-x realtime`. That is exactly why the table carries
-- nothing worth intercepting — the design does not depend on a boundary this
-- repository is unable to exercise.
--
-- Every count of zero below is paired with the same count taken as `postgres`,
-- because zero rows against an empty table proves nothing.

begin;
select plan(14);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('ac000000-0000-0000-0000-000000000001', 'act-alice@test.dev',   'Alice',   now(), now()),
  ('ac000000-0000-0000-0000-000000000002', 'act-bob@test.dev',     'Bob',     now(), now()),
  ('ac000000-0000-0000-0000-000000000003', 'act-mallory@test.dev', 'Mallory', now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('ac000000-0000-0000-0000-0000000000a1', 'act-project', 'Activity', 'SYSTEMATIC_REVIEW',
   'ac000000-0000-0000-0000-000000000001', now(), now()),
  ('ac000000-0000-0000-0000-0000000000a2', 'act-other',   'Other',    'THESIS',
   'ac000000-0000-0000-0000-000000000003', now(), now());

-- Mallory owns the OTHER project and is deliberately not a member of the first.
insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('ac000000-0000-0000-0000-0000000000b1', 'ac000000-0000-0000-0000-0000000000a1',
   'ac000000-0000-0000-0000-000000000001', 'OWNER', now(), now(), now()),
  ('ac000000-0000-0000-0000-0000000000b2', 'ac000000-0000-0000-0000-0000000000a1',
   'ac000000-0000-0000-0000-000000000002', 'CONTRIBUTOR', now(), now(), now()),
  ('ac000000-0000-0000-0000-0000000000b3', 'ac000000-0000-0000-0000-0000000000a2',
   'ac000000-0000-0000-0000-000000000003', 'OWNER', now(), now(), now());

insert into works (id, title_norm, title, authors, updated_at) values
  ('ac000000-0000-0000-0000-0000000000d1', 'a paper about porcupines',
   'A paper about porcupines', '[]'::jsonb, now());

-- ── 1 · The shape of it ─────────────────────────────────────────────────────
--
-- Pinned deliberately. This is the wire format.

select set_eq(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'project_activity' $$,
  array['project_id', 'kind', 'at'],
  'project_activity carries a project, a kind and a time — and nothing else'
);

select is(
  (select count(*)::int from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'),
  1,
  'exactly one table is published to realtime'
);

select is(
  (select tablename::text from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'),
  'project_activity',
  'and it is the one with no content in it'
);

-- ── 2 · The trigger writes it, and a member never has to ────────────────────

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-000000000001"}', true);

select lives_ok($$
  insert into project_works
    (id, project_id, work_id, added_by, source, screen_status, created_at, updated_at)
  values ('ac000000-0000-0000-0000-0000000000e1',
          'ac000000-0000-0000-0000-0000000000a1',
          'ac000000-0000-0000-0000-0000000000d1',
          'ac000000-0000-0000-0000-000000000001', 'SEARCH', 'IDENTIFIED', now(), now())
$$, 'adding a paper works as it always did');

select is(
  (select kind from project_activity
    where project_id = 'ac000000-0000-0000-0000-0000000000a1'),
  'screening',
  'and the trigger recorded that screening activity happened'
);

-- One row per (project, kind), not one per event. A 300-paper review must not
-- leave 300 rows behind, which is the whole reason this is an upsert.
select lives_ok($$
  update project_works set screen_status = 'INCLUDED'
   where id = 'ac000000-0000-0000-0000-0000000000e1'
$$, 'a screening decision lands');

select is(
  (select count(*)::int from project_activity
    where project_id = 'ac000000-0000-0000-0000-0000000000a1'),
  1,
  'a second event bumps the row rather than appending one'
);

-- ── 3 · A member cannot write it, even though the trigger just did ──────────
--
-- No INSERT, UPDATE or DELETE policy exists. With FORCE RLS that is a refusal,
-- which is what keeps a member from forging activity in a project — or, more
-- to the point, from being able to write anything at all onto the one channel
-- that is broadcast to every other member's browser.

select throws_ok($$
  insert into project_activity (project_id, kind, at)
  values ('ac000000-0000-0000-0000-0000000000a1', 'forged', now())
$$, '42501', null, 'a member cannot insert a signal directly');

-- An UPDATE with no policy does not RAISE, unlike the insert above — it
-- matches no rows and reports zero. Postgres evaluates a missing UPDATE policy
-- as a USING clause that is false for everything, and an update that changes
-- nothing is not an error. Asserted by counting what changed, the same way
-- 13_project_keys.sql asserts its append-only rule, because `throws_ok` here
-- passes for the wrong reason and then fails the day someone adds a policy.
with changed as (
  update project_activity set kind = 'tampered'
   where project_id = 'ac000000-0000-0000-0000-0000000000a1'
  returning 1
)
select is((select count(*)::int from changed), 0, 'nor rewrite one');

select is(
  (select count(*)::int from project_activity
    where project_id = 'ac000000-0000-0000-0000-0000000000a1' and kind = 'screening'),
  1,
  'and the real signal is untouched by either attempt'
);

-- ── 4 · A non-member sees nothing ───────────────────────────────────────────

select set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-000000000003"}', true);

select is(
  (select count(*)::int from project_activity
    where project_id = 'ac000000-0000-0000-0000-0000000000a1'),
  0,
  'Mallory, who is not a member, sees no signal for that project'
);

-- The mutation check. Without it the zero above is satisfied by an empty
-- table, a broken query, or a policy that denies everyone including Alice.
set local role postgres;

select is(
  (select count(*)::int from project_activity
    where project_id = 'ac000000-0000-0000-0000-0000000000a1'),
  1,
  'MUTATION: there was a signal there to hide'
);

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-000000000002"}', true);

select is(
  (select count(*)::int from project_activity
    where project_id = 'ac000000-0000-0000-0000-0000000000a1'),
  1,
  'MUTATION: and Bob, who IS a member, can see it'
);

-- ── 5 · The table is forced, not merely enabled ─────────────────────────────

select is(
  (select relrowsecurity and relforcerowsecurity from pg_class
    where relname = 'project_activity'),
  true,
  'project_activity has RLS enabled AND forced'
);

select finish();
rollback;
