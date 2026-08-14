-- Phase 1 week 5 — screening integrity, the decision log, and the progress view.
--
-- The view gets its own attention. `security_invoker = true` is the only
-- thing standing between a convenience view and a hole straight through every
-- policy underneath it: a view created without it runs as its OWNER, so any
-- caller who can select from it sees every tenant's rows. That is the single
-- easiest way to undo an entire RLS baseline, and it looks like nothing.

begin;
select plan(16);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev',   'Bob',   now(), now()),
  ('55555555-5555-5555-5555-555555555555', 'sup@test.dev',   'Sup',   now(), now());

-- One SYSTEMATIC_REVIEW (reason required) and one THESIS (not required).
insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sr', 'Systematic Review',
   'SYSTEMATIC_REVIEW', '11111111-1111-1111-1111-111111111111', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'th', 'Thesis',
   'THESIS', '11111111-1111-1111-1111-111111111111', now(), now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'other', 'Bob Review',
   'THESIS', '22222222-2222-2222-2222-222222222222', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'OWNER', now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '11111111-1111-1111-1111-111111111111', 'OWNER', now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '55555555-5555-5555-5555-555555555555', 'REVIEWER', now(), now(), now()),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '22222222-2222-2222-2222-222222222222', 'OWNER', now(), now(), now());

insert into works (id, title_norm, title, authors, updated_at) values
  ('c0000000-0000-0000-0000-000000000001', 'paper one', 'Paper One', '[]'::jsonb, now()),
  ('c0000000-0000-0000-0000-000000000002', 'paper two', 'Paper Two', '[]'::jsonb, now());

insert into project_works
  (id, project_id, work_id, added_by, source, created_at, updated_at) values
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'search', now(), now()),
  ('d0000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'search', now(), now()),
  ('d0000000-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'c0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'search', now(), now());

set local role porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

-- ═══════════ The exclusion-reason rule lives in the database ═══════════════

select throws_ok(
  $$update project_works set screen_status = 'EXCLUDED'
    where id = 'd0000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'a systematic review refuses an EXCLUDED row with no reason'
);

select lives_ok(
  $$update project_works
      set screen_status = 'EXCLUDED', exclude_reason = 'WRONG_POPULATION'
    where id = 'd0000000-0000-0000-0000-000000000001'$$,
  'and accepts it once a reason is given'
);

-- R-06: a thesis student jotting notes is not held to review bookkeeping.
select lives_ok(
  $$update project_works set screen_status = 'EXCLUDED'
    where id = 'd0000000-0000-0000-0000-000000000002'$$,
  'a THESIS project may exclude without a reason'
);

-- Whitespace is not a reason. Without the trim() this passes and the PRISMA
-- diagram gets a category of " ".
select throws_ok(
  $$update project_works
      set screen_status = 'EXCLUDED', exclude_reason = '   '
    where id = 'd0000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'a whitespace-only reason is not a reason'
);

-- ═══════════ The decision log is append-only ══════════════════════════════

select lives_ok(
  $$insert into screening_decisions
      (id, project_id, project_work_id, decided_by, from_status, to_status,
       exclude_reason, created_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'IDENTIFIED', 'EXCLUDED',
            'WRONG_POPULATION', now())$$,
  'a contributor records their own decision'
);

select throws_ok(
  $$insert into screening_decisions
      (id, project_id, project_work_id, decided_by, to_status, created_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222', 'INCLUDED', now())$$,
  '42501',
  null,
  'and cannot record a decision in someone else''s name'
);

-- No UPDATE or DELETE policy exists, so both are silently filtered to zero
-- rows rather than raising. Asserted by effect, and the value is read back:
-- "zero rows updated" and "the record is unchanged" are different claims.
with attempted as (
  update screening_decisions set to_status = 'INCLUDED'
  where project_work_id = 'd0000000-0000-0000-0000-000000000001'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'a recorded decision cannot be edited');

select is(
  (select to_status::text from screening_decisions
    where project_work_id = 'd0000000-0000-0000-0000-000000000001' limit 1),
  'EXCLUDED',
  'and the original decision still says what it said');

with attempted as (
  delete from screening_decisions
  where project_work_id = 'd0000000-0000-0000-0000-000000000001'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'a recorded decision cannot be deleted');

-- ═══════════ A REVIEWER observes; they do not screen ══════════════════════

select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555"}', true);

select is((select count(*) from screening_decisions)::int, 1,
  'a reviewer can read the decision log');

select throws_ok(
  $$insert into screening_decisions
      (id, project_id, project_work_id, decided_by, to_status, created_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            '55555555-5555-5555-5555-555555555555', 'INCLUDED', now())$$,
  '42501',
  null,
  'but a reviewer cannot record a screening decision'
);

-- ═══════════ v_project_progress does not leak across tenants ══════════════
-- The single easiest way to undo an entire RLS baseline is a view created
-- without security_invoker: it runs as its owner, so every caller sees every
-- tenant. It looks like nothing in a diff.

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

select is(
  (select count(distinct project_id) from v_project_progress)::int,
  2,
  'alice sees progress for exactly her two projects'
);

select is(
  (select count(*) from v_project_progress
    where project_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc')::int,
  0,
  'and none for the project she is not a member of'
);

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', true);

select is(
  (select count(distinct project_id) from v_project_progress)::int,
  1,
  'bob sees only his own'
);

-- The mutation check: with no claim the view must be empty, and the rows it
-- is hiding must actually exist — otherwise the two assertions above pass
-- against nothing.
select set_config('request.jwt.claims', '', true);
select is((select count(*) from v_project_progress)::int, 0,
  'no claim: the progress view is empty (fail closed)');

set local role postgres;
select cmp_ok((select count(*) from v_project_progress)::int, '>', 0,
  'MUTATION: the view has rows to hide — the zero above was RLS');

select * from finish();
rollback;
