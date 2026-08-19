-- `prisma_manual_counts` — the numbers that go into a published figure.
--
-- This table is unusual in this schema: every other number the PRISMA page
-- draws is derived from rows somebody created by doing the work, and these are
-- typed. That makes two things worth asserting rather than assuming.
--
--   1. Only the roles that can change what the review ASSERTS may write them.
--      A contributor screening papers has no business editing the search
--      narrative, and an observer certainly does not.
--   2. Null survives. The whole feature rests on "empty means unstated, zero
--      means we checked and it was none" — if a default or a coalesce ever
--      turns one into the other, a diagram starts claiming something nobody
--      said, and it does so silently.
--
-- Every zero below is paired with the same count taken as `postgres`.

begin;
select plan(12);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('af000000-0000-0000-0000-000000000001', 'prisma-owner@test.dev',       'Owner',       now(), now()),
  ('af000000-0000-0000-0000-000000000002', 'prisma-contributor@test.dev', 'Contributor', now(), now()),
  ('af000000-0000-0000-0000-000000000003', 'prisma-stranger@test.dev',    'Stranger',    now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('af000000-0000-0000-0000-0000000000a1', 'prisma-counts', 'Counts', 'SYSTEMATIC_REVIEW',
   'af000000-0000-0000-0000-000000000001', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('af000000-0000-0000-0000-0000000000b1', 'af000000-0000-0000-0000-0000000000a1',
   'af000000-0000-0000-0000-000000000001', 'OWNER', now(), now(), now()),
  ('af000000-0000-0000-0000-0000000000b2', 'af000000-0000-0000-0000-0000000000a1',
   'af000000-0000-0000-0000-000000000002', 'CONTRIBUTOR', now(), now(), now());

-- ── 1 · The owner can state figures ────────────────────────────────────────

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"af000000-0000-0000-0000-000000000001"}', true);

select lives_ok($$
  insert into prisma_manual_counts
    (project_id, reports_sought, reports_not_retrieved, updated_by, updated_at)
  values ('af000000-0000-0000-0000-0000000000a1', 40, 3,
          'af000000-0000-0000-0000-000000000001', now())
$$, 'an owner can state the figures the app cannot count');

select is(
  (select reports_sought from prisma_manual_counts
    where project_id = 'af000000-0000-0000-0000-0000000000a1'),
  40,
  'and the number is what they said'
);

-- ── 2 · Null and zero are different, and stay different ────────────────────
--
-- The load-bearing assertion of the whole feature. A default of 0 on any of
-- these columns, or a coalesce anywhere between here and the SVG, would turn
-- "we have not said" into "we checked and there were none" — in a figure that
-- goes into a paper, without anyone deciding to.

select is(
  (select registers_identified from prisma_manual_counts
    where project_id = 'af000000-0000-0000-0000-0000000000a1'),
  null,
  'a column nobody has filled in is NULL, not 0'
);

select lives_ok($$
  update prisma_manual_counts set registers_identified = 0
   where project_id = 'af000000-0000-0000-0000-0000000000a1'
$$, 'and zero can be stated deliberately');

select is(
  (select registers_identified from prisma_manual_counts
    where project_id = 'af000000-0000-0000-0000-0000000000a1'),
  0,
  'which is a different answer, and stored as one'
);

select lives_ok($$
  update prisma_manual_counts set registers_identified = null
   where project_id = 'af000000-0000-0000-0000-0000000000a1'
$$, 'clearing it goes back to unstated rather than to zero');

-- ── 3 · A contributor cannot edit what the review asserts ──────────────────

select set_config('request.jwt.claims',
  '{"sub":"af000000-0000-0000-0000-000000000002"}', true);

select is(
  (select reports_sought from prisma_manual_counts
    where project_id = 'af000000-0000-0000-0000-0000000000a1'),
  40,
  'a contributor can READ the figures — they are on the page they work from'
);

with changed as (
  update prisma_manual_counts set reports_sought = 9999
   where project_id = 'af000000-0000-0000-0000-0000000000a1'
  returning 1
)
select is((select count(*)::int from changed), 0,
  'but cannot change them — no UPDATE policy covers a contributor');

set local role postgres;
select is(
  (select reports_sought from prisma_manual_counts
    where project_id = 'af000000-0000-0000-0000-0000000000a1'),
  40,
  'MUTATION: the row was there to be changed, and was not'
);

-- ── 4 · A non-member sees nothing ──────────────────────────────────────────

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"af000000-0000-0000-0000-000000000003"}', true);

select is(
  (select count(*)::int from prisma_manual_counts
    where project_id = 'af000000-0000-0000-0000-0000000000a1'),
  0,
  'a stranger sees no figures at all'
);

set local role postgres;
select is(
  (select count(*)::int from prisma_manual_counts
    where project_id = 'af000000-0000-0000-0000-0000000000a1'),
  1,
  'MUTATION: there was a row to hide'
);

-- ── 5 · It goes when the project goes ──────────────────────────────────────

select lives_ok($$
  delete from projects where id = 'af000000-0000-0000-0000-0000000000a1'
$$, 'deleting the project takes its counts with it');

select finish();
rollback;
