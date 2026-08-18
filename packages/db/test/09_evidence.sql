-- Phase 2 week 4 — the evidence table.
--
-- `08-phase-2-build-plan.md` 4.1–4.6. The claims under test are that filter,
-- sort, group and paging happen in the DATABASE and are therefore correct
-- across the whole result rather than across whichever page arrived first,
-- and that a hole stays visibly a hole.
--
-- The sort fixture is chosen so a lexical sort cannot accidentally pass. The
-- sample sizes are 3, 9, 25, 100:
--
--   numeric asc  → 3, 9, 25, 100      (Delta, Alpha, Gamma, Beta)
--   lexical asc  → '100','25','3','9' (Beta, Gamma, Delta, Alpha)
--
-- and neither is the reverse of the other, so a direction bug cannot pass as a
-- type bug. Epsilon's sample size is the string 'not reported', which is what
-- a real extraction looks like and what an unguarded ::numeric would abort the
-- entire query on.

begin;
select plan(34);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev',   'Bob',   now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'dave@test.dev',  'Dave',  now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sr', 'Review', 'SYSTEMATIC_REVIEW',
   '11111111-1111-1111-1111-111111111111', now(), now());

-- Dave is deliberately NOT a member.
insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'OWNER', now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', 'CONTRIBUTOR', now(), now(), now());

insert into works (id, title_norm, title, authors, published_year, updated_at) values
  ('c0000000-0000-0000-0000-000000000001', 'alpha',   'Alpha',   '[]'::jsonb, 2021, now()),
  ('c0000000-0000-0000-0000-000000000002', 'beta',    'Beta',    '[]'::jsonb, 2019, now()),
  ('c0000000-0000-0000-0000-000000000003', 'gamma',   'Gamma',   '[]'::jsonb, 2020, now()),
  ('c0000000-0000-0000-0000-000000000004', 'delta',   'Delta',   '[]'::jsonb, 2022, now()),
  ('c0000000-0000-0000-0000-000000000005', 'epsilon', 'Epsilon', '[]'::jsonb, 2018, now()),
  ('c0000000-0000-0000-0000-000000000006', 'zeta',    'Zeta',    '[]'::jsonb, 2017, now());

-- Zeta is EXCLUDED and never extracted from. It exists to prove the coverage
-- denominator counts INCLUDED papers rather than everything imported.
-- The exclude_reason is not decoration: this is a SYSTEMATIC_REVIEW, and the
-- week-2 trigger refuses an EXCLUDED row without one. It caught this fixture.
insert into project_works
  (id, project_id, work_id, added_by, source, screen_status, exclude_reason,
   created_at, updated_at)
select
  ('d0000000-0000-0000-0000-00000000000' || n)::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  ('c0000000-0000-0000-0000-00000000000' || n)::uuid,
  '11111111-1111-1111-1111-111111111111',
  'search',
  case when n = 6 then 'EXCLUDED' else 'INCLUDED' end::"ScreenStatus",
  case when n = 6 then 'WRONG_POPULATION' end,
  now(), now()
from generate_series(1, 6) as n;

insert into questions (id, project_id, "order", text, keywords, created_at, updated_at) values
  ('11110000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   0, 'How large were the studies?', '{}', now(), now()),
  ('11110000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   1, 'What designs were used?', '{}', now(), now()),
  ('11110000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   2, 'Were outcomes assessed blind?', '{}', now(), now()),
  ('11110000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   3, 'Was ethical approval obtained?', '{}', now(), now());

insert into protocols (id, project_id, name, version, created_at, updated_at) values
  ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'PICO', 1, now(), now()),
  ('e0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'PICO', 2, now(), now());

insert into protocol_fields
  (id, protocol_id, key, label, type, options, required, requires_anchor,
   "order", question_id) values
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'sample_size', 'Sample size', 'NUMBER', null, true, false, 0,
   '11110000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001',
   'design', 'Design', 'ENUM', '["RCT","cohort"]'::jsonb, false, false, 1,
   '11110000-0000-0000-0000-000000000002'),
  ('f0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001',
   'outcome', 'Primary outcome', 'QUOTE', null, false, true, 2, null),
  ('f0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001',
   'funding', 'Funding', 'TEXT', null, false, false, 3, null),
  ('f0000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000001',
   'blinding', 'Blinding', 'TEXT', null, false, false, 4,
   '11110000-0000-0000-0000-000000000003'),
  -- Lives in protocol v2, which nobody has extracted against: a question added
  -- in a revision is the realistic way a question ends up with no evidence.
  ('f0000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000002',
   'ethics', 'Ethical approval', 'TEXT', null, false, false, 0,
   '11110000-0000-0000-0000-000000000004');

insert into anchors (id, project_id, quote, created_at, updated_at) values
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'mortality at 30 days', now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'all-cause mortality', now(), now());

insert into extractions
  (id, project_id, project_work_id, protocol_id, extractor_id, status,
   reconciled_from, created_at, updated_at)
select
  ('a0000000-0000-0000-0000-00000000000' || n)::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  ('d0000000-0000-0000-0000-00000000000' || n)::uuid,
  'e0000000-0000-0000-0000-000000000001',
  '22222222-2222-2222-2222-222222222222',
  'DRAFT', '{}', now(), now()
from generate_series(1, 5) as n;

insert into extraction_values
  (id, project_id, extraction_id, field_id, value, value_text, anchor_id,
   created_at, updated_at) values
  -- sample_size, answered everywhere. Epsilon's is prose, not a number.
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', '9'::jsonb, '9', null, now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-000000000001', '100'::jsonb, '100', null, now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000003',
   'f0000000-0000-0000-0000-000000000001', '25'::jsonb, '25', null, now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000004',
   'f0000000-0000-0000-0000-000000000001', '3'::jsonb, '3', null, now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000005',
   'f0000000-0000-0000-0000-000000000001', '"not reported"'::jsonb, 'not reported', null, now(), now()),

  -- design: Alpha, Beta, Epsilon
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000002', '"RCT"'::jsonb, 'RCT', null, now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-000000000002', '"cohort"'::jsonb, 'cohort', null, now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000005',
   'f0000000-0000-0000-0000-000000000002', '"RCT"'::jsonb, 'RCT', null, now(), now()),

  -- outcome, which demands provenance: Alpha and Epsilon
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000003', '"mortality at 30 days"'::jsonb,
   'mortality at 30 days', '20000000-0000-0000-0000-000000000001', now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000005',
   'f0000000-0000-0000-0000-000000000003', '"all-cause mortality"'::jsonb,
   'all-cause mortality', '20000000-0000-0000-0000-000000000002', now(), now()),

  -- funding and blinding: Epsilon only, which makes it the one complete row
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000005',
   'f0000000-0000-0000-0000-000000000004', '"NIH"'::jsonb, 'NIH', null, now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-000000000005',
   'f0000000-0000-0000-0000-000000000005', '"double"'::jsonb, 'double', null, now(), now());

-- Out of DRAFT, now that the values are in.
--
-- `evidence_rows` and `v_question_coverage` gained `status <> 'DRAFT'` in
-- 20260816211000, and that is right — an evidence table that shows half-typed
-- drafts is not a table anyone can act on. This file was not updated with it,
-- so all five fixtures stayed DRAFT, the function returned nothing, and 26 of
-- the 34 assertions below failed. Including the mutation check, which is the
-- one that says the zero was not RLS doing its job.
--
-- It has to be an UPDATE rather than 'SUBMITTED' in the INSERT above:
-- `freeze_submitted_extraction_values` refuses to let a value be written into
-- an extraction that is already submitted, which is the same order a person
-- goes in — fill it in, then submit.
update extractions
   set status = 'SUBMITTED'
 where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', true);

-- ═══════════ 4.2 · Sorting happens in the database, and by type ═════════════

select is(
  (select array_agg(t.work_title order by t.ordinality)
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'field:sample_size', 'asc') with ordinality t),
  array['Delta', 'Alpha', 'Gamma', 'Beta', 'Epsilon']::text[],
  'a NUMBER column sorts numerically: 3, 9, 25, 100 — not 100, 25, 3, 9'
);

select is(
  (select array_agg(t.work_title order by t.ordinality)
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'field:sample_size', 'desc') with ordinality t),
  array['Beta', 'Gamma', 'Alpha', 'Delta', 'Epsilon'],
  'and descending reverses the numbers while unanswered still sorts last'
);

-- Epsilon carries 'not reported' in a NUMBER column. The assertions above
-- returning anything at all is the real proof: an unguarded ::numeric would
-- have aborted the whole query rather than sorting that one row last.
select is(
  (select t.work_title
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'field:sample_size', 'asc') with ordinality t
    where t.ordinality = 5),
  'Epsilon',
  'a non-numeric answer in a NUMBER column sorts last instead of failing the query'
);

select is(
  (select array_agg(t.work_title order by t.ordinality)
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'title', 'asc') with ordinality t),
  array['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma'],
  'sorting by title is alphabetical'
);

select is(
  (select array_agg(t.published_year order by t.ordinality)
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'year', 'asc') with ordinality t),
  array[2018, 2019, 2020, 2021, 2022],
  'sorting by year is chronological'
);

select is(
  (select array_agg(t.work_title order by t.ordinality)
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'field:design', 'asc') with ordinality t
    where t.ordinality <= 2),
  array['Beta', 'Alpha'],
  'a text column sorts case-insensitively: cohort before RCT, not RCT before cohort'
);

-- ═══════════ 4.2 · Filtering ════════════════════════════════════════════════

select is(
  (select count(*)::int
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'title', 'asc', 'design', 'rct')),
  2,
  'filtering a column matches case-insensitively'
);

select is(
  (select array_agg(t.work_title order by t.work_title)
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'title', 'asc', 'design', 'rct') t),
  array['Alpha', 'Epsilon']::text[],
  'and matches the right rows'
);

select is(
  (select count(*)::int
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'title', 'asc', 'design', '')),
  5,
  'an empty filter is no filter, not a filter matching nothing'
);

-- ═══════════ 4.2 · Grouping ═════════════════════════════════════════════════

select is(
  (select t.group_label
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'title', 'asc', null, null, 'design') t
    where t.work_title = 'Beta'),
  'cohort',
  'grouping labels each row by the grouped field'
);

select is(
  (select t.group_label
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'title', 'asc', null, null, 'design') t
    where t.work_title = 'Gamma'),
  null,
  'a row with no answer in the grouped field is NULL, not an empty group name'
);

-- ═══════════ 4.5 · Holes stay holes ═════════════════════════════════════════

select is(
  (select count(*)::int
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'title', 'asc', null, null, null, true)),
  4,
  'only-incomplete hides the one fully answered paper'
);

-- bool_or over four rows that all fail the test is FALSE, not NULL. Asserting
-- NULL here passed nothing and failed loudly, which is the point of running it.
select is(
  (select bool_or(t.work_title = 'Epsilon')
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'title', 'asc', null, null, null, true) t),
  false,
  'and the complete paper is the one it hides'
);

select is(
  (select t.answered
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001') t
    where t.work_title = 'Alpha'),
  3,
  'the answered count counts answers, not fields'
);

select is(
  (select t.field_total
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001') t
    where t.work_title = 'Alpha'),
  5,
  'and the total counts every field in the protocol'
);

select is(
  (select jsonb_array_length(jsonb_path_query_array(t.cells, '$.keyvalue()'))
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001') t
    where t.work_title = 'Gamma'),
  5,
  'an almost-empty extraction still carries a cell for every field'
);

select is(
  (select (t.cells -> 'funding' ->> 'answered')::boolean
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001') t
    where t.work_title = 'Gamma'),
  false,
  'an unanswered cell says so explicitly rather than leaving the UI to guess'
);

select is(
  (select (t.cells -> 'sample_size' ->> 'answered')::boolean
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001') t
    where t.work_title = 'Gamma'),
  true,
  'and an answered one says that'
);

-- ═══════════ 4.4 · Cells are keyed by the immutable key ═════════════════════

select is(
  (select t.cells ? 'sample_size'
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001') t
    where t.work_title = 'Alpha'),
  true,
  'cells are keyed by field key — the immutable name an export can rely on'
);

select is(
  (select t.cells ? 'Sample size'
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001') t
    where t.work_title = 'Alpha'),
  false,
  'and not by the mutable label'
);

-- ═══════════ 4.3 · Cell → source ════════════════════════════════════════════

select is(
  (select t.cells -> 'outcome' ->> 'anchorId'
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001') t
    where t.work_title = 'Alpha'),
  '20000000-0000-0000-0000-000000000001',
  'a quoted cell carries its anchor, so the table can open the passage'
);

select is(
  (select t.cells -> 'sample_size' ->> 'anchorId'
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001') t
    where t.work_title = 'Alpha'),
  null,
  'and a cell with no passage carries none'
);

-- ═══════════ 4.1 · Paging is stable and self-describing ═════════════════════

select is(
  (select count(*)::int
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'title', 'asc', null, null, null, false, 2, 0)),
  2,
  'a page is the size it was asked for'
);

select is(
  (select distinct t.total_rows
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001',
                        'title', 'asc', null, null, null, false, 2, 0) t),
  5::bigint,
  'and reports the full count, so paging needs no second query that could disagree'
);

-- Two pages of two, no row seen twice or skipped. Without the total tiebreak
-- in the ORDER BY this is exactly what would rot, and silently.
select is(
  (select count(distinct title)::int from (
     select t.work_title as title
       from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                          'e0000000-0000-0000-0000-000000000001',
                          'field:design', 'asc', null, null, null, false, 2, 0) t
     union all
     select t.work_title
       from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                          'e0000000-0000-0000-0000-000000000001',
                          'field:design', 'asc', null, null, null, false, 2, 2) t
   ) both_pages),
  4,
  'consecutive pages do not repeat a row, even sorted on a column full of ties'
);

-- ═══════════ 4.6 · Coverage per research question ═══════════════════════════

select is(
  (select papers_answered from v_question_coverage
    where question_id = '11110000-0000-0000-0000-000000000001'),
  5,
  'a question every paper answers reports every paper'
);

select is(
  (select papers_answered from v_question_coverage
    where question_id = '11110000-0000-0000-0000-000000000002'),
  3,
  'a partly answered question reports only the papers that answered it'
);

-- The finding the whole view exists for.
select is(
  (select papers_answered from v_question_coverage
    where question_id = '11110000-0000-0000-0000-000000000004'),
  0,
  'a question with a field but no evidence reports zero — the review would answer it with nothing'
);

select is(
  (select field_count from v_question_coverage
    where question_id = '11110000-0000-0000-0000-000000000004'),
  1,
  'and it is visibly a question someone meant to answer, not one with no field at all'
);

select is(
  (select distinct included_papers from v_question_coverage
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  5,
  'the denominator is included papers — the EXCLUDED one is not a coverage gap'
);

-- ═══════════ RLS: both of these are tenant data ═════════════════════════════

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);

select is(
  (select count(*)::int
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001')),
  0,
  'a non-member calling the function directly gets nothing (fail closed)'
);

select is(
  (select count(*)::int from v_question_coverage
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'nor any coverage figures'
);

-- MUTATION CHECKS. Both zeros above would pass against an empty database, so
-- prove there was something there to hide.
set local role postgres;

select is(
  (select count(*)::int
     from evidence_rows('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        'e0000000-0000-0000-0000-000000000001')),
  5,
  'MUTATION: the evidence table has 5 rows to hide — the zero above was RLS'
);

select is(
  (select count(*)::int from v_question_coverage
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  4,
  'MUTATION: coverage has 4 questions to hide'
);

select * from finish();
rollback;
