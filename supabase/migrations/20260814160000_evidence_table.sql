-- Phase 2 week 4 — the evidence table.
--
-- `08-phase-2-build-plan.md` 4.1–4.6. This is what the previous three weeks
-- were for: a protocol nobody can read the answers to is a filing cabinet.
--
-- WHY THIS IS A DATABASE FUNCTION AND NOT A LOOP IN THE PAGE.
--
-- The obvious build is to select v_evidence_table for the project and pivot it
-- in TypeScript. It works, and it quietly breaks two requirements at once:
--
--   * 4.1 budget. 300 papers x 20 fields is 6,000 rows to ship over the wire
--     and group in JS, per keystroke of a filter, before anything renders.
--   * 4.2 says filter, sort and group are SERVER-side. Sorting in JS means
--     sorting only the page you already fetched, which is not sorting — the
--     top of a sorted 300-row table would be the top of whichever 100 rows
--     arrived first.
--
-- So the pivot, the filter, the sort, the grouping and the paging all happen
-- here, and the page renders what it is handed.
--
-- SECURITY. This function is SECURITY INVOKER (the default, stated here
-- because getting it wrong is catastrophic and invisible). It reads
-- v_evidence_table, which is itself `security_invoker = true`. Every row it
-- returns has passed the caller's RLS policies. A SECURITY DEFINER function
-- here would hand every tenant's extractions to anyone who could call it.

create or replace function public.evidence_rows(
  p_project_id       uuid,
  p_protocol_id      uuid,
  -- 'title' | 'year' | 'status' | 'answered' | 'field:<key>'
  p_sort             text    default 'title',
  p_dir              text    default 'asc',
  p_filter_key       text    default null,
  p_filter_text      text    default null,
  p_group_key        text    default null,
  p_only_incomplete  boolean default false,
  p_limit            int     default 100,
  p_offset           int     default 0
)
returns table (
  extraction_id    uuid,
  project_work_id  uuid,
  work_title       text,
  published_year   int,
  status           text,
  extractor_id     uuid,
  group_label      text,
  cells            jsonb,
  answered         int,
  field_total      int,
  total_rows       bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      v.extraction_id,
      v.project_work_id,
      v.work_title,
      v.published_year,
      v.status::text as status,
      v.extractor_id,

      -- One JSON object per paper, keyed by the field KEY rather than its
      -- label: the key is the immutable one (week 2), so a column cannot
      -- change identity underneath a saved sort or a second export.
      jsonb_object_agg(
        v.field_key,
        jsonb_build_object(
          'value',    v.value,
          'text',     v.value_text,
          'anchorId', v.anchor_id,
          'type',     v.field_type::text,
          'label',    v.field_label,
          -- 4.5. Explicit, not inferred from `value is null` at render time:
          -- a legitimately empty string answer is not the same as a hole, and
          -- a table that renders them alike makes an incomplete extraction
          -- look complete.
          'answered', v.value is not null
        )
        order by v.field_order
      ) as cells,

      count(*) filter (where v.value is not null)::int as answered,
      count(*)::int as field_total,

      -- 4.2. The numeric sort key for the column being sorted on, computed
      -- ONCE per paper here rather than per comparison.
      --
      -- The regex guard is the point of this expression. `(value #>> '{}')`
      -- of a NUMBER field is normally "12.5", but nothing at the database
      -- level stops a MULTI_ENUM value or a legacy string landing in a column
      -- later retyped to NUMBER, and an unguarded ::numeric would abort the
      -- whole query with a cast error — the evidence table would go blank
      -- because one cell in one row was untidy. A non-numeric value sorts as
      -- NULL, and NULLs sort last in both directions below.
      max(
        case
          when p_sort = 'field:' || v.field_key
           and v.field_type::text = 'NUMBER'
           and (v.value #>> '{}') ~ '^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$'
          then (trim(v.value #>> '{}'))::numeric
        end
      ) as sort_val_num,

      -- Text sort is case-insensitive: an evidence table sorted with every
      -- capitalised answer above every lowercase one is not sorted, it is
      -- sorted by shift key.
      max(
        case when p_sort = 'field:' || v.field_key then lower(v.value_text) end
      ) as sort_val_text,

      -- 4.2 grouping. NULL rather than '' when the grouped field is
      -- unanswered, so the UI can say "no answer" instead of showing an
      -- unlabelled group.
      max(
        case when p_group_key is not null and p_group_key = v.field_key
             then v.value_text end
      ) as group_label,

      bool_or(
        p_filter_key is not null
        and p_filter_key = v.field_key
        and v.value_text ilike '%' || p_filter_text || '%'
      ) as filter_hit

    from public.v_evidence_table v
    where v.project_id = p_project_id
      and v.protocol_id = p_protocol_id
    group by
      v.extraction_id, v.project_work_id, v.work_title,
      v.published_year, v.status, v.extractor_id
  ),
  filtered as (
    select * from base b
    where (
        p_filter_key is null
        or p_filter_text is null
        or p_filter_text = ''
        or b.filter_hit
      )
      and (not p_only_incomplete or b.answered < b.field_total)
  ),
  ordered as (
    select
      f.*,
      case p_sort
        when 'year'     then f.published_year::numeric
        when 'answered' then f.answered::numeric
        else f.sort_val_num
      end as k_num,
      case p_sort
        when 'title'  then lower(f.work_title)
        when 'status' then f.status
        else f.sort_val_text
      end as k_text,
      -- Computed before LIMIT, so the caller can page without a second query
      -- that would have to repeat every filter and could disagree with this
      -- one.
      count(*) over () as total_rows
    from filtered f
  )
  select
    o.extraction_id, o.project_work_id, o.work_title, o.published_year,
    o.status, o.extractor_id, o.group_label, o.cells, o.answered,
    o.field_total, o.total_rows
  from ordered o
  order by
    case when p_dir = 'desc'  then o.k_num end desc nulls last,
    case when p_dir <> 'desc' then o.k_num end asc  nulls last,
    case when p_dir = 'desc'  then o.k_text end desc nulls last,
    case when p_dir <> 'desc' then o.k_text end asc  nulls last,
    -- A total tiebreak. Without one, two papers with equal sort keys can swap
    -- places between page 1 and page 2 and a row is seen twice or never.
    lower(o.work_title) asc,
    o.extraction_id asc
  limit greatest(coalesce(p_limit, 100), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.evidence_rows is
  'The evidence table: one row per extraction, fields pivoted into `cells` '
  'keyed by field key. Filter, sort, group and paging are all server-side — '
  'sorting a page of rows in the client sorts the wrong set. SECURITY '
  'INVOKER: every row has passed the caller''s RLS policies.';

grant execute on function public.evidence_rows to Porcupine_app, authenticated;

-- The function filters on (project_id, protocol_id). The existing index on
-- extractions is (project_id, status), and the unique constraint leads with
-- project_work_id, so neither serves this.
create index if not exists extractions_project_protocol_idx
  on public.extractions (project_id, protocol_id);

-- ── 4.6 · Coverage per research question ────────────────────────────────────
--
-- `ProtocolField.questionId` has existed since week 1 and has never been read.
-- This is what it was for: not "how full is the table" but "is there a
-- question we are about to answer with nothing".
--
-- Counted over INCLUDED papers only, and that is the whole point. Coverage
-- across every paper ever imported is a meaningless denominator — a question
-- can look badly covered purely because 400 screened-out papers never had
-- anything extracted from them.

create or replace view public.v_question_coverage
with (security_invoker = true) as
  with included as (
    select pw.id, pw.project_id
    from public.project_works pw
    -- Everything downstream of inclusion, not just INCLUDED itself: a paper
    -- moved on to READING or EXTRACTED is still an included paper, and
    -- counting only INCLUDED would make coverage FALL as work progressed.
    where pw.screen_status in ('INCLUDED', 'READING', 'EXTRACTED', 'SYNTHESIZED')
  ),
  answered as (
    select distinct
      e.project_id,
      f.question_id,
      e.project_work_id
    from public.extractions e
    join public.protocol_fields f  on f.protocol_id = e.protocol_id
    join public.extraction_values v on v.extraction_id = e.id
                                   and v.field_id = f.id
    where f.question_id is not null
  )
  select
    q.project_id,
    q.id      as question_id,
    q.text    as question_text,
    q."order" as question_order,
    (select count(*)
       from public.protocol_fields f
      where f.question_id = q.id)::int as field_count,
    (select count(*)
       from included i
      where i.project_id = q.project_id)::int as included_papers,
    (select count(*)
       from answered a
       join included i on i.id = a.project_work_id
      where a.question_id = q.id)::int as papers_answered
  from public.questions q;

comment on view public.v_question_coverage is
  'Per research question: how many INCLUDED papers have at least one answer '
  'to a field tied to it. papers_answered = 0 with field_count > 0 is a '
  'question the review is about to answer with nothing. Denominator is '
  'included papers, not all papers — screened-out papers were never going to '
  'be extracted from.';

grant select on public.v_question_coverage to Porcupine_app, authenticated;
