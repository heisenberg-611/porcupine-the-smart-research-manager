-- `project_keys` — the first rows this table has ever held.
--
-- The table, its RLS and its policies have been in the schema since Phase 0
-- and were read and written by NOTHING. A policy that has never been evaluated
-- against a row is a policy nobody has tested, however carefully it was
-- written, and this one guards the keys every piece of project content will be
-- encrypted under.
--
-- What the policies say:
--
--   SELECT  user_id = current_user_id()
--   INSERT  is_project_member(project_id) and wrapped_by = current_user_id()
--   UPDATE  — no policy
--   DELETE  — no policy
--
-- The two absences are the interesting half. With FORCE ROW LEVEL SECURITY and
-- no policy, an update or a delete is refused outright, which makes this table
-- append-only: a rotation adds an epoch, it never edits one. Nothing in the
-- schema says "append-only" in words, so it is asserted here instead.
--
-- Every zero below is paired with the same count taken as `postgres`, because
-- a count of zero against an empty table proves nothing at all.

begin;
select plan(15);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('aa000000-0000-0000-0000-000000000001', 'keys-alice@test.dev', 'Alice', now(), now()),
  ('aa000000-0000-0000-0000-000000000002', 'keys-bob@test.dev',   'Bob',   now(), now()),
  ('aa000000-0000-0000-0000-000000000003', 'keys-mallory@test.dev','Mallory', now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('aa000000-0000-0000-0000-0000000000a1', 'key-project', 'Keys', 'SYSTEMATIC_REVIEW',
   'aa000000-0000-0000-0000-000000000001', now(), now());

-- Mallory is deliberately NOT a member.
insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('aa000000-0000-0000-0000-0000000000b1', 'aa000000-0000-0000-0000-0000000000a1',
   'aa000000-0000-0000-0000-000000000001', 'OWNER', now(), now(), now()),
  ('aa000000-0000-0000-0000-0000000000b2', 'aa000000-0000-0000-0000-0000000000a1',
   'aa000000-0000-0000-0000-000000000002', 'CONTRIBUTOR', now(), now(), now());

-- ── Alice provisions the epoch-1 key to herself and to Bob ──────────────────

set local role porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"aa000000-0000-0000-0000-000000000001"}', true);

select lives_ok($$
  insert into project_keys (id, project_id, user_id, epoch, wrapped_key, wrapped_by, signature)
  values ('aa000000-0000-0000-0000-0000000000c1',
          'aa000000-0000-0000-0000-0000000000a1',
          'aa000000-0000-0000-0000-000000000001', 1,
          '\xdead'::bytea, 'aa000000-0000-0000-0000-000000000001', '\xbeef'::bytea)
$$, 'a member can wrap the project key to themselves');

select lives_ok($$
  insert into project_keys (id, project_id, user_id, epoch, wrapped_key, wrapped_by, signature)
  values ('aa000000-0000-0000-0000-0000000000c2',
          'aa000000-0000-0000-0000-0000000000a1',
          'aa000000-0000-0000-0000-000000000002', 1,
          '\xdead'::bytea, 'aa000000-0000-0000-0000-000000000001', '\xbeef'::bytea)
$$, 'and to ANOTHER member — which is how provisioning works at all');

-- ── The insert policy's two halves ──────────────────────────────────────────

select throws_ok($$
  insert into project_keys (id, project_id, user_id, epoch, wrapped_key, wrapped_by, signature)
  values ('aa000000-0000-0000-0000-0000000000c3',
          'aa000000-0000-0000-0000-0000000000a1',
          'aa000000-0000-0000-0000-000000000001', 2,
          '\xdead'::bytea, 'aa000000-0000-0000-0000-000000000002', '\xbeef'::bytea)
$$, '42501', null,
  'a wrap cannot claim someone else made it — wrapped_by must be the caller');

set local role porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"aa000000-0000-0000-0000-000000000003"}', true);

select throws_ok($$
  insert into project_keys (id, project_id, user_id, epoch, wrapped_key, wrapped_by, signature)
  values ('aa000000-0000-0000-0000-0000000000c4',
          'aa000000-0000-0000-0000-0000000000a1',
          'aa000000-0000-0000-0000-000000000003', 1,
          '\xdead'::bytea, 'aa000000-0000-0000-0000-000000000003', '\xbeef'::bytea)
$$, '42501', null,
  'a non-member cannot mint themselves a wrap');

-- ── Who can read what ───────────────────────────────────────────────────────

select is(
  (select count(*)::int from project_keys),
  0,
  'a non-member sees no wraps at all (fail closed)'
);

set local role porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"aa000000-0000-0000-0000-000000000002"}', true);

select is(
  (select count(*)::int from project_keys),
  1,
  'a member sees exactly their own wrap'
);

select is(
  (select user_id from project_keys),
  'aa000000-0000-0000-0000-000000000002'::uuid,
  'and it is theirs, not the one addressed to Alice'
);

-- MUTATION CHECKS. Without these the two counts above pass against a table
-- that RLS is not filtering at all, because there is nothing in it.
set local role postgres;

-- Scoped to this fixture's project, not the whole table. Counting every row
-- meant the check silently depended on the database holding nothing else; once
-- the app had written real keys it started failing on a count of 112, which
-- says nothing about whether RLS filters.
select is(
  (select count(*)::int from project_keys
    where project_id = 'aa000000-0000-0000-0000-0000000000a1'),
  2,
  'MUTATION: there really are two wraps to filter'
);

select is(
  (select count(distinct user_id)::int from project_keys
    where project_id = 'aa000000-0000-0000-0000-0000000000a1'),
  2,
  'MUTATION: addressed to two different members'
);

-- ── Append-only: no UPDATE policy, no DELETE policy ─────────────────────────
--
-- Nothing in the schema says "append-only" in words. This is where it is said.
-- A rotation must add an epoch, never rewrite one — an edited wrap is a key
-- substitution that leaves no trace.

set local role porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"aa000000-0000-0000-0000-000000000002"}', true);

with changed as (
  update project_keys set wrapped_key = '\xfeed'::bytea
   where user_id = 'aa000000-0000-0000-0000-000000000002'
  returning 1
)
select is(
  (select count(*)::int from changed),
  0,
  'a member cannot rewrite their own wrap — no UPDATE policy exists'
);

with removed as (
  delete from project_keys
   where user_id = 'aa000000-0000-0000-0000-000000000002'
  returning 1
)
select is(
  (select count(*)::int from removed),
  0,
  'nor delete it — no DELETE policy exists'
);

set local role postgres;

select is(
  (select wrapped_key from project_keys
    where user_id = 'aa000000-0000-0000-0000-000000000002'),
  '\xdead'::bytea,
  'MUTATION: the row was really there to be rewritten, and was not'
);

-- ── Rotation is a new epoch, not an edit ────────────────────────────────────

set local role porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"aa000000-0000-0000-0000-000000000001"}', true);

select lives_ok($$
  insert into project_keys (id, project_id, user_id, epoch, wrapped_key, wrapped_by, signature)
  values ('aa000000-0000-0000-0000-0000000000c5',
          'aa000000-0000-0000-0000-0000000000a1',
          'aa000000-0000-0000-0000-000000000001', 2,
          '\xf00d'::bytea, 'aa000000-0000-0000-0000-000000000001', '\xbeef'::bytea)
$$, 'rotating adds an epoch alongside the old one');

set local role postgres;

select is(
  (select count(*)::int from project_keys
    where user_id = 'aa000000-0000-0000-0000-000000000001'),
  2,
  'both epochs survive — old ciphertext stays readable by whoever held the old key'
);

select is(
  (select relforcerowsecurity from pg_class where relname = 'project_keys'),
  true,
  'RLS is FORCED, so the table owner does not quietly bypass all of the above'
);

select * from finish();
rollback;
