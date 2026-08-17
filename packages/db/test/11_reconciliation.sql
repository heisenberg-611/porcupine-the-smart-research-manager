-- Phase 2b — dual extraction and reconciliation.
--
-- The claim under test is the one that makes dual extraction worth doing at
-- all: a disagreement is resolved by a THIRD reader, and the record says which
-- two readings were combined and by whom. Every part of that is a trigger,
-- because a form is bypassed by an import, a bulk action or a future API and
-- all of them end in this table.

begin;
select plan(28);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev',   'Bob',   now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'carol@test.dev', 'Carol', now(), now()),
  ('55555555-5555-5555-5555-555555555555', 'erin@test.dev',  'Erin',  now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sr', 'Review', 'SYSTEMATIC_REVIEW',
   '11111111-1111-1111-1111-111111111111', now(), now()),
  -- A thesis, to prove the capability gate refuses there.
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'th', 'Thesis', 'THESIS',
   '11111111-1111-1111-1111-111111111111', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at)
select gen_random_uuid(), p.id, u.id, 'CONTRIBUTOR', now(), now(), now()
from (values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
             ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid)) p(id)
cross join (values ('11111111-1111-1111-1111-111111111111'::uuid),
                   ('22222222-2222-2222-2222-222222222222'::uuid),
                   ('33333333-3333-3333-3333-333333333333'::uuid),
                   ('55555555-5555-5555-5555-555555555555'::uuid)) u(id);

insert into works (id, title_norm, title, authors, published_year, updated_at) values
  ('c0000000-0000-0000-0000-000000000001', 'paper one', 'Paper One', '[]'::jsonb, 2020, now()),
  -- A second paper, so "a source from a different paper" can be tested. One
  -- work cannot be added to the same project twice.
  ('c0000000-0000-0000-0000-000000000002', 'paper two', 'Paper Two', '[]'::jsonb, 2021, now());

insert into project_works
  (id, project_id, work_id, added_by, source, screen_status, created_at, updated_at) values
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'search', 'INCLUDED', now(), now()),
  ('d0000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'search', 'INCLUDED', now(), now());

insert into protocols (id, project_id, name, version, is_active, created_at, updated_at) values
  ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'PICO', 1, true, now(), now()),
  ('e0000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'PICO', 1, true, now(), now());

insert into protocol_fields
  (id, protocol_id, key, label, type, options, required, requires_anchor, "order") values
  ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'sample_size', 'Sample size', 'NUMBER', null, false, false, 0),
  ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001',
   'design', 'Design', 'ENUM', '["RCT","cohort"]'::jsonb, false, false, 1),
  ('f0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001',
   'blinded', 'Blinded', 'BOOLEAN', null, false, false, 2);

-- Alice and Bob extract the same paper independently.
insert into extractions
  (id, project_id, project_work_id, protocol_id, extractor_id, status,
   reconciled_from, created_at, updated_at) values
  ('a0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'DRAFT', '{}',
   now() - interval '2 hours', now()),
  ('a0000000-0000-0000-0000-00000000000b', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'DRAFT', '{}',
   now() - interval '1 hour', now());

-- They agree on the sample size (written differently), disagree on design,
-- and Bob left `blinded` unanswered.
insert into extraction_values
  (id, project_id, extraction_id, field_id, value, value_text, created_at, updated_at) values
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-00000000000a',
   'f0000000-0000-0000-0000-000000000001', '412'::jsonb, '412', now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-00000000000b',
   'f0000000-0000-0000-0000-000000000001', '"412.0"'::jsonb, '412.0', now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-00000000000a',
   'f0000000-0000-0000-0000-000000000002', '"RCT"'::jsonb, 'RCT', now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-00000000000b',
   'f0000000-0000-0000-0000-000000000002', '"cohort"'::jsonb, 'cohort', now(), now()),
  (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a0000000-0000-0000-0000-00000000000a',
   'f0000000-0000-0000-0000-000000000003', 'true'::jsonb, 'true', now(), now());

-- Submitted only now: a submitted extraction is frozen, so its values have to
-- exist first. The week-1 trigger caught this fixture writing them the other
-- way round.
update extractions set status = 'SUBMITTED', submitted_at = now()
where id in ('a0000000-0000-0000-0000-00000000000a',
             'a0000000-0000-0000-0000-00000000000b');

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);

-- ═══════════ The pair, and where it disagrees ═══════════════════════════════

select is(
  (select count(*)::int from v_dual_extraction_pairs
    where project_work_id = 'd0000000-0000-0000-0000-000000000001'),
  1,
  'two independent readings of one paper form exactly one pair');

select is(
  (select agreements from v_reconciliation_queue
    where project_work_id = 'd0000000-0000-0000-0000-000000000001'),
  1,
  '412 and "412.0" agree — a NUMBER is compared as a number');

select is(
  (select disagreements from v_reconciliation_queue
    where project_work_id = 'd0000000-0000-0000-0000-000000000001'),
  2,
  'RCT vs cohort, and a field only one of them answered');

select is(
  (select field_total from v_reconciliation_queue
    where project_work_id = 'd0000000-0000-0000-0000-000000000001'),
  3,
  'counted against every field in the protocol');

select is(
  (select reconciled from v_reconciliation_queue
    where project_work_id = 'd0000000-0000-0000-0000-000000000001'),
  false,
  'and nothing has been reconciled yet');

-- A field neither of them answered is not a conflict: there is nothing to
-- adjudicate, and a queue that says otherwise sends people to look at nothing.
set local role postgres;
insert into protocol_fields
  (id, protocol_id, key, label, type, required, requires_anchor, "order")
values ('f0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001',
        'funding', 'Funding', 'TEXT', false, false, 3);
set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);

select is(
  (select disagreements from v_reconciliation_queue
    where project_work_id = 'd0000000-0000-0000-0000-000000000001'),
  2,
  'a field NEITHER extractor answered is not a disagreement');

-- ═══════════ A reconciliation must name what it reconciled ══════════════════

select throws_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'RECONCILED',
            '{}', '33333333-3333-3333-3333-333333333333', now(), now())$$,
  '23514', null,
  'RECONCILED with no sources is refused');

select throws_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'RECONCILED',
            array['a0000000-0000-0000-0000-00000000000a']::uuid[],
            '33333333-3333-3333-3333-333333333333', now(), now())$$,
  '23514', null,
  'and so is one source — a reconciliation combines two readings');

select throws_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'RECONCILED',
            array['a0000000-0000-0000-0000-00000000000a',
                  'a0000000-0000-0000-0000-00000000000b']::uuid[],
            null, now(), now())$$,
  '23514', null,
  'a reconciliation with no named verifier is refused');

-- ═══════════ The rule that carries the method ═══════════════════════════════
--
-- If either of the two extractors can sign off their own disagreement, dual
-- extraction measures nothing.

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

select throws_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'RECONCILED',
            array['a0000000-0000-0000-0000-00000000000a',
                  'a0000000-0000-0000-0000-00000000000b']::uuid[],
            '11111111-1111-1111-1111-111111111111', now(), now())$$,
  '23514', null,
  'one of the two extractors cannot reconcile their own disagreement');

-- Note from the sabotage pass: with the independence rule disabled, the
-- assertion above STILL passes — Alice has her own extraction of this paper,
-- so the "your own extraction" rule catches her first. The assertion below is
-- the one that isolates independence, because Carol has no extraction here.

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);

-- Carol creating the row but naming Alice as verifier is the same evasion
-- wearing a different hat.
select throws_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'RECONCILED',
            array['a0000000-0000-0000-0000-00000000000a',
                  'a0000000-0000-0000-0000-00000000000b']::uuid[],
            '11111111-1111-1111-1111-111111111111', now(), now())$$,
  '23514', null,
  'nor can they be named as the verifier by somebody else');

-- ═══════════ Sources must belong to the same paper, and be real readings ════

set local role postgres;
insert into project_works
  (id, project_id, work_id, added_by, source, screen_status, created_at, updated_at)
values ('d0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        'search', 'INCLUDED', now(), now());
insert into extractions
  (id, project_id, project_work_id, protocol_id, extractor_id, status,
   reconciled_from, created_at, updated_at)
values ('a0000000-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'd0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'SUBMITTED', '{}', now(), now()),
       ('a0000000-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'd0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
        '55555555-5555-5555-5555-555555555555', 'DRAFT', '{}', now(), now());
set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);

select throws_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'RECONCILED',
            array['a0000000-0000-0000-0000-00000000000a',
                  'a0000000-0000-0000-0000-00000000000c']::uuid[],
            '33333333-3333-3333-3333-333333333333', now(), now())$$,
  '23514', null,
  'a source from a different paper is refused');

select throws_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'RECONCILED',
            array['a0000000-0000-0000-0000-00000000000a',
                  'a0000000-0000-0000-0000-00000000000d']::uuid[],
            '33333333-3333-3333-3333-333333333333', now(), now())$$,
  '23514', null,
  'a DRAFT cannot be reconciled — it is working state, not a reading');

-- ═══════════ A verifier who has read the paper themselves ═══════════════════
--
-- Erin has her own draft of this paper. `extractions` is unique on
-- (paper, protocol, extractor), and a reconciliation is a row authored by the
-- verifier, so she collides with herself. The constraint is right — somebody
-- who has extracted the paper is a third READER, not a neutral adjudicator —
-- but a raw 23505 naming a unique index is not an explanation.

select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555"}', true);

select throws_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '55555555-5555-5555-5555-555555555555', 'RECONCILED',
            array['a0000000-0000-0000-0000-00000000000a',
                  'a0000000-0000-0000-0000-00000000000b']::uuid[],
            '55555555-5555-5555-5555-555555555555', now(), now())$$,
  '23514', null,
  'a verifier with their own extraction of the paper is refused');

select throws_like(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '55555555-5555-5555-5555-555555555555', 'RECONCILED',
            array['a0000000-0000-0000-0000-00000000000a',
                  'a0000000-0000-0000-0000-00000000000b']::uuid[],
            '55555555-5555-5555-5555-555555555555', now(), now())$$,
  '%your own extraction of this paper%',
  'and told why, in words, rather than by a unique index name');

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);

-- ═══════════ Dual extraction is review-only ═════════════════════════════════

set local role postgres;
insert into extractions
  (id, project_id, project_work_id, protocol_id, extractor_id, status,
   reconciled_from, created_at, updated_at)
values ('a0000000-0000-0000-0000-00000000000e', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'd0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'SUBMITTED', '{}', now(), now()),
       ('a0000000-0000-0000-0000-00000000000f', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'd0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222', 'SUBMITTED', '{}', now(), now());
set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);

select throws_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values (gen_random_uuid(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            'd0000000-0000-0000-0000-000000000002',
            'e0000000-0000-0000-0000-000000000002',
            '33333333-3333-3333-3333-333333333333', 'RECONCILED',
            array['a0000000-0000-0000-0000-00000000000e',
                  'a0000000-0000-0000-0000-00000000000f']::uuid[],
            '33333333-3333-3333-3333-333333333333', now(), now())$$,
  '23514', null,
  'a THESIS project cannot record a reconciliation — capabilities parity');

-- ═══════════ And the one that must be allowed ═══════════════════════════════

select lives_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000099',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'RECONCILED',
            array['a0000000-0000-0000-0000-00000000000a',
                  'a0000000-0000-0000-0000-00000000000b']::uuid[],
            '33333333-3333-3333-3333-333333333333', now(), now())$$,
  'a third reader reconciles the two readings');

select is(
  (select reconciled from v_reconciliation_queue
    where project_work_id = 'd0000000-0000-0000-0000-000000000001'),
  true,
  'and the queue now shows the paper as resolved');

-- The reconciliation must not become a candidate for reconciliation.
select is(
  (select count(*)::int from v_dual_extraction_pairs
    where project_work_id = 'd0000000-0000-0000-0000-000000000001'),
  1,
  'the reconciled row is not itself pooled as an independent reading');

-- ═══════════ The real flow: draft, fill, finalise ═══════════════════════════
--
-- The week-1 freeze trigger refuses value writes to anything that is not a
-- DRAFT, so a reconciliation cannot be created as RECONCILED and then filled
-- in. It is built as a draft carrying reconciled_from, and finalised. The
-- action in the web app does exactly this, and it is asserted here because it
-- is the path every real reconciliation takes.

set local role postgres;
delete from extractions where id = 'a0000000-0000-0000-0000-000000000099';
set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);

select lives_ok(
  $$insert into extractions
      (id, project_id, project_work_id, protocol_id, extractor_id, status,
       reconciled_from, verified_by, created_at, updated_at)
    values ('a0000000-0000-0000-0000-000000000098',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            'e0000000-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'DRAFT',
            array['a0000000-0000-0000-0000-00000000000a',
                  'a0000000-0000-0000-0000-00000000000b']::uuid[],
            '33333333-3333-3333-3333-333333333333', now(), now())$$,
  'a reconciliation begins as a draft that names its two sources');

select lives_ok(
  $$insert into extraction_values
      (id, project_id, extraction_id, field_id, value, value_text, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'a0000000-0000-0000-0000-000000000098',
            'f0000000-0000-0000-0000-000000000002',
            '"RCT"'::jsonb, 'RCT', now(), now())$$,
  'and can be filled in while it is still a draft');

select lives_ok(
  $$update extractions set status = 'RECONCILED', submitted_at = now()
    where id = 'a0000000-0000-0000-0000-000000000098'$$,
  'then finalised, with every provenance rule re-checked');

-- ═══════════ RLS ════════════════════════════════════════════════════════════

set local role postgres;
insert into users (id, email, display_name, created_at, updated_at)
values ('44444444-4444-4444-4444-444444444444', 'dave@test.dev', 'Dave', now(), now());
set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444"}', true);

select is(
  (select count(*)::int from v_reconciliation_queue
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'a non-member sees no reconciliation queue (fail closed)');

select is(
  (select count(*)::int from v_extraction_disagreements
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'nor any disagreements');

select is(
  (select count(*)::int from v_dual_extraction_pairs
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'nor which pairs exist');

-- MUTATION CHECKS. Every zero above would pass against an empty database.
set local role postgres;

select is(
  (select count(*)::int from v_reconciliation_queue
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'MUTATION: the queue has a row to hide — the zero above was RLS');

select is(
  (select count(*)::int from v_extraction_disagreements
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  4,
  'MUTATION: there are four field comparisons to hide');

select is(
  (select count(*)::int from v_dual_extraction_pairs
    where project_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'MUTATION: there is a pair to hide');

select * from finish();
rollback;
