-- Phase 1 — RLS for the corpus tables.
--
-- Same rule as Phase 0: a table is not shipped until it has RLS enabled,
-- forced, and at least one policy. CI fails the merge otherwise.
--
-- Policies are named <table>_<verb>_<subject> so a failing pgTAP assertion
-- names the policy that is wrong.
--
-- Two tables here are not shaped like the Phase 0 ones and need argument:
--   * works       — deliberately global, not tenant-scoped.
--   * file_objects — owner-scoped first, project-scoped second.
-- Both are explained where they appear.

-- ═══════════════════════ Extensions ═══════════════════════
-- Trigram matching backs import-time dedupe (a title that nearly matches) and
-- quote search over anchors. Created before the indexes that need it.

create extension if not exists pg_trgm with schema extensions;

-- ═══════════════════════ Enable + FORCE RLS ═══════════════════════

alter table public.questions              enable row level security;
alter table public.questions              force  row level security;
alter table public.works                  enable row level security;
alter table public.works                  force  row level security;
alter table public.saved_searches         enable row level security;
alter table public.saved_searches         force  row level security;
alter table public.file_objects           enable row level security;
alter table public.file_objects           force  row level security;
alter table public.project_works          enable row level security;
alter table public.project_works          force  row level security;
alter table public.project_work_questions enable row level security;
alter table public.project_work_questions force  row level security;
alter table public.anchors                enable row level security;
alter table public.anchors                force  row level security;
alter table public.annotations            enable row level security;
alter table public.annotations            force  row level security;

-- ═══════════════════════ Write-capable roles ═══════════════════════
-- OWNER/ADMIN/CONTRIBUTOR change the corpus. REVIEWER is a supervisor: they
-- annotate and comment but do not move papers through the pipeline, because
-- "my supervisor silently excluded 40 papers" is not a support ticket anyone
-- wants. OBSERVER reads.

-- ── questions ───────────────────────────────────────────────────────────────

create policy questions_select_member on public.questions
  for select
  using (public.is_project_member(project_id));

create policy questions_write_contributor on public.questions
  for all
  using (public.has_project_role(project_id, array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[]))
  with check (public.has_project_role(project_id, array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[]));

-- ── works ───────────────────────────────────────────────────────────────────
-- The one table in the system that is deliberately NOT tenant-scoped.
--
-- Bibliographic metadata is public fact. Scoping it per project would mean
-- re-fetching every provider for every project — slower for us, and ruder to
-- APIs that are free. So: any authenticated user may read any work.
--
-- There is NO insert, update, or delete policy. That is not an oversight.
-- A global table with per-user writes is a cross-tenant integrity risk: one
-- user editing a shared `Work` row changes what every other project sees, and
-- `citation_key` in particular must never move, because it is embedded in
-- every \cite{} of every LaTeX project that used it.
--
-- Writes go exclusively through public.upsert_work(), below, which is
-- SECURITY DEFINER and owns normalization and dedupe.

create policy works_select_authenticated on public.works
  for select
  using (public.current_user_id() is not null);

-- ── saved_searches ──────────────────────────────────────────────────────────

create policy saved_searches_select_member on public.saved_searches
  for select
  using (public.is_project_member(project_id));

create policy saved_searches_write_contributor on public.saved_searches
  for all
  using (public.has_project_role(project_id, array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[]))
  with check (public.has_project_role(project_id, array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[]));

-- ── file_objects ────────────────────────────────────────────────────────────
-- Owner-scoped first, project-scoped second.
--
-- ADR-005: a user's PDF copy is theirs. Publisher files are never
-- redistributed between users, so project membership alone does not entitle
-- you to another member's uploaded bytes — it entitles you to the row, so the
-- UI can say "3 members have this PDF" without handing them over.
--
-- The bytes themselves are gated separately: R2 has no RLS, so a download is
-- verify JWT -> is_project_member() -> presigned GET, 5-minute TTL.

create policy file_objects_select_owner_or_member on public.file_objects
  for select
  using (
    owner_id = public.current_user_id()
    or (project_id is not null and public.is_project_member(project_id))
  );

create policy file_objects_insert_own on public.file_objects
  for insert
  with check (
    owner_id = public.current_user_id()
    and (project_id is null or public.is_project_member(project_id))
  );

create policy file_objects_update_own on public.file_objects
  for update
  using (owner_id = public.current_user_id())
  with check (owner_id = public.current_user_id());

create policy file_objects_delete_own on public.file_objects
  for delete
  using (owner_id = public.current_user_id());

-- ── project_works ───────────────────────────────────────────────────────────

create policy project_works_select_member on public.project_works
  for select
  using (public.is_project_member(project_id));

create policy project_works_write_contributor on public.project_works
  for all
  using (public.has_project_role(project_id, array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[]))
  with check (public.has_project_role(project_id, array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[]));

-- ── project_work_questions ──────────────────────────────────────────────────
-- No project_id column of its own, so membership is reached through the
-- parent. The join is against project_works, whose own policy is not consulted
-- here — an EXISTS in a policy predicate runs as the table owner — hence the
-- explicit is_project_member() call rather than a bare join.

create policy project_work_questions_select_member on public.project_work_questions
  for select
  using (
    exists (
      select 1 from public.project_works pw
      where pw.id = project_work_id
        and public.is_project_member(pw.project_id)
    )
  );

create policy project_work_questions_write_contributor on public.project_work_questions
  for all
  using (
    exists (
      select 1 from public.project_works pw
      where pw.id = project_work_id
        and public.has_project_role(pw.project_id, array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[])
    )
  )
  with check (
    exists (
      select 1 from public.project_works pw
      where pw.id = project_work_id
        and public.has_project_role(pw.project_id, array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[])
    )
  );

-- ── anchors ─────────────────────────────────────────────────────────────────
-- Reviewers create anchors, because creating a highlight is how a supervisor
-- points at the thing they are commenting on.

create policy anchors_select_member on public.anchors
  for select
  using (public.is_project_member(project_id));

create policy anchors_write_annotator on public.anchors
  for all
  using (public.has_project_role(project_id, array['OWNER','ADMIN','CONTRIBUTOR','REVIEWER']::"AccessRole"[]))
  with check (public.has_project_role(project_id, array['OWNER','ADMIN','CONTRIBUTOR','REVIEWER']::"AccessRole"[]));

-- ── annotations ─────────────────────────────────────────────────────────────
-- PRIVATE means private: visible to its author and nobody else, including the
-- project owner. A private reading note that a supervisor can read is not a
-- private reading note, and users will discover the difference the hard way.
--
-- Soft-deleted rows stay readable to their author only; the UI filters them.

create policy annotations_select_visible on public.annotations
  for select
  using (
    public.is_project_member(project_id)
    and (visibility = 'PROJECT' or author_id = public.current_user_id())
  );

create policy annotations_insert_own on public.annotations
  for insert
  with check (
    author_id = public.current_user_id()
    and public.has_project_role(
      project_id,
      array['OWNER','ADMIN','CONTRIBUTOR','REVIEWER']::"AccessRole"[]
    )
  );

-- Only the author edits or removes an annotation. There is no moderation path
-- on purpose: an owner who could rewrite a supervisor's comment would make the
-- review trail worthless.
create policy annotations_update_own on public.annotations
  for update
  using (author_id = public.current_user_id())
  with check (author_id = public.current_user_id());

create policy annotations_delete_own on public.annotations
  for delete
  using (author_id = public.current_user_id());

-- ═══════════════════════ Controlled writes to `works` ═══════════════════════
-- The single door through which a Work row is created or refreshed.
--
-- SECURITY DEFINER because `works` has no write policy — this function is the
-- privilege. search_path is pinned so definer rights cannot be hijacked.
--
-- Dedupe is by identifier, in descending order of confidence: DOI, then arXiv,
-- then OpenAlex, then PMID, then (title_norm, published_year). Fuzzy trigram
-- matching deliberately does NOT auto-merge here — it proposes a merge in the
-- UI instead, because a wrong automatic merge silently destroys one of two
-- papers and there is no way for a user to notice.

create or replace function public.upsert_work(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id          uuid;
  v_title       text := nullif(payload ->> 'title', '');
  v_title_norm  text;
begin
  if public.current_user_id() is null then
    raise exception 'upsert_work requires an authenticated claim'
      using errcode = 'insufficient_privilege';
  end if;

  if v_title is null then
    raise exception 'upsert_work requires a title';
  end if;

  -- Normalization lives here rather than in application code so that every
  -- provider adapter, import path, and future backfill produces the same key.
  --
  -- Whitespace is collapsed FIRST. Stripping punctuation before that deletes
  -- newlines and tabs outright, turning "Deep\n  Learning" into
  -- "deeplearning" instead of "deep learning" — and arXiv's Atom feed wraps
  -- titles across lines, so the papers indexed by both arXiv and OpenAlex are
  -- exactly the ones that would then fail to dedupe. Kept in step with
  -- normalizeTitle() in packages/discovery; 05_normalize_parity.sql checks.
  v_title_norm := regexp_replace(lower(v_title), '\s+', ' ', 'g');
  v_title_norm := regexp_replace(v_title_norm, '[^a-z0-9 ]', '', 'g');
  v_title_norm := trim(regexp_replace(v_title_norm, '\s+', ' ', 'g'));

  select w.id into v_id
  from public.works w
  where (payload ->> 'doi'        is not null and w.doi         = payload ->> 'doi')
     or (payload ->> 'arxivId'    is not null and w.arxiv_id    = payload ->> 'arxivId')
     or (payload ->> 'openalexId' is not null and w.openalex_id = payload ->> 'openalexId')
     or (payload ->> 'pmid'       is not null and w.pmid        = payload ->> 'pmid')
     or (w.title_norm = v_title_norm
         and w.published_year is not distinct from (payload ->> 'publishedYear')::int)
  limit 1;

  if v_id is null then
    insert into public.works (
      id, doi, arxiv_id, openalex_id, pmid, title_norm, title, abstract,
      authors, venue, published_year, published_on, type, language,
      oa_status, oa_pdf_url, cited_by_count, referenced_works, concepts,
      fetched_at, raw, created_at, updated_at
    )
    values (
      gen_random_uuid(),
      payload ->> 'doi',
      payload ->> 'arxivId',
      payload ->> 'openalexId',
      payload ->> 'pmid',
      v_title_norm,
      v_title,
      payload ->> 'abstract',
      coalesce(payload -> 'authors', '[]'::jsonb),
      payload ->> 'venue',
      (payload ->> 'publishedYear')::int,
      (payload ->> 'publishedOn')::timestamptz,
      payload ->> 'type',
      payload ->> 'language',
      payload ->> 'oaStatus',
      payload ->> 'oaPdfUrl',
      coalesce((payload ->> 'citedByCount')::int, 0),
      coalesce(
        array(select jsonb_array_elements_text(payload -> 'referencedWorks')),
        '{}'::text[]
      ),
      payload -> 'concepts',
      now(),
      payload -> 'raw',
      now(),
      now()
    )
    returning id into v_id;
  else
    -- Enrich: a later provider may know an identifier the first one did not.
    -- coalesce keeps what we already have; it never blanks a known value.
    -- citation_key is untouched on purpose — see the policy comment above.
    update public.works w
    set doi              = coalesce(w.doi,         payload ->> 'doi'),
        arxiv_id         = coalesce(w.arxiv_id,    payload ->> 'arxivId'),
        openalex_id      = coalesce(w.openalex_id, payload ->> 'openalexId'),
        pmid             = coalesce(w.pmid,        payload ->> 'pmid'),
        abstract         = coalesce(w.abstract,    payload ->> 'abstract'),
        venue            = coalesce(w.venue,       payload ->> 'venue'),
        language         = coalesce(w.language,    payload ->> 'language'),
        oa_status        = coalesce(payload ->> 'oaStatus',  w.oa_status),
        oa_pdf_url       = coalesce(payload ->> 'oaPdfUrl',  w.oa_pdf_url),
        cited_by_count   = greatest(w.cited_by_count,
                                    coalesce((payload ->> 'citedByCount')::int, 0)),
        fetched_at       = now(),
        updated_at       = now()
    where w.id = v_id;
  end if;

  return v_id;
end;
$$;

comment on function public.upsert_work(jsonb) is
  'The only write path into public.works, which has no write policy. '
  'Owns title normalization and identifier dedupe so every provider adapter '
  'and import path produces the same keys.';

grant execute on function public.upsert_work(jsonb) to porcupine_app, authenticated;

-- ═══════════════════════ Indexes that Prisma cannot express ═════════════════

-- Full-text search over the corpus. R-14: language-aware, never 'english'.
create index works_search_idx on public.works using gin (search_tsv);

-- Import-time dedupe: "is this nearly the same title?" The upsert above uses
-- exact title_norm; this index backs the fuzzy candidate list shown to a user
-- before any merge happens.
create index works_title_trgm_idx on public.works using gin (title extensions.gin_trgm_ops);

-- Quote search over cited passages.
create index anchors_quote_trgm_idx on public.anchors using gin (quote extensions.gin_trgm_ops);

-- Annotation body search. Annotations are server-confidential, not E2EE
-- (ADR-001), which is what makes this possible at all.
create index annotations_body_idx on public.annotations
  using gin (public.build_tsvector(null, body));

-- The my-queue view: everything assigned to me, soonest first.
create index project_works_queue_idx on public.project_works (assignee_id, due_at)
  where assignee_id is not null;

-- ═══════════════════════ updated_at triggers ═══════════════════════

create trigger questions_touch_updated_at
  before update on public.questions
  for each row execute function public.touch_updated_at();

create trigger works_touch_updated_at
  before update on public.works
  for each row execute function public.touch_updated_at();

create trigger saved_searches_touch_updated_at
  before update on public.saved_searches
  for each row execute function public.touch_updated_at();

create trigger file_objects_touch_updated_at
  before update on public.file_objects
  for each row execute function public.touch_updated_at();

create trigger project_works_touch_updated_at
  before update on public.project_works
  for each row execute function public.touch_updated_at();

create trigger anchors_touch_updated_at
  before update on public.anchors
  for each row execute function public.touch_updated_at();

create trigger annotations_touch_updated_at
  before update on public.annotations
  for each row execute function public.touch_updated_at();
