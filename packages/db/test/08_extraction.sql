-- Phase 2 — extraction integrity.
--
-- The phase's exit criterion is "inconsistent evidence tables become
-- structurally impossible". Structurally means the database refuses, not that
-- the form is careful — so the two rules that carry that claim are asserted
-- here, and each is checked from the side that would break it.

begin;
select plan(20);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev',   'Bob',   now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'carol@test.dev', 'Carol', now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sr', 'Review', 'SYSTEMATIC_REVIEW',
   '11111111-1111-1111-1111-111111111111', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'OWNER', now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', 'CONTRIBUTOR', now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '33333333-3333-3333-3333-333333333333', 'CONTRIBUTOR', now(), now(), now());

insert into works (id, title_norm, title, authors, published_year, updated_at) values
  ('c0000000-0000-0000-0000-000000000001', 'paper one', 'Paper One', '[]'::jsonb, 2020, now());

insert into project_works
  (id, project_id, work_id, added_by, source, screen_status, created_at, updated_at) values
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'search', 'INCLUDED', now(), now());

insert into protocols (id, project_id, name, version, created_at, updated_at) values
  ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'PICO', 1, now(), now());

-- One ordinary field, one that demands provenance.
insert into protocol_fields
  (id, protocol_id, key, label, type, required, requires_anchor, "order") values
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'sample_size', 'Sample size', 'NUMBER', true, false, 0),
  ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001',
   'primary_outcome', 'Primary outcome', 'QUOTE', true, true, 1);

insert into anchors (id, project_id, quote, created_at, updated_at) values
  ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'the primary outcome was mortality at 30 days', now(), now());

set local role porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', true);

-- ═══════════ Extractions belong to their extractor ══════════════════════════

select lives_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000001',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222', 'DRAFT', '{}', now(), now())$$,
  'a contributor starts their own extraction'
);

select throws_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'DRAFT', '{}', now(), now())$$,
  '42501', null,
  'and cannot start one in someone else''s name'
);

-- ═══════════ Rule 2: provenance where the protocol demands it ═══════════════

select throws_ok(
  $$insert into extraction_values
      (id, project_id, extraction_id, field_id, value, value_text, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'a0000000-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000002',
            '"mortality at 30 days"'::jsonb, 'mortality at 30 days', now(), now())$$,
  '23514', null,
  'a field marked requiresAnchor refuses a value with no passage'
);

select lives_ok(
  $$insert into extraction_values
      (id, project_id, extraction_id, field_id, value, value_text, anchor_id,
       created_at, updated_at)
    values ('b0000000-0000-0000-0000-000000000002',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'a0000000-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000002',
            '"mortality at 30 days"'::jsonb, 'mortality at 30 days',
            '20000000-0000-0000-0000-000000000001', now(), now())$$,
  'and accepts it once the passage is attached'
);

select lives_ok(
  $$insert into extraction_values
      (id, project_id, extraction_id, field_id, value, value_text, created_at, updated_at)
    values ('b0000000-0000-0000-0000-000000000001',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'a0000000-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000001',
            '412'::jsonb, '412', now(), now())$$,
  'a field that does not require an anchor is unaffected'
);

-- ═══════════ Rule 1: a submitted extraction is frozen ═══════════════════════

select lives_ok(
  $$update extractions set status = 'SUBMITTED', submitted_at = now()
    where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'the extractor submits'
);

select throws_ok(
  $$update extraction_values set value = '999'::jsonb, value_text = '999'
    where id = 'b0000000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'a submitted extraction refuses an edited value'
);

select throws_ok(
  $$insert into extraction_values
      (id, project_id, extraction_id, field_id, value, value_text, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'a0000000-0000-0000-0000-000000000001',
            'f0000000-0000-0000-0000-000000000001',
            '1'::jsonb, '1', now(), now())$$,
  '23514', null,
  'and refuses a new value added after the fact'
);

select throws_ok(
  $$delete from extraction_values where id = 'b0000000-0000-0000-0000-000000000001'$$,
  '23514', null,
  'and refuses a value being deleted out of it'
);

-- The value is genuinely unchanged, not merely un-updated.
select is(
  (select value_text from extraction_values
    where id = 'b0000000-0000-0000-0000-000000000001'),
  '412',
  'the recorded value still says what it said'
);

-- Reopening is deliberate, not forbidden.
select lives_ok(
  $$update extractions set status = 'DRAFT'
    where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'the extractor may reopen it as a draft'
);

select lives_ok(
  $$update extraction_values set value = '999'::jsonb, value_text = '999'
    where id = 'b0000000-0000-0000-0000-000000000001'$$,
  'and then edit it again'
);

-- ═══════════ Nobody edits somebody else's extraction ════════════════════════
-- Not even an owner. Dual extraction measures agreement between two people,
-- and that measurement is meaningless if a third can quietly edit either side.

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

with attempted as (
  update extractions set status = 'VERIFIED'
  where id = 'a0000000-0000-0000-0000-000000000001'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'an OWNER cannot change another person''s extraction');

with attempted as (
  update extraction_values set value_text = 'owner says otherwise'
  where id = 'b0000000-0000-0000-0000-000000000001'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'nor its values');

select is(
  (select value_text from extraction_values
    where id = 'b0000000-0000-0000-0000-000000000001'),
  '999',
  'and the value is untouched');

-- But they can read it: an extraction nobody can review is not a finding.
select is((select count(*)::int from extractions), 1,
  'an owner reads every extraction in the project');

-- ═══════════ Protocols are admin-owned ══════════════════════════════════════

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', true);

with attempted as (
  update protocols set name = 'Renamed by a contributor'
  where id = 'e0000000-0000-0000-0000-000000000001'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'a CONTRIBUTOR cannot rewrite the protocol mid-review');

-- ═══════════ The evidence table shows holes ═════════════════════════════════
-- Two fields exist and two are answered, so the row count equals the field
-- count. The LEFT JOIN matters when one is unanswered — asserted next.

select is(
  (select count(*)::int from v_evidence_table
    where extraction_id = 'a0000000-0000-0000-0000-000000000001'),
  2,
  'the evidence table has one row per protocol field');

set local role postgres;
delete from extraction_values where id = 'b0000000-0000-0000-0000-000000000002';
set local role porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', true);

select is(
  (select count(*)::int from v_evidence_table
    where extraction_id = 'a0000000-0000-0000-0000-000000000001'),
  2,
  'an unanswered field still appears — a hole, not a missing row');

select is(
  (select count(*)::int from v_evidence_table
    where extraction_id = 'a0000000-0000-0000-0000-000000000001'
      and value is null),
  1,
  'and it is visibly empty rather than silently absent');

select * from finish();
rollback;
