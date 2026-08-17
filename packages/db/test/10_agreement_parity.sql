-- Agreement parity between SQL and TypeScript.
--
-- `valuesAgree` in packages/shared/src/agreement.ts is the readable authority
-- and runs on one paper at a time in the reconciliation screen.
-- `public.values_agree` is the one that runs over a whole review at once, so
-- the queue can count disagreements across 300 papers without shipping 12,000
-- rows to the browser.
--
-- The cases below are the same ones asserted in
-- packages/shared/test/agreement.test.ts. If someone changes one
-- implementation, this file fails and points at the other.
--
-- Divergence here is worse than the title-normalization case in 05: that one
-- costs a duplicate row, this one puts a different number of disagreements on
-- the queue screen than the reconciliation screen shows when you open it —
-- a queue saying "3 disagreements" that opens onto 2 is a bug people report
-- as "the app is wrong" without ever being able to say how.

begin;
select plan(18);

set local role postgres;
insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now());
set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

-- ── NUMBER is compared numerically ──────────────────────────────────────────

select ok(public.values_agree('NUMBER', '12'::jsonb, '12.0'::jsonb),
  '12 and 12.0 are the same answer');

select ok(public.values_agree('NUMBER', '12'::jsonb, '"12"'::jsonb),
  'a number and its string form are the same answer');

select ok(not public.values_agree('NUMBER', '12'::jsonb, '13'::jsonb),
  'and 12 is not 13');

select ok(public.values_agree('NUMBER', '"not reported"'::jsonb, '"Not Reported"'::jsonb),
  'a NUMBER field holding prose falls back to text comparison');

select ok(not public.values_agree('NUMBER', '"not reported"'::jsonb, '"unclear"'::jsonb),
  'and different prose still disagrees');

-- ── Case and whitespace are not disagreements ───────────────────────────────

select ok(public.values_agree('ENUM', '"RCT"'::jsonb, '"rct "'::jsonb),
  'case and trailing space are not a disagreement');

select ok(public.values_agree('TEXT', '" Mortality "'::jsonb, '"mortality"'::jsonb),
  'nor leading space in free text');

-- ── MULTI_ENUM is a set ─────────────────────────────────────────────────────

select ok(public.values_agree('MULTI_ENUM', '["a","b"]'::jsonb, '["b","a"]'::jsonb),
  'order in a multi-select is a UI artefact, not an answer');

select ok(not public.values_agree('MULTI_ENUM', '["a","b"]'::jsonb, '["a"]'::jsonb),
  'a missing choice is a disagreement');

select ok(not public.values_agree('MULTI_ENUM', '["a"]'::jsonb, '["a","b"]'::jsonb),
  'in either direction');

-- ── BOOLEAN, however it was written down ────────────────────────────────────

select ok(public.values_agree('BOOLEAN', 'true'::jsonb, '"true"'::jsonb),
  'a boolean and its string form agree');

select ok(public.values_agree('BOOLEAN', '"yes"'::jsonb, 'true'::jsonb),
  'yes is true');

select ok(public.values_agree('BOOLEAN', '"no"'::jsonb, 'false'::jsonb),
  'no is false');

select ok(not public.values_agree('BOOLEAN', 'true'::jsonb, 'false'::jsonb),
  'true is not false');

-- ── Two holes are not an agreement ──────────────────────────────────────────
--
-- The one that would quietly inflate every score on a review in progress:
-- most fields are unanswered for most of a review's life.

select ok(not public.values_agree('TEXT', null, null),
  'two unanswered fields do not agree — there is nothing to agree about');

select ok(not public.values_agree('TEXT', 'null'::jsonb, 'null'::jsonb),
  'and a JSON null is a hole, not a value');

select ok(not public.values_agree('TEXT', null, '"something"'::jsonb),
  'one answer and one hole is not agreement either');

-- ── The normal form itself ──────────────────────────────────────────────────
--
-- Asserted directly because it is what the two implementations have to match.
-- JSON.stringify would emit ["a","b"] where jsonb::text emits ["a", "b"], so
-- the array case is where parity would have silently broken.

select is(
  public.agreement_norm('["B","a"]'::jsonb),
  'a' || chr(1) || 'b',
  'arrays normalise to sorted, lowercased parts joined with U+0001'
);

select * from finish();
rollback;
