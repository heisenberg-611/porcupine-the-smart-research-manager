-- Phase 2 — extraction: RLS, and the two rules that make an evidence table
-- worth reading.
--
-- The phase's exit criterion is "inconsistent evidence tables become
-- structurally impossible". Structurally means here, not in the form. A form
-- can be bypassed by an import, a bulk action, a future API, or a bug.

alter table public.protocols         enable row level security;
alter table public.protocols         force  row level security;
alter table public.protocol_fields   enable row level security;
alter table public.protocol_fields   force  row level security;
alter table public.extractions       enable row level security;
alter table public.extractions       force  row level security;
alter table public.extraction_values enable row level security;
alter table public.extraction_values force  row level security;

-- ── protocols ───────────────────────────────────────────────────────────────
-- Everyone reads the protocol; it is the question set the whole team answers.
-- Only OWNER/ADMIN change it: a protocol edited mid-review by any contributor
-- is a review whose rows answered different questions.

create policy protocols_select_member on public.protocols
  for select
  using (public.is_project_member(project_id));

create policy protocols_write_admin on public.protocols
  for all
  using (public.has_project_role(project_id, array['OWNER','ADMIN']::"AccessRole"[]))
  with check (public.has_project_role(project_id, array['OWNER','ADMIN']::"AccessRole"[]));

-- ── protocol_fields ─────────────────────────────────────────────────────────
-- No project_id of its own, so membership is reached through the protocol.

create policy protocol_fields_select_member on public.protocol_fields
  for select
  using (
    exists (
      select 1 from public.protocols p
      where p.id = protocol_id and public.is_project_member(p.project_id)
    )
  );

create policy protocol_fields_write_admin on public.protocol_fields
  for all
  using (
    exists (
      select 1 from public.protocols p
      where p.id = protocol_id
        and public.has_project_role(p.project_id, array['OWNER','ADMIN']::"AccessRole"[])
    )
  )
  with check (
    exists (
      select 1 from public.protocols p
      where p.id = protocol_id
        and public.has_project_role(p.project_id, array['OWNER','ADMIN']::"AccessRole"[])
    )
  );

-- ── extractions ─────────────────────────────────────────────────────────────
-- Read by the whole project: an extraction nobody else can see cannot be
-- reviewed, and review is the point.
--
-- Written only by the extractor. Not even an owner may edit someone else's
-- extraction — dual extraction (Phase 2b) measures agreement between two
-- people, and that measurement is meaningless if a third can quietly edit
-- either side.

create policy extractions_select_member on public.extractions
  for select
  using (public.is_project_member(project_id));

create policy extractions_insert_own on public.extractions
  for insert
  with check (
    extractor_id = public.current_user_id()
    and public.has_project_role(
      project_id, array['OWNER','ADMIN','CONTRIBUTOR']::"AccessRole"[]
    )
  );

create policy extractions_update_own on public.extractions
  for update
  using (extractor_id = public.current_user_id())
  with check (extractor_id = public.current_user_id());

create policy extractions_delete_own on public.extractions
  for delete
  using (extractor_id = public.current_user_id());

-- ── extraction_values ───────────────────────────────────────────────────────

create policy extraction_values_select_member on public.extraction_values
  for select
  using (public.is_project_member(project_id));

create policy extraction_values_write_own on public.extraction_values
  for all
  using (
    exists (
      select 1 from public.extractions e
      where e.id = extraction_id and e.extractor_id = public.current_user_id()
    )
  )
  with check (
    exists (
      select 1 from public.extractions e
      where e.id = extraction_id and e.extractor_id = public.current_user_id()
    )
  );

-- ═══════════ Rule 1: a submitted extraction is frozen ═══════════════════════
--
-- DRAFT is private working state; SUBMITTED is a finding other people build
-- on. Editing a submitted extraction in place means an evidence table can
-- change under a reader with no record that it did — and in a systematic
-- review that is the difference between a result and an anecdote.
--
-- Reopening is allowed and explicit: set the status back to DRAFT first. The
-- point is that the change is deliberate, not that it is forbidden.

create or replace function public.freeze_submitted_extraction()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'DRAFT' then
    return new;
  end if;

  -- The only edit permitted on a non-draft row is a status transition, which
  -- is how it gets reopened, reconciled or verified.
  if new.status is distinct from old.status then
    return new;
  end if;

  raise exception
    'This extraction has been submitted. Reopen it as a draft before editing.'
    using errcode = 'check_violation';
end;
$$;

create trigger extractions_freeze_when_submitted
  before update on public.extractions
  for each row execute function public.freeze_submitted_extraction();

create or replace function public.freeze_submitted_extraction_values()
returns trigger
language plpgsql
as $$
declare
  v_status "ExtractionStatus";
begin
  select e.status into v_status
  from public.extractions e
  where e.id = coalesce(new.extraction_id, old.extraction_id);

  if v_status is null or v_status = 'DRAFT' then
    return coalesce(new, old);
  end if;

  raise exception
    'This extraction has been submitted. Reopen it as a draft before editing its values.'
    using errcode = 'check_violation';
end;
$$;

create trigger extraction_values_freeze_when_submitted
  before insert or update or delete on public.extraction_values
  for each row execute function public.freeze_submitted_extraction_values();

-- ═══════════ Rule 2: provenance where the protocol demands it ═══════════════
--
-- A field marked requiresAnchor exists so a claim can be traced to the exact
-- passage it came from. A value saved without one looks identical in the
-- evidence table and is worth nothing when a reviewer asks "where does this
-- number come from?" — so it is refused rather than accepted and flagged.

create or replace function public.enforce_value_anchor()
returns trigger
language plpgsql
as $$
declare
  v_requires boolean;
  v_label    text;
begin
  select f.requires_anchor, f.label
    into v_requires, v_label
  from public.protocol_fields f
  where f.id = new.field_id;

  if coalesce(v_requires, false) and new.anchor_id is null then
    raise exception
      'The field "%" requires a quoted passage from the source.', v_label
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger extraction_values_require_anchor
  before insert or update on public.extraction_values
  for each row execute function public.enforce_value_anchor();

-- ═══════════ The evidence table ═════════════════════════════════════════════
--
-- One row per (paper, field, extractor). Flattened here rather than in the
-- application so the number in a CSV export is the same number the UI shows
-- and the same number a support conversation gets from SQL.
--
-- security_invoker, as ever: without it the view runs as its owner and hands
-- every project's extractions to any caller.

create or replace view public.v_evidence_table
with (security_invoker = true) as
  select
    e.project_id,
    e.project_work_id,
    e.protocol_id,
    e.id            as extraction_id,
    e.extractor_id,
    e.status,
    w.title         as work_title,
    w.published_year,
    f.id            as field_id,
    f.key           as field_key,
    f.label         as field_label,
    f.type          as field_type,
    f."order"       as field_order,
    v.value,
    v.value_text,
    v.anchor_id
  from public.extractions e
  join public.project_works pw on pw.id = e.project_work_id
  join public.works w          on w.id = pw.work_id
  join public.protocol_fields f on f.protocol_id = e.protocol_id
  -- LEFT: a field nobody answered must still appear, as a hole. An inner join
  -- would make an incomplete extraction look complete by omitting the gaps.
  left join public.extraction_values v
    on v.extraction_id = e.id and v.field_id = f.id;

comment on view public.v_evidence_table is
  'One row per (paper, field, extractor). LEFT JOIN on values so unanswered '
  'fields appear as holes rather than vanishing — an inner join would make an '
  'incomplete extraction look complete.';

grant select on public.v_evidence_table to Porcupine_app, authenticated;

-- FTS over extracted values, so "which papers said anything about X" is one
-- query. R-14: language-aware, never a hardcoded config.
create index extraction_values_text_idx on public.extraction_values
  using gin (public.build_tsvector(null, value_text));
