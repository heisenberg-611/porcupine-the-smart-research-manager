-- Phase 2b — dual extraction and reconciliation.
--
-- Two people extract the same paper without seeing each other's answers,
-- disagreements are surfaced, and a THIRD person resolves them. That third
-- person is the entire point: a disagreement resolved by one of the two
-- parties to it is not a reconciliation, it is one extractor winning.
--
-- No new tables. `Extraction.reconciledFrom`, `verifiedBy`, and the
-- IN_CONFLICT / RECONCILED statuses were declared in week 1 precisely so this
-- phase would need no migration of the data model — only rules and reads.

-- ═══════════ Agreement, in SQL ══════════════════════════════════════════════
--
-- Mirrors `valuesAgree` in packages/shared/src/agreement.ts, which is the
-- readable authority; 10_agreement_parity.sql asserts the two agree on the
-- same cases the TypeScript tests use.
--
-- Duplicated deliberately. The reconciliation queue counts disagreements
-- across every dual-extracted paper — 300 papers x 20 fields x 2 extractors is
-- 12,000 rows — and shipping that to the browser to compare it there is the
-- same mistake the evidence table avoided in week 4.

create or replace function public.agreement_norm(p_value jsonb)
returns text
language sql
immutable
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' then ''
    when jsonb_typeof(p_value) = 'string'  then lower(btrim(p_value #>> '{}'))
    when jsonb_typeof(p_value) = 'number'  then p_value #>> '{}'
    when jsonb_typeof(p_value) = 'boolean' then p_value #>> '{}'
    -- Sorted and joined with U+0001, which cannot appear in extracted text.
    -- Order is a UI artefact, not an answer.
    when jsonb_typeof(p_value) = 'array' then (
      select coalesce(string_agg(part, chr(1) order by part), '')
      from (
        select public.agreement_norm(elem) as part
        from jsonb_array_elements(p_value) elem
      ) parts
    )
    else p_value::text
  end;
$$;

comment on function public.agreement_norm is
  'Canonical comparison form of an extracted value. Mirrors normalise() in '
  'packages/shared/src/agreement.ts — see 10_agreement_parity.sql.';

create or replace function public.agreement_number(p_value jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when p_value is null then null
    when jsonb_typeof(p_value) = 'number' then (p_value #>> '{}')::numeric
    when jsonb_typeof(p_value) = 'string'
         and btrim(p_value #>> '{}') ~ '^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$'
      then btrim(p_value #>> '{}')::numeric
    else null
  end;
$$;

create or replace function public.agreement_boolean(p_value jsonb)
returns text
language sql
immutable
as $$
  select case
    when p_value is null then null
    when jsonb_typeof(p_value) = 'boolean' then p_value #>> '{}'
    when lower(btrim(coalesce(p_value #>> '{}', ''))) in ('true', 'yes') then 'true'
    when lower(btrim(coalesce(p_value #>> '{}', ''))) in ('false', 'no') then 'false'
    else public.agreement_norm(p_value)
  end;
$$;

create or replace function public.values_agree(
  p_type "FieldType",
  p_a jsonb,
  p_b jsonb
)
returns boolean
language sql
immutable
as $$
  select case
    -- Two holes are NOT an agreement. Neither extractor answered, so there is
    -- nothing to agree about, and counting it would inflate every score on a
    -- half-finished review.
    when p_a is null or p_b is null then false
    when jsonb_typeof(p_a) = 'null' or jsonb_typeof(p_b) = 'null' then false

    when p_type = 'NUMBER' then
      case
        when public.agreement_number(p_a) is not null
         and public.agreement_number(p_b) is not null
          then public.agreement_number(p_a) = public.agreement_number(p_b)
        else public.agreement_norm(p_a) = public.agreement_norm(p_b)
      end

    when p_type = 'BOOLEAN' then
      public.agreement_boolean(p_a) = public.agreement_boolean(p_b)

    else
      -- ENUM, MULTI_ENUM (set equality falls out of the sorted normal form),
      -- TEXT, LONG_TEXT, DATE, QUOTE, CITATION, URL.
      public.agreement_norm(p_a) = public.agreement_norm(p_b)
  end;
$$;

grant execute on function public.agreement_norm    to porcupine_app, authenticated;
grant execute on function public.agreement_number  to porcupine_app, authenticated;
grant execute on function public.agreement_boolean to porcupine_app, authenticated;
grant execute on function public.values_agree      to porcupine_app, authenticated;

-- ═══════════ Rule: a reconciliation must name what it reconciled ════════════
--
-- Without this, `status = 'RECONCILED'` is a label anyone can apply to an
-- ordinary extraction, and the audit trail that makes dual extraction worth
-- doing evaporates: nothing records which two readings were combined, or by
-- whom.

create or replace function public.enforce_reconciliation_provenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sources     integer;
  v_bad_paper   integer;
  v_bad_status  integer;
  v_verifier_is_party integer;
begin
  if new.status not in ('RECONCILED', 'VERIFIED') then
    return new;
  end if;

  select count(distinct s) into v_sources
  from unnest(coalesce(new.reconciled_from, '{}'::uuid[])) s;

  if v_sources < 2 then
    raise exception
      'A reconciled extraction must record the two extractions it was drawn '
      'from. Set reconciled_from.'
      using errcode = 'check_violation';
  end if;

  if new.verified_by is null then
    raise exception
      'A reconciled extraction must record who verified it.'
      using errcode = 'check_violation';
  end if;

  -- The sources must be extractions of the SAME paper under the SAME
  -- protocol. Otherwise two unrelated readings can be declared reconciled and
  -- the resulting row means nothing at all.
  select count(*) into v_bad_paper
  from public.extractions e
  where e.id = any(new.reconciled_from)
    and (e.project_work_id <> new.project_work_id
         or e.protocol_id <> new.protocol_id);

  if v_bad_paper > 0 then
    raise exception
      'Every reconciled source must be an extraction of the same paper under '
      'the same protocol.'
      using errcode = 'check_violation';
  end if;

  -- A draft is working state, not a reading. Reconciling one would fold
  -- somebody's half-finished notes into a finding.
  select count(*) into v_bad_status
  from public.extractions e
  where e.id = any(new.reconciled_from)
    and e.status = 'DRAFT';

  if v_bad_status > 0 then
    raise exception
      'A draft extraction cannot be reconciled. It has not been submitted yet.'
      using errcode = 'check_violation';
  end if;

  -- ── The rule that carries the method ──────────────────────────────────────
  --
  -- The verifier must not be one of the two extractors. A disagreement
  -- resolved by a party to it is not a reconciliation; it is one extractor
  -- overruling the other with extra steps, and reporting it as reconciled
  -- would misrepresent how the finding was reached.
  select count(*) into v_verifier_is_party
  from public.extractions e
  where e.id = any(new.reconciled_from)
    and (e.extractor_id = new.verified_by or e.extractor_id = new.extractor_id);

  if v_verifier_is_party > 0 then
    raise exception
      'The person reconciling a disagreement cannot be one of the two people '
      'who disagreed. A third reader has to resolve it.'
      using errcode = 'check_violation';
  end if;

  -- ── A confusing constraint, explained ─────────────────────────────────────
  --
  -- `extractions` is unique on (project_work_id, protocol_id, extractor_id),
  -- and a reconciliation is stored as a row authored by the verifier. So a
  -- verifier who has their own extraction of this paper — even an untouched
  -- draft they started and abandoned — collides with themselves.
  --
  -- The constraint is right and the rule behind it is right: someone who has
  -- extracted the paper is a third READER, not a neutral adjudicator. What is
  -- wrong is being told so by a raw 23505 naming a unique index. This says it
  -- in words, and BEFORE triggers run ahead of constraint checks, so this is
  -- the message that actually surfaces.
  if exists (
    select 1 from public.extractions e
    where e.project_work_id = new.project_work_id
      and e.protocol_id = new.protocol_id
      and e.extractor_id = new.extractor_id
      and e.id <> new.id
  ) then
    raise exception
      'You already have your own extraction of this paper, so you cannot also '
      'reconcile it — that would make you a third reader rather than an '
      'independent one. Ask someone who has not extracted it.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger extractions_reconciliation_provenance
  before insert or update on public.extractions
  for each row execute function public.enforce_reconciliation_provenance();

-- ═══════════ Rule: dual extraction is a review-only capability ══════════════
--
-- capabilities(kind).dualExtraction in packages/shared. Same shape as
-- enforce_exclusion_reason: the database refuses rather than trusting that
-- every screen remembered to check. A thesis project has one reader by
-- definition, and a RECONCILED row there would be a fiction.

create or replace function public.enforce_dual_extraction_capability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kind "ProjectKind";
begin
  if new.status not in ('RECONCILED', 'VERIFIED') then
    return new;
  end if;

  select p.kind into v_kind from public.projects p where p.id = new.project_id;

  if v_kind <> 'SYSTEMATIC_REVIEW' then
    raise exception
      'Dual extraction and reconciliation are available on systematic reviews. '
      'This project is a %.', v_kind
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger extractions_dual_extraction_capability
  before insert or update on public.extractions
  for each row execute function public.enforce_dual_extraction_capability();

-- ═══════════ The pair, and where it disagrees ═══════════════════════════════
--
-- Dual extraction means exactly two independent readings. Where more than two
-- exist, the two EARLIEST are the pair — later ones are re-extractions and
-- folding them in would silently change what was reconciled.
--
-- Reconciled rows are excluded from the pool by `cardinality(...) = 0`, or a
-- reconciliation would immediately become a candidate for reconciliation.

create or replace view public.v_dual_extraction_pairs
with (security_invoker = true) as
  with independent as (
    select
      e.*,
      row_number() over (
        partition by e.project_work_id, e.protocol_id
        order by e.created_at, e.id
      ) as rn
    from public.extractions e
    where e.status in ('SUBMITTED', 'IN_CONFLICT')
      and cardinality(coalesce(e.reconciled_from, '{}'::uuid[])) = 0
  )
  select
    a.project_id,
    a.project_work_id,
    a.protocol_id,
    a.id          as extraction_a,
    a.extractor_id as extractor_a,
    b.id          as extraction_b,
    b.extractor_id as extractor_b
  from independent a
  join independent b
    on  b.project_work_id = a.project_work_id
    and b.protocol_id     = a.protocol_id
    and b.rn = 2
  where a.rn = 1
    -- Two readings by the same person are not independent. The unique
    -- constraint already prevents it; this says so where it is relied upon.
    and a.extractor_id <> b.extractor_id;

grant select on public.v_dual_extraction_pairs to porcupine_app, authenticated;

create or replace view public.v_extraction_disagreements
with (security_invoker = true) as
  select
    p.project_id,
    p.project_work_id,
    p.protocol_id,
    p.extraction_a,
    p.extraction_b,
    p.extractor_a,
    p.extractor_b,
    f.id     as field_id,
    f.key    as field_key,
    f.label  as field_label,
    f.type   as field_type,
    f."order" as field_order,
    va.value      as value_a,
    va.value_text as text_a,
    va.anchor_id  as anchor_a,
    vb.value      as value_b,
    vb.value_text as text_b,
    vb.anchor_id  as anchor_b,
    public.values_agree(f.type, va.value, vb.value) as agree,
    -- Distinguishes "they disagree" from "nobody has answered this yet". A
    -- queue that treats an unanswered field as a conflict sends people to
    -- adjudicate nothing.
    (va.value is not null or vb.value is not null) as answered_by_either
  from public.v_dual_extraction_pairs p
  join public.protocol_fields f on f.protocol_id = p.protocol_id
  left join public.extraction_values va
    on va.extraction_id = p.extraction_a and va.field_id = f.id
  left join public.extraction_values vb
    on vb.extraction_id = p.extraction_b and vb.field_id = f.id;

grant select on public.v_extraction_disagreements to porcupine_app, authenticated;

create or replace view public.v_reconciliation_queue
with (security_invoker = true) as
  select
    d.project_id,
    d.project_work_id,
    d.protocol_id,
    d.extraction_a,
    d.extraction_b,
    d.extractor_a,
    d.extractor_b,
    w.title as work_title,
    count(*) filter (where d.answered_by_either and not d.agree)::int as disagreements,
    count(*) filter (where d.agree)::int as agreements,
    count(*)::int as field_total,
    exists (
      select 1 from public.extractions r
      where r.project_work_id = d.project_work_id
        and r.protocol_id = d.protocol_id
        and r.status in ('RECONCILED', 'VERIFIED')
    ) as reconciled
  from public.v_extraction_disagreements d
  join public.project_works pw on pw.id = d.project_work_id
  join public.works w on w.id = pw.work_id
  group by
    d.project_id, d.project_work_id, d.protocol_id,
    d.extraction_a, d.extraction_b, d.extractor_a, d.extractor_b, w.title;

comment on view public.v_reconciliation_queue is
  'One row per dual-extracted paper: how many fields the two readings agree '
  'on, how many they disagree on, and whether a third reader has resolved it.';

grant select on public.v_reconciliation_queue to porcupine_app, authenticated;
