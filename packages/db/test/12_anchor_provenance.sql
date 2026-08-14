-- A quoted answer cannot be quietly separated from its passage.
--
-- The rule has two halves and they pull in opposite directions, which is why
-- both are asserted here:
--
--   1. Deleting an anchor a live extraction cites must FAIL. Otherwise a QUOTE
--      answer — a field type that exists so an answer is traceable — becomes
--      an untraceable string, and nothing in the UI would say so.
--
--   2. Deleting the whole PROJECT must still succeed. The citing rows go in
--      the same statement, so there is nothing left to protect. A rule that
--      makes projects undeletable is not a provenance rule, it is a leak.
--
-- Half 2 is the one that fails if someone "tightens" this to `restrict`, and
-- it is the reason this file exists rather than a one-line assertion.

begin;
select plan(10);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('99990000-0000-0000-0000-000000000001', 'anchor-owner@test.dev', 'Owner', now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('99990000-0000-0000-0000-0000000000a1', 'anchor-prov', 'Anchors', 'SYSTEMATIC_REVIEW',
   '99990000-0000-0000-0000-000000000001', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('99990000-0000-0000-0000-0000000000b1', '99990000-0000-0000-0000-0000000000a1',
   '99990000-0000-0000-0000-000000000001', 'OWNER', now(), now(), now());

insert into works (id, title_norm, title, authors, updated_at) values
  ('99990000-0000-0000-0000-0000000000c1', 'anchored paper', 'Anchored Paper',
   '[]'::jsonb, now());

insert into project_works
  (id, project_id, work_id, added_by, source, screen_status, created_at, updated_at) values
  ('99990000-0000-0000-0000-0000000000d1', '99990000-0000-0000-0000-0000000000a1',
   '99990000-0000-0000-0000-0000000000c1', '99990000-0000-0000-0000-000000000001',
   'search', 'INCLUDED', now(), now());

insert into protocols (id, project_id, name, version, created_at, updated_at) values
  ('99990000-0000-0000-0000-0000000000e1', '99990000-0000-0000-0000-0000000000a1',
   'P', 1, now(), now());

-- One field that demands a passage, one that does not. The second is the
-- control: without it, a rule that refused EVERY anchor deletion would pass
-- assertion 2 while being wrong.
insert into protocol_fields
  (id, protocol_id, key, label, type, options, required, requires_anchor, "order") values
  ('99990000-0000-0000-0000-0000000000f1', '99990000-0000-0000-0000-0000000000e1',
   'outcome', 'Primary outcome', 'QUOTE', null, false, true, 0),
  ('99990000-0000-0000-0000-0000000000f2', '99990000-0000-0000-0000-0000000000e1',
   'notes', 'Notes', 'TEXT', null, false, false, 1);

insert into anchors (id, project_id, quote, status, created_at, updated_at) values
  ('99990000-0000-0000-0000-000000000101', '99990000-0000-0000-0000-0000000000a1',
   'mortality at 30 days', 'OK', now(), now()),
  -- Cited by nothing. Deleting it must still work.
  ('99990000-0000-0000-0000-000000000102', '99990000-0000-0000-0000-0000000000a1',
   'an uncited passage', 'OK', now(), now());

-- DRAFT first: the week-1 freeze trigger refuses values written against a
-- SUBMITTED extraction, and has caught three fixtures in this repo doing it.
insert into extractions
  (id, project_id, project_work_id, protocol_id, extractor_id, status,
   created_at, updated_at) values
  ('99990000-0000-0000-0000-000000000201', '99990000-0000-0000-0000-0000000000a1',
   '99990000-0000-0000-0000-0000000000d1', '99990000-0000-0000-0000-0000000000e1',
   '99990000-0000-0000-0000-000000000001', 'DRAFT', now(), now());

insert into extraction_values
  (id, project_id, extraction_id, field_id, value, value_text, anchor_id,
   created_at, updated_at) values
  ('99990000-0000-0000-0000-000000000301', '99990000-0000-0000-0000-0000000000a1',
   '99990000-0000-0000-0000-000000000201', '99990000-0000-0000-0000-0000000000f1',
   '"mortality at 30 days"'::jsonb, 'mortality at 30 days',
   '99990000-0000-0000-0000-000000000101', now(), now()),
  ('99990000-0000-0000-0000-000000000302', '99990000-0000-0000-0000-0000000000a1',
   '99990000-0000-0000-0000-000000000201', '99990000-0000-0000-0000-0000000000f2',
   '"no notes"'::jsonb, 'no notes', null, now(), now());

-- ── 1. The constraint says what we think it says ────────────────────────────

select is(
  (select confdeltype::text || case when condeferrable then ' deferrable' else ' immediate' end
     from pg_constraint
    where conname = 'extraction_values_anchor_id_fkey'
      and conrelid = 'public.extraction_values'::regclass),
  'a deferrable',
  'anchor_id is ON DELETE NO ACTION and DEFERRABLE — not SET NULL, which the '
  'trigger vetoes, and not immediate, which would make projects undeletable'
);

-- ── 2. A cited passage cannot be deleted ────────────────────────────────────
--
-- The constraint is deferred, so the violation surfaces at COMMIT rather than
-- at the delete. Making it immediate for these assertions is how the failure
-- is observed inside a suite that ends in `rollback` — otherwise the delete
-- would appear to succeed and nothing would ever check it.

set constraints extraction_values_anchor_id_fkey immediate;

select throws_ok(
  $$ delete from anchors where id = '99990000-0000-0000-0000-000000000101' $$,
  '23503',
  null,
  'deleting a passage a QUOTE answer cites is refused'
);

-- ── 3. The control: an UNCITED passage still deletes ────────────────────────
--
-- Without this, a schema that simply forbade every anchor deletion would pass
-- assertion 2 and be badly wrong.

select lives_ok(
  $$ delete from anchors where id = '99990000-0000-0000-0000-000000000102' $$,
  'an uncited passage still deletes'
);

select is(
  (select count(*)::int from anchors
    where project_id = '99990000-0000-0000-0000-0000000000a1'),
  1,
  'MUTATION: the uncited passage really went, so assertion 3 did something'
);

-- ── 4. The value kept its anchor throughout ─────────────────────────────────

select is(
  (select anchor_id from extraction_values
    where id = '99990000-0000-0000-0000-000000000301'),
  '99990000-0000-0000-0000-000000000101'::uuid,
  'the refused delete left the citation intact rather than half-applied'
);

-- ── 5. Deleting the extraction releases the passage ─────────────────────────
--
-- The escape hatch. Provenance protects a LIVE citation; once the answer is
-- gone there is nothing to protect, and a passage that could never be deleted
-- afterwards would be a leak with a justification.

select lives_ok(
  $$ delete from extractions where id = '99990000-0000-0000-0000-000000000201' $$,
  'deleting the extraction that cites it is allowed'
);

select lives_ok(
  $$ delete from anchors where id = '99990000-0000-0000-0000-000000000101' $$,
  'and the passage can then be deleted'
);

-- ── 6. A whole project still deletes in one statement ───────────────────────
--
-- THE ASSERTION THAT FAILS IF SOMEONE TIGHTENS THIS TO `restrict`.
-- Rebuild the citation first, so the delete has something to trip over.

insert into anchors (id, project_id, quote, status, created_at, updated_at) values
  ('99990000-0000-0000-0000-000000000103', '99990000-0000-0000-0000-0000000000a1',
   'a second passage', 'OK', now(), now());

insert into extractions
  (id, project_id, project_work_id, protocol_id, extractor_id, status,
   created_at, updated_at) values
  ('99990000-0000-0000-0000-000000000202', '99990000-0000-0000-0000-0000000000a1',
   '99990000-0000-0000-0000-0000000000d1', '99990000-0000-0000-0000-0000000000e1',
   '99990000-0000-0000-0000-000000000001', 'DRAFT', now(), now());

insert into extraction_values
  (id, project_id, extraction_id, field_id, value, value_text, anchor_id,
   created_at, updated_at) values
  ('99990000-0000-0000-0000-000000000303', '99990000-0000-0000-0000-0000000000a1',
   '99990000-0000-0000-0000-000000000202', '99990000-0000-0000-0000-0000000000f1',
   '"a second passage"'::jsonb, 'a second passage',
   '99990000-0000-0000-0000-000000000103', now(), now());

select is(
  (select count(*)::int from extraction_values
    where anchor_id = '99990000-0000-0000-0000-000000000103'),
  1,
  'MUTATION: the project really does hold a live citation before it is deleted'
);

-- Back to deferred, which is how the constraint actually ships. Under an
-- IMMEDIATE constraint this delete fails: the cascade can reach `anchors`
-- before it reaches the `extraction_values` rows that cite them, even though
-- both go in the same statement.
set constraints extraction_values_anchor_id_fkey deferred;

select lives_ok(
  $$ delete from projects where id = '99990000-0000-0000-0000-0000000000a1' $$,
  'a project holding a cited passage still deletes'
);

-- And the deferred check is then FORCED to run, here, rather than at a commit
-- this suite never reaches. Without this line assertion 9 passes vacuously —
-- every deferred violation in the transaction would be rolled away unchecked,
-- and the suite would report green whatever the constraint did.
select lives_ok(
  $$ set constraints extraction_values_anchor_id_fkey immediate $$,
  'and the deferred check passes: nothing is left citing a deleted passage'
);

select * from finish();
rollback;
