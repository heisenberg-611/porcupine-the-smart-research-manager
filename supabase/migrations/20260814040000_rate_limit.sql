-- R-22 / B-06 — the cross-invocation token bucket.
--
-- arXiv asks for 1 request per 3 seconds. Vercel runs the app as Lambda
-- functions with no shared memory, so a per-process counter would be a
-- per-process counter: ten concurrent invocations means ten times the agreed
-- rate, and the first we would hear of it is a block.
--
-- Postgres is the only thing all invocations share, so the bucket lives here.
-- `for update` makes the read-modify-write genuinely atomic across every
-- caller, which is the whole point — this is not a cache, it is a lock.

create table public.rate_limit_buckets (
  key               text primary key,
  tokens            double precision not null,
  capacity          double precision not null,
  refill_per_second double precision not null,
  -- Full precision, NOT timestamptz(3) like every other table here.
  --
  -- At millisecond precision the write is rounded, and when it rounds up the
  -- next read computes a NEGATIVE elapsed time — so a freshly created, full
  -- bucket refills by a negative amount and refuses its own first token. In
  -- production that is the first arXiv call after a cold start sleeping three
  -- seconds for no reason, intermittently, depending on sub-millisecond
  -- timing. Caught by the arithmetic tests in packages/db/test/04.
  updated_at        timestamptz      not null default clock_timestamp()
);

comment on table public.rate_limit_buckets is
  'R-22: token buckets shared across all Lambda invocations. Written only by '
  'public.rate_limit_take(); there is no direct write path.';

alter table public.rate_limit_buckets enable row level security;
alter table public.rate_limit_buckets force  row level security;

-- Deny-all, stated explicitly rather than left implicit.
--
-- A table with RLS forced and no policy is already unreachable, but "no
-- policy" reads identically to "we forgot", and CI cannot tell the two apart.
-- This says the quiet part out loud: nothing reaches this table except the
-- SECURITY DEFINER function below.
create policy rate_limit_buckets_no_direct_access on public.rate_limit_buckets
  for all
  using (false)
  with check (false);

/**
 * Take `p_cost` tokens from a bucket.
 *
 * Returns the number of seconds the caller should wait: 0 means granted.
 * Returning a wait rather than a boolean lets the caller sleep exactly long
 * enough instead of polling, which matters for arXiv's 3-second spacing.
 */
create or replace function public.rate_limit_take(
  p_key               text,
  p_capacity          double precision,
  p_refill_per_second double precision,
  p_cost              double precision default 1
)
returns double precision
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- clock_timestamp(), NOT now(): now() is the transaction start time and is
  -- frozen for the whole transaction, so a caller doing two takes inside one
  -- transaction would see zero elapsed time and refill nothing.
  v_now     timestamptz := clock_timestamp();
  v_tokens  double precision;
  v_updated timestamptz;
  v_elapsed double precision;
begin
  if p_refill_per_second <= 0 or p_capacity <= 0 then
    raise exception 'rate_limit_take needs a positive capacity and refill rate';
  end if;

  insert into public.rate_limit_buckets (key, tokens, capacity, refill_per_second, updated_at)
  values (p_key, p_capacity, p_capacity, p_refill_per_second, v_now)
  on conflict (key) do nothing;

  -- The lock is the mechanism. Everything above is bookkeeping.
  select b.tokens, b.updated_at
    into v_tokens, v_updated
    from public.rate_limit_buckets b
   where b.key = p_key
     for update;

  -- greatest(0, …) guards a clock that moves backwards: NTP correction, or a
  -- timestamp written with coarser precision than it is read at. A negative
  -- elapsed would otherwise DRAIN the bucket on a read.
  v_elapsed := greatest(0, extract(epoch from (v_now - v_updated)));
  v_tokens  := least(p_capacity, v_tokens + (v_elapsed * p_refill_per_second));

  if v_tokens >= p_cost then
    update public.rate_limit_buckets
       set tokens = v_tokens - p_cost,
           capacity = p_capacity,
           refill_per_second = p_refill_per_second,
           updated_at = v_now
     where key = p_key;
    return 0;
  end if;

  update public.rate_limit_buckets
     set tokens = v_tokens,
         capacity = p_capacity,
         refill_per_second = p_refill_per_second,
         updated_at = v_now
   where key = p_key;

  return (p_cost - v_tokens) / p_refill_per_second;
end;
$$;

comment on function public.rate_limit_take(text, double precision, double precision, double precision) is
  'R-22: atomic token bucket shared across Lambda invocations. Returns seconds '
  'to wait; 0 means granted. Uses clock_timestamp() so refill works inside a '
  'transaction.';

grant execute on function
  public.rate_limit_take(text, double precision, double precision, double precision)
  to Porcupine_app, authenticated;
