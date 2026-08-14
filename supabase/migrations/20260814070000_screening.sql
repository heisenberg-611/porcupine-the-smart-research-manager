-- Phase 1 week 5 — screening integrity.
--
-- PRISMA 2020 requires exclusions to be reported BY CATEGORY with counts, and
-- the Phase 2 flow diagram is derived directly from these rows. A single
-- EXCLUDED row with no reason makes the diagram unreportable — the numbers
-- stop adding up and the reviewer cannot defend them.
--
-- So the rule lives in the database, not only in the form. A form can be
-- bypassed by an import, a bulk action, a future API, or a bug; the table
-- cannot. R-06 gates this on Project.kind: a thesis student jotting notes
-- should not be forced through systematic-review bookkeeping, so the
-- requirement applies only where the methodology actually demands it.

create or replace function public.enforce_exclusion_reason()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind "ProjectKind";
begin
  if new.screen_status <> 'EXCLUDED' then
    return new;
  end if;

  if new.exclude_reason is not null and length(trim(new.exclude_reason)) > 0 then
    return new;
  end if;

  select p.kind into v_kind from public.projects p where p.id = new.project_id;

  -- capabilities(kind).exclusionReasonRequired in packages/shared. Kept in
  -- step by 06_screening.sql, which asserts both sides.
  if v_kind = 'SYSTEMATIC_REVIEW' then
    raise exception
      'A systematic review requires an exclusion reason when excluding a paper'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_exclusion_reason() is
  'PRISMA 2020 reports exclusions by category. Enforced here rather than only '
  'in the form, because imports and bulk actions do not go through the form.';

create trigger project_works_require_exclusion_reason
  before insert or update of screen_status, exclude_reason on public.project_works
  for each row execute function public.enforce_exclusion_reason();

-- ── Screening decisions are auditable ───────────────────────────────────────
-- Who decided what, and when. A screening decision that cannot be attributed
-- is one a reviewer cannot defend, and "the four of us agreed" is not a
-- record. This is also the raw material for the Phase 2b agreement stats.

-- Column and constraint shapes match what Prisma emits for this model, so
-- `db:diff` stays quiet: no DB-side id default (Prisma generates the uuid),
-- and `on update cascade` on every foreign key.
create table public.screening_decisions (
  id             uuid primary key,
  project_id     uuid not null
                 references public.projects(id) on delete cascade on update cascade,
  project_work_id uuid not null
                 references public.project_works(id) on delete cascade on update cascade,
  decided_by     uuid not null
                 references public.users(id) on delete restrict on update cascade,
  from_status    "ScreenStatus",
  to_status      "ScreenStatus" not null,
  exclude_reason text,
  note           text,
  created_at     timestamptz(3) not null default now()
);

comment on table public.screening_decisions is
  'Append-only log of screening transitions. There is deliberately no UPDATE '
  'or DELETE policy: a decision log that can be edited is not a log.';

create index screening_decisions_project_idx
  on public.screening_decisions (project_id, created_at desc);
create index screening_decisions_work_idx
  on public.screening_decisions (project_work_id, created_at desc);

alter table public.screening_decisions enable row level security;
alter table public.screening_decisions force  row level security;

create policy screening_decisions_select_member on public.screening_decisions
  for select
  using (public.is_project_member(project_id));

-- Insert only, and only as yourself. Append-only is enforced by the ABSENCE
-- of update and delete policies, the same way project_keys is.
create policy screening_decisions_insert_own on public.screening_decisions
  for insert
  with check (
    decided_by = public.current_user_id()
    and public.has_project_role(
      project_id,
      array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[]
    )
  );

-- ── Progress, as a view ─────────────────────────────────────────────────────
-- Counts per status for the project dashboard and the burndown in week 6.
-- A view rather than application code so the numbers are the same everywhere
-- they are read, including from SQL during a support conversation.

create or replace view public.v_project_progress
with (security_invoker = true) as
  select
    pw.project_id,
    pw.screen_status,
    count(*)::int as count,
    count(*) filter (where pw.assignee_id is not null)::int as assigned,
    count(*) filter (where pw.due_at is not null and pw.due_at < now())::int as overdue
  from public.project_works pw
  group by pw.project_id, pw.screen_status;

comment on view public.v_project_progress is
  'security_invoker: the view runs with the CALLER''s permissions, so RLS on '
  'project_works still applies. Without it a view is a hole straight through '
  'every policy underneath it.';

grant select on public.v_project_progress to porcupine_app, authenticated;
