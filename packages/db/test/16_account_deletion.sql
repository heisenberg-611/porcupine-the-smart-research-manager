-- Account deletion — the row that must survive, and the owner that must remain.
--
-- Two rules are asserted here, and both are the kind that were previously
-- believed rather than tested.
--
--   1. A user row cannot simply be deleted. Ten foreign keys were added in
--      20260818203328 precisely so that the attempt FAILS instead of quietly
--      leaving `annotations.author_id` and nine other columns pointing at
--      nothing. The deletion path anonymises instead, and the anonymised row
--      still carries the screening decisions that make a PRISMA diagram
--      defensible.
--
--   2. A project cannot be left without an owner. Nothing stopped the last one
--      leaving: `removeMember` sets `removed_at` with no check, RLS gates the
--      statement only to OWNER or ADMIN, and demotion took the same path. An
--      admin could orphan a project, and account deletion would have done it
--      by accident on every sole-owned project somebody closed.
--
-- Every zero is paired with the same count taken as `postgres`, because a
-- count of zero against an empty table proves nothing.

begin;
select plan(17);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('ad000000-0000-0000-0000-000000000001', 'del-owner@test.dev',  'Owner',  now(), now()),
  ('ad000000-0000-0000-0000-000000000002', 'del-second@test.dev', 'Second', now(), now()),
  ('ad000000-0000-0000-0000-000000000003', 'del-admin@test.dev',  'Admin',  now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('ad000000-0000-0000-0000-0000000000a1', 'del-project', 'Deletion', 'SYSTEMATIC_REVIEW',
   'ad000000-0000-0000-0000-000000000001', now(), now());

-- TWO owners to begin with, deliberately.
--
-- With one, deleting the user cascades into `project_members` and the
-- last-owner trigger raises 23514 before the foreign key on
-- `screening_decisions` is ever consulted. Both refusals are real and both are
-- asserted below, but they have to be provoked separately or the first test
-- passes for the second rule's reason.
insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('ad000000-0000-0000-0000-0000000000b1', 'ad000000-0000-0000-0000-0000000000a1',
   'ad000000-0000-0000-0000-000000000001', 'OWNER', now(), now(), now()),
  ('ad000000-0000-0000-0000-0000000000b2', 'ad000000-0000-0000-0000-0000000000a1',
   'ad000000-0000-0000-0000-000000000002', 'OWNER', now(), now(), now()),
  ('ad000000-0000-0000-0000-0000000000b3', 'ad000000-0000-0000-0000-0000000000a1',
   'ad000000-0000-0000-0000-000000000003', 'ADMIN', now(), now(), now());

insert into works (id, title_norm, title, authors, updated_at) values
  ('ad000000-0000-0000-0000-0000000000d1', 'deletion paper', 'Deletion paper', '[]'::jsonb, now());

-- With a reason: this is a SYSTEMATIC_REVIEW, and the trigger that requires
-- one on an exclusion is exactly the sort of rule this suite exists to keep.
insert into project_works
  (id, project_id, work_id, added_by, source, screen_status, exclude_reason,
   created_at, updated_at) values
  ('ad000000-0000-0000-0000-0000000000e1', 'ad000000-0000-0000-0000-0000000000a1',
   'ad000000-0000-0000-0000-0000000000d1', 'ad000000-0000-0000-0000-000000000001',
   'SEARCH', 'EXCLUDED', 'WRONG_POPULATION', now(), now());

insert into screening_decisions
  (id, project_id, project_work_id, decided_by, from_status, to_status, exclude_reason, created_at)
values
  ('ad000000-0000-0000-0000-0000000000f1', 'ad000000-0000-0000-0000-0000000000a1',
   'ad000000-0000-0000-0000-0000000000e1', 'ad000000-0000-0000-0000-000000000001',
   'IDENTIFIED', 'EXCLUDED', 'WRONG_POPULATION', now());

-- ── 1 · The row cannot be deleted, and that is the point ────────────────────

select throws_ok($$
  delete from users where id = 'ad000000-0000-0000-0000-000000000001'
$$, '23503', null,
 'a user with a screening decision cannot be deleted — the audit trail holds the row');

-- The ten columns that had NO constraint before this migration. Each one is a
-- separate way the delete above could have silently succeeded.
select is(
  (select count(*)::int from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'public.users'::regclass),
  18,
  'every column that holds a user id now has a foreign key to users'
);

select ok(
  exists (select 1 from pg_constraint
           where conname = 'annotations_author_id_fkey'),
  'annotations.author_id is constrained — it used to dangle'
);
select ok(
  exists (select 1 from pg_constraint
           where conname = 'extractions_extractor_id_fkey'),
  'extractions.extractor_id is constrained'
);
select ok(
  exists (select 1 from pg_constraint
           where conname = 'projects_created_by_fkey'),
  'projects.created_by is constrained'
);

-- ── 2 · Anonymising is an UPDATE the account makes to its own row ───────────

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-000000000001"}', true);

select lives_ok($$
  update users set
    email = 'deleted-ad000000-0000-0000-0000-000000000001@account.invalid',
    display_name = 'Former member',
    avatar_url = null, orcid = null, affiliation = null,
    identity_pub_key = null, signing_pub_key = null,
    wrapped_bundle = null, kdf_salt = null,
    deleted_at = now(), deletion_scheduled_at = null
  where id = 'ad000000-0000-0000-0000-000000000001'
$$, 'the scrub is an ordinary update the account makes to itself, under RLS');

select is(
  (select display_name from users where id = 'ad000000-0000-0000-0000-000000000001'),
  'Former member',
  'and the identifying half is gone'
);

-- The whole reason the row survives.
set local role postgres;
select is(
  (select count(*)::int from screening_decisions
    where decided_by = 'ad000000-0000-0000-0000-000000000001'),
  1,
  'the screening decision still exists, still attributed'
);

-- ── 3 · Nobody may scrub anybody else ──────────────────────────────────────

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-000000000003"}', true);

with changed as (
  update users set display_name = 'Former member', deleted_at = now()
   where id = 'ad000000-0000-0000-0000-000000000002'
  returning 1
)
select is((select count(*)::int from changed), 0,
  'an admin cannot delete somebody else''s account — update_self means self');

set local role postgres;
select is(
  (select display_name from users where id = 'ad000000-0000-0000-0000-000000000002'),
  'Second',
  'MUTATION: that account was there to be scrubbed, and was not'
);

-- ── 4 · A project keeps an owner ───────────────────────────────────────────
--
-- Down to one owner first, so the rule has something to refuse. Plain SQL
-- rather than an assertion: demoting the second owner is setup, and counting
-- it as a passing test would be counting the fixture.

set local role postgres;
update project_members set access_role = 'ADMIN'
 where id = 'ad000000-0000-0000-0000-0000000000b2';

select throws_ok($$
  update project_members set removed_at = now()
   where id = 'ad000000-0000-0000-0000-0000000000b1'
$$, '23514', null, 'the last owner cannot leave');

select throws_ok($$
  update project_members set access_role = 'CONTRIBUTOR'
   where id = 'ad000000-0000-0000-0000-0000000000b1'
$$, '23514', null, 'nor be demoted, which is the same hole by another route');

select throws_ok($$
  delete from project_members where id = 'ad000000-0000-0000-0000-0000000000b1'
$$, '23514', null, 'nor be deleted outright');

-- Promote somebody, and the door opens.
update project_members set access_role = 'OWNER'
 where id = 'ad000000-0000-0000-0000-0000000000b2';

select lives_ok($$
  update project_members set removed_at = now()
   where id = 'ad000000-0000-0000-0000-0000000000b1'
$$, 'once there are two owners, one may leave');

select is(
  (select count(*)::int from project_members
    where project_id = 'ad000000-0000-0000-0000-0000000000a1'
      and access_role = 'OWNER' and removed_at is null),
  1,
  'and the project still has exactly one'
);

-- ── 5 · Deleting the project itself still works ────────────────────────────
--
-- The delete trigger has to tolerate a cascade: the project going away takes
-- its members with it, and that is not a project left without an owner. Without
-- the guard for it, `delete from projects` would raise on its own cascade and
-- a project could never be deleted again.

select lives_ok($$
  delete from projects where id = 'ad000000-0000-0000-0000-0000000000a1'
$$, 'a project can still be deleted, cascade and all');

select is(
  (select count(*)::int from project_members
    where project_id = 'ad000000-0000-0000-0000-0000000000a1'),
  0,
  'MUTATION: and its members went with it'
);

select finish();
rollback;
