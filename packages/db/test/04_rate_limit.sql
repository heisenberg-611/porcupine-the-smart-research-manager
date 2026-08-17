-- R-22 — the token bucket's arithmetic.
--
-- The concurrency half (does `for update` actually serialize competing
-- Lambda invocations?) cannot be tested from one session and lives in
-- scripts/pgtap.mjs alongside the RLS concurrency test.
--
-- What is testable here is the arithmetic, which is where a token bucket
-- usually goes wrong: refilling from the wrong clock, refilling past
-- capacity, or granting on an empty bucket.

begin;
select plan(10);

set local role postgres;

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

-- ── Basic take/exhaust ──────────────────────────────────────────────────────

select is(
  public.rate_limit_take('test:basic', 2, 1),
  0::double precision,
  'first take on a fresh bucket is granted'
);

-- ── The table is unreachable directly ───────────────────────────────────────
-- Asserted only now that a bucket exists. Run before the first take it would
-- have been comparing an empty table against zero and passing whatever the
-- policy said — the vacuous-negative trap that 03_mutation_checks.sql exists
-- to catch. The row is confirmed to exist from the owner's side first.

select is(
  (select count(*) from public.rate_limit_buckets where key = 'test:basic')::int,
  0,
  'the bucket table is not readable directly, even with a claim'
);

set local role postgres;
select is(
  (select count(*) from public.rate_limit_buckets where key = 'test:basic')::int,
  1,
  'and the row it cannot see does exist'
);
set local role Porcupine_app;

select is(
  public.rate_limit_take('test:basic', 2, 1),
  0::double precision,
  'second take drains the last token and is granted'
);

select cmp_ok(
  public.rate_limit_take('test:basic', 2, 1),
  '>', 0::double precision,
  'third take is refused and returns a positive wait'
);

-- arXiv's actual limit: 1 request per 3 seconds. An exhausted bucket should
-- ask for roughly 3 seconds, not 0.3 or 30.
select is(
  public.rate_limit_take('test:arxiv', 1, 1.0 / 3.0),
  0::double precision,
  'arxiv bucket grants its single token'
);

select cmp_ok(
  public.rate_limit_take('test:arxiv', 1, 1.0 / 3.0),
  '>', 2.5::double precision,
  'and then asks the caller to wait about 3 seconds'
);

select cmp_ok(
  public.rate_limit_take('test:arxiv', 1, 1.0 / 3.0),
  '<', 3.5::double precision,
  'about 3 seconds, not 30 — the refill rate is not inverted'
);

-- ── Refill is clamped at capacity ───────────────────────────────────────────
-- A bucket idle for a week must not accumulate a week of tokens and then
-- allow a burst that ignores the rate limit entirely.

set local role postgres;
update rate_limit_buckets
   set updated_at = now() - interval '7 days'
 where key = 'test:basic';
set local role Porcupine_app;

select is(
  public.rate_limit_take('test:basic', 2, 1),
  0::double precision,
  'a long-idle bucket grants again'
);

-- Capacity is 2 and one was just taken, so at most one remains. If refill
-- were unclamped there would be 604800 of them. Read as the owner, since the
-- deny-all policy is doing its job.
set local role postgres;
select cmp_ok(
  (select tokens from public.rate_limit_buckets where key = 'test:basic'),
  '<=', 1.0::double precision,
  'refill is clamped to capacity — an idle bucket cannot burst'
);

select * from finish();
rollback;
