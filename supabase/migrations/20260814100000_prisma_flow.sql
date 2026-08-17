-- PRISMA 2020 flow — the numbers a review has to report.
--
-- The diagram is a mandatory publication artifact, currently drawn by hand in
-- PowerPoint by everyone who publishes a systematic review. Deriving it is the
-- single clearest reason a review team would adopt this tool.
--
-- Which means the numbers have to be REAL. A PRISMA diagram with a plausible
-- invented figure in it is worse than no diagram at all: it goes into a
-- published paper, and a reviewer who checks it finds the review's own author
-- cannot reproduce their count.
--
-- That constraint exposed a gap. PRISMA requires "records removed before
-- screening — duplicate records removed", and the import path deduplicated
-- silently: it computed `added` and `alreadyPresent` and discarded both. The
-- number was unrecoverable after the fact, so it is recorded now.

create table public.import_batches (
  id            uuid primary key,
  project_id    uuid not null
                references public.projects(id) on delete cascade on update cascade,
  imported_by   uuid not null
                references public.users(id) on delete restrict on update cascade,
  -- bibtex | ris | identifiers
  format        text not null,
  -- Records the user actually submitted, before anything was removed.
  submitted     integer not null,
  -- Merged with another record IN THE SAME paste — the same paper listed
  -- twice, or a preprint and its published version.
  deduplicated  integer not null default 0,
  -- Already in this project's library from an earlier import or search.
  already_present integer not null default 0,
  -- New ProjectWork rows created.
  added         integer not null default 0,
  created_at    timestamptz(3) not null default now()
);

comment on table public.import_batches is
  'One row per completed import. Exists because PRISMA 2020 requires the '
  'count of records removed before screening, and the import path previously '
  'deduplicated silently — the number could not be reconstructed afterwards.';

create index import_batches_project_idx
  on public.import_batches (project_id, created_at desc);

alter table public.import_batches enable row level security;
alter table public.import_batches force  row level security;

create policy import_batches_select_member on public.import_batches
  for select
  using (public.is_project_member(project_id));

-- Append-only, like screening_decisions: these numbers end up in a published
-- methods section, so an editable audit trail is not an audit trail.
create policy import_batches_insert_own on public.import_batches
  for insert
  with check (
    imported_by = public.current_user_id()
    and public.has_project_role(
      project_id,
      array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[]
    )
  );

-- ── The flow itself ─────────────────────────────────────────────────────────
--
-- security_invoker so RLS still applies. Without it the view runs as its owner
-- and every caller sees every project — see packages/db/test/06_screening.sql,
-- which asserts exactly that for v_project_progress.

create or replace view public.v_prisma_flow
with (security_invoker = true) as
  select
    p.id as project_id,

    -- Identification. Records the team actually put in, from both routes.
    coalesce((
      select sum(ib.submitted) from public.import_batches ib
      where ib.project_id = p.id
    ), 0)::int
      + (
      select count(*) from public.project_works pw
      where pw.project_id = p.id and pw.source = 'search'
    )::int as records_identified,

    -- Removed before screening. Only the duplicates we can actually account
    -- for: merged within a paste, or already in the library.
    coalesce((
      select sum(ib.deduplicated + ib.already_present) from public.import_batches ib
      where ib.project_id = p.id
    ), 0)::int as records_removed_before_screening,

    (select count(*) from public.project_works pw where pw.project_id = p.id)::int
      as records_screened,

    (select count(*) from public.project_works pw
      where pw.project_id = p.id and pw.screen_status = 'EXCLUDED')::int
      as records_excluded,

    (select count(*) from public.project_works pw
      where pw.project_id = p.id
        and pw.screen_status in ('INCLUDED','READING','EXTRACTED','SYNTHESIZED'))::int
      as studies_included,

    -- Not yet decided. Reported so the diagram can say the review is still in
    -- progress rather than quietly implying the numbers are final.
    (select count(*) from public.project_works pw
      where pw.project_id = p.id
        and pw.screen_status in ('IDENTIFIED','SCREENING'))::int
      as records_pending
  from public.projects p;

comment on view public.v_prisma_flow is
  'PRISMA 2020 counts per project. security_invoker: runs with the CALLER''s '
  'permissions so RLS applies. Every figure is derived from recorded rows — '
  'nothing here is estimated.';

-- Exclusions by category, which is the part PRISMA is strict about: reasons
-- must be reported with counts, not summarised as "did not meet criteria".
create or replace view public.v_prisma_exclusions
with (security_invoker = true) as
  select
    pw.project_id,
    coalesce(nullif(trim(pw.exclude_reason), ''), 'UNSPECIFIED') as reason,
    count(*)::int as count
  from public.project_works pw
  where pw.screen_status = 'EXCLUDED'
  group by pw.project_id, coalesce(nullif(trim(pw.exclude_reason), ''), 'UNSPECIFIED');

comment on view public.v_prisma_exclusions is
  'Exclusion counts by category. UNSPECIFIED appears only for project kinds '
  'that do not require a reason — a systematic review cannot produce it, '
  'because the trigger on project_works refuses the row.';

grant select on public.v_prisma_flow to Porcupine_app, authenticated;
grant select on public.v_prisma_exclusions to Porcupine_app, authenticated;
