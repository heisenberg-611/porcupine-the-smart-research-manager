-- Phase 2 — protocol integrity.
--
-- `01-data-model.md` §5: "ProtocolField.key is immutable once any
-- ExtractionValue references it. Changing a field means a new
-- Protocol.version plus an explicit UI migration prompt."
--
-- I left this out of the previous slice. Worth stating why it matters, since
-- the foreign key makes it look unnecessary: ExtractionValue points at the
-- field's UUID, so renaming `key` does not reassign any recorded answer. The
-- damage is downstream. `key` is the machine name — the CSV column header,
-- the identifier in an export, the thing a statistician joins on. Rename it
-- after data exists and two exports of the same review disagree about what a
-- column is called, with nothing in either file saying so.

create or replace function public.freeze_referenced_field_key()
returns trigger
language plpgsql
as $$
begin
  if new.key = old.key then
    return new;
  end if;

  if exists (select 1 from public.extraction_values v where v.field_id = old.id) then
    raise exception
      'The key "%" is already used by recorded answers and cannot be renamed. '
      'Create a new protocol version instead.', old.key
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger protocol_fields_freeze_referenced_key
  before update of key on public.protocol_fields
  for each row execute function public.freeze_referenced_field_key();

-- ── The same protection for the field itself ────────────────────────────────
--
-- Deleting a field cascades its values away. That is correct for a protocol
-- still being drafted and catastrophic for one being used: it silently
-- removes a column from every row of an evidence table, and the rows that
-- remain look complete.
--
-- The cascade stays for the draft case; this refuses the used case.

create or replace function public.protect_answered_field()
returns trigger
language plpgsql
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.extraction_values v
  where v.field_id = old.id;

  if v_count > 0 then
    raise exception
      'The field "%" has % recorded answer(s). Create a new protocol version '
      'rather than deleting it.', old.label, v_count
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

create trigger protocol_fields_protect_answered
  before delete on public.protocol_fields
  for each row execute function public.protect_answered_field();

-- ── Field type and options agree ────────────────────────────────────────────
--
-- An ENUM field with no options is a dropdown with nothing in it: the
-- extractor cannot answer, and the protocol looks finished. Cheap to check
-- here, and impossible to get wrong later.

create or replace function public.enforce_field_options()
returns trigger
language plpgsql
as $$
begin
  if new.type in ('ENUM', 'MULTI_ENUM') then
    if new.options is null
       or jsonb_typeof(new.options) <> 'array'
       or jsonb_array_length(new.options) = 0 then
      raise exception
        'The field "%" is a choice field and needs at least one option.', new.label
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger protocol_fields_require_options
  before insert or update on public.protocol_fields
  for each row execute function public.enforce_field_options();
