-- PRISMA 2020 counts.
--
-- These numbers go into a published methods section. If they are wrong, an
-- author defends a figure they cannot reproduce — so the arithmetic is
-- asserted here rather than trusted to the page that renders it.
--
-- The views also get the same treatment as v_project_progress: a view created
-- without `security_invoker` runs as its OWNER and shows every tenant to every
-- caller, which is the quietest possible way to undo an RLS baseline.

begin;
select plan(14);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev',   'Bob',   now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sr', 'Review',
   'SYSTEMATIC_REVIEW', '11111111-1111-1111-1111-111111111111', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'other', 'Bob Review',
   'SYSTEMATIC_REVIEW', '22222222-2222-2222-2222-222222222222', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'OWNER', now(), now(), now()),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'OWNER', now(), now(), now());

-- Six works: 2 excluded (two reasons), 2 included, 2 still to screen.
insert into works (id, title_norm, title, authors, updated_at)
select ('c0000000-0000-0000-0000-00000000000' || i)::uuid,
       'paper ' || i, 'Paper ' || i, '[]'::jsonb, now()
from generate_series(1, 6) i;

insert into project_works
  (id, project_id, work_id, added_by, source, screen_status, exclude_reason,
   created_at, updated_at)
values
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'bibtex', 'EXCLUDED', 'WRONG_POPULATION', now(), now()),
  ('d0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'bibtex', 'EXCLUDED', 'WRONG_OUTCOME', now(), now()),
  ('d0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'bibtex', 'INCLUDED', null, now(), now()),
  ('d0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'bibtex', 'EXTRACTED', null, now(), now()),
  ('d0000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'search', 'IDENTIFIED', null, now(), now()),
  ('d0000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'bibtex', 'SCREENING', null, now(), now());

-- One import: 10 submitted, 2 merged in the batch, 3 already present, 5 added.
insert into import_batches
  (id, project_id, imported_by, format, submitted, deduplicated,
   already_present, added, created_at)
values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '11111111-1111-1111-1111-111111111111', 'bibtex', 10, 2, 3, 5, now());

set local role porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

-- ═══════════ The counts ═══════════════════════════════════════════════════

-- 10 submitted by import + 1 added by search.
select is((select records_identified from v_prisma_flow
            where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  11, 'identified counts what was submitted, not what survived dedupe');

select is((select records_removed_before_screening from v_prisma_flow
            where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  5, 'removed before screening = merged in batch + already present');

select is((select records_screened from v_prisma_flow
            where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  6, 'screened = everything that entered the library');

select is((select records_excluded from v_prisma_flow
            where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2, 'excluded counts only EXCLUDED');

-- INCLUDED and EXTRACTED both count: a paper being read or extracted has not
-- stopped being included, and a diagram that dropped it as soon as work began
-- would undercount the review.
select is((select studies_included from v_prisma_flow
            where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2, 'included counts every post-inclusion status, not just INCLUDED');

select is((select records_pending from v_prisma_flow
            where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2, 'pending counts what has not been decided');

-- The arithmetic a reviewer would check first.
select is(
  (select records_excluded + studies_included + records_pending from v_prisma_flow
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  (select records_screened from v_prisma_flow
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'excluded + included + pending = screened (the flow closes)'
);

-- ═══════════ Exclusions by reason ═════════════════════════════════════════

select is((select count(*)::int from v_prisma_exclusions
            where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2, 'each exclusion reason is reported separately');

select is((select sum(count)::int from v_prisma_exclusions
            where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  2, 'and the reason counts sum to the excluded total');

select is(
  (select count from v_prisma_exclusions
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and reason = 'WRONG_POPULATION'),
  1, 'reasons are reported by their controlled code, not free text');

-- ═══════════ Tenant isolation ═════════════════════════════════════════════

select is((select count(*)::int from v_prisma_flow
            where project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0, 'alice sees no PRISMA flow for a project she is not in');

select is((select count(*)::int from v_prisma_exclusions
            where project_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0, 'nor its exclusion reasons');

-- Fail closed, and prove the zero above is the policy rather than an empty
-- table: with no claim the view is empty, and the owner can still see rows.
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from v_prisma_flow), 0,
  'no claim: the PRISMA view is empty');

set local role postgres;
select cmp_ok((select count(*)::int from v_prisma_flow), '>', 0,
  'MUTATION: the view has rows to hide — the zero above was RLS');

select * from finish();
rollback;
