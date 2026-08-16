-- 1. Update enforce_value_anchor to allow 'Not reported' without an anchor
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

  if coalesce(v_requires, false) and new.anchor_id is null and (new.value_text is null or new.value_text != 'Not reported') then
    raise exception
      'The field "%" requires a quoted passage from the source.', v_label
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- 2. Update evidence_rows to exclude DRAFT extractions
create or replace function public.evidence_rows(
  p_project_id       uuid,
  p_protocol_id      uuid,
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
      jsonb_object_agg(
        v.field_key,
        jsonb_build_object(
          'value',    v.value,
          'text',     v.value_text,
          'anchorId', v.anchor_id,
          'type',     v.field_type::text,
          'label',    v.field_label,
          'answered', v.value is not null
        )
        order by v.field_order
      ) as cells,
      count(*) filter (where v.value is not null)::int as answered,
      count(*)::int as field_total,
      max(
        case
          when p_sort = 'field:' || v.field_key
           and v.field_type::text = 'NUMBER'
           and (v.value #>> '{}') ~ '^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$'
          then (trim(v.value #>> '{}'))::numeric
        end
      ) as sort_val_num,
      max(
        case when p_sort = 'field:' || v.field_key then lower(v.value_text) end
      ) as sort_val_text,
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
      and v.status <> 'DRAFT'
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
    lower(o.work_title) asc,
    o.extraction_id asc
  limit greatest(coalesce(p_limit, 100), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- 3. Update v_question_coverage to exclude DRAFT extractions
create or replace view public.v_question_coverage
with (security_invoker = true) as
  with included as (
    select pw.id, pw.project_id
    from public.project_works pw
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
      and e.status <> 'DRAFT'
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
