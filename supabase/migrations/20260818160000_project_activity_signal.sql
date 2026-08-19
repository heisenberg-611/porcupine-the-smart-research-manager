-- ═══════════════════════════════════════════════════════════════════════════
-- A content-free "something changed" signal, for live updates.
--
-- ─ Why a table at all ──────────────────────────────────────────────────────
--
-- Supabase Realtime's Postgres Changes reads the write-ahead log, so a client
-- can only be told about something that was actually written. The obvious
-- move is to put `project_works`, `extractions` and `screening_decisions` into
-- the `supabase_realtime` publication and let members subscribe to them
-- directly.
--
-- That is not done here, deliberately. Doing it puts the CONTENT of every
-- changed row onto a websocket — screening decisions, exclusion reasons,
-- assignees — and makes the correctness of that boundary depend on Realtime
-- evaluating our RLS policies per subscriber. It does; but this repository's
-- rule is that a security boundary is not done until it has been seen to fail,
-- and CI starts Supabase with `-x realtime` (.github/workflows/ci.yml), so
-- that particular boundary cannot be exercised in CI at all.
--
-- So the only table in the publication is this one, and it holds no content.
-- A project id, a word, and a timestamp. The worst an unauthorised subscriber
-- could learn — if Realtime's RLS enforcement were wrong, which is the thing
-- CI cannot check — is that some project had some kind of activity at some
-- moment. Not what changed, not who changed it, not which paper.
--
-- The client uses it as a doorbell: on any event it re-renders from the
-- server, where RLS is applied by the same policies as every other read. The
-- payload is deliberately never used.
--
-- ─ Why it stays small ──────────────────────────────────────────────────────
--
-- One row per (project, kind), UPSERTed rather than appended, so a review with
-- 300 papers and 5,000 decisions leaves four rows behind rather than 5,000 and
-- there is nothing to prune. An UPDATE reaches the WAL exactly as an INSERT
-- does, so liveness is unaffected.
--
-- The cost, stated because it is real: every screening decision now takes a
-- row lock on (project_id, 'screening') until its transaction commits, so
-- decisions within one project serialise on it where before only decisions on
-- the SAME PAPER contended. The transactions are short — a compare-and-swap
-- and two inserts — and the alternative, an append-only table, trades that
-- lock for unbounded growth. If this ever shows up in the Phase 1 exit trial
-- numbers, the fix is to move the signal out of the trigger and into the
-- server action, after commit.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.project_activity (
  -- `on update cascade` as well as `on delete`: Prisma emits both by default
  -- for a required relation, and `pnpm db:diff` reports the difference as drift
  -- until they match.
  project_id uuid        not null references public.projects(id) on delete cascade on update cascade,
  -- Not an enum. A new signal kind is a UI decision, and an enum would make it
  -- a migration plus a deploy ordering problem for a string nobody stores.
  kind       text        not null,
  at         timestamptz not null default now(),

  primary key (project_id, kind)
);

comment on table public.project_activity is
  'One row per project per kind of activity, bumped on change. Carries no content: it exists so a client can be told to refetch, and is the only table in the supabase_realtime publication.';

alter table public.project_activity enable row level security;
alter table public.project_activity force row level security;

-- SELECT only, and only for members. Nothing may write through the API: the
-- rows are maintained entirely by the trigger below, which is why there is no
-- insert, update or delete policy. A missing policy denies, so this is not an
-- omission — it is the rule.
create policy project_activity_select_member on public.project_activity
  for select
  using (public.is_project_member(project_id));

grant select on public.project_activity to Porcupine_app;

-- ── The bump ───────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER because the table has FORCE row level security and no write
-- policy, so the calling member cannot write it and must not be able to. The
-- search_path is pinned for the reason every function in the 2026-08-17
-- migration is pinned: an unqualified name in a definer function is somebody
-- else's function waiting to happen.
create or replace function public.bump_project_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_project_id uuid;
begin
  -- TG_ARGV[0] is the kind. Passed per trigger rather than derived from
  -- TG_TABLE_NAME so that two tables can share one signal — the library and
  -- the screening queue are the same thing to a reader looking at a page.
  v_project_id := case when TG_OP = 'DELETE' then OLD.project_id else NEW.project_id end;

  if v_project_id is null then
    return null;
  end if;

  -- The project may be on its way out.
  --
  -- `delete from projects` cascades to `project_works`, `extractions` and
  -- `messages`, and this trigger fires on each of those deletions — by which
  -- time the parent row is already gone from the snapshot, so inserting a
  -- signal that references it fails the foreign key and takes the whole
  -- deletion down with it. Deleting a project would have been impossible.
  --
  -- Found by the concurrency runner in packages/db/scripts/pgtap.mjs, which
  -- tears its fixture down with exactly that statement. A cheap primary-key
  -- lookup is the price of a project that can still be deleted.
  if not exists (select 1 from public.projects p where p.id = v_project_id) then
    return null;
  end if;

  insert into public.project_activity (project_id, kind, at)
  values (v_project_id, TG_ARGV[0], now())
  on conflict (project_id, kind)
    do update set at = excluded.at;

  return null;
end;
$$;

comment on function public.bump_project_activity() is
  'AFTER trigger: records that a kind of activity happened in a project, with no detail about what.';

revoke execute on function public.bump_project_activity() from public;

-- ── What is watched ────────────────────────────────────────────────────────
--
-- AFTER, and FOR EACH ROW rather than FOR EACH STATEMENT: a statement-level
-- trigger cannot see which project the changed rows belonged to, and these
-- statements are single-row in practice.
--
-- `extraction_values` is deliberately absent. The extraction form does not
-- autosave, on purpose, and signalling every value would put a write on the
-- inner loop of the one screen in this app that is explicitly not live.

create trigger project_works_bump_activity
  after insert or update or delete on public.project_works
  for each row execute function public.bump_project_activity('screening');

create trigger screening_decisions_bump_activity
  after insert on public.screening_decisions
  for each row execute function public.bump_project_activity('screening');

create trigger extractions_bump_activity
  after insert or update or delete on public.extractions
  for each row execute function public.bump_project_activity('extraction');

create trigger messages_bump_activity
  after insert on public.messages
  for each row execute function public.bump_project_activity('messages');

-- ── The publication ────────────────────────────────────────────────────────
--
-- This table and nothing else. `add table` is not idempotent and raises if the
-- table is already a member, so it is guarded — `supabase db reset` replays
-- every migration from empty, but a hand-run against an existing database
-- should not fail on its second attempt.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_activity'
  ) then
    alter publication supabase_realtime add table public.project_activity;
  end if;
end
$$;
