-- ═══════════════════════════════════════════════════════════════════════════
-- A guard written for an editing screen was also running inside a cascade.
--
-- `protect_answered_field` refuses to delete a protocol field that has
-- recorded answers, and telling someone to make a new protocol version rather
-- than silently changing what a column in their export means is exactly right
-- — when they are EDITING THE PROTOCOL.
--
-- It also fired when the whole project was deleted, because that cascades to
-- protocols and then to protocol_fields. So:
--
--     delete from projects where id = ...
--     ERROR: The field "Primary outcome" has 1 recorded answer(s).
--            Create a new protocol version rather than deleting it.
--
-- A project with any extracted answer in it could not be deleted at all, and
-- the reason given named a protocol field the user had not touched and advice
-- ("create a new version") that has nothing to do with deleting a project.
-- The sibling of the anchor bug in the previous migration, from the same
-- cause: a rule about an interactive edit, enforced against a cascade.
--
-- ── How the two cases are told apart ────────────────────────────────────────
--
-- `protocol_fields.protocol_id` is ON DELETE CASCADE, and Postgres deletes the
-- referenced row BEFORE cascading to the children. So when this trigger fires:
--
--   * the parent protocol still exists  → someone is editing a live protocol,
--                                          and the guard applies;
--   * the parent protocol is gone       → this is the cascade cleaning up
--                                          after it, and there is no live
--                                          protocol left to protect.
--
-- That is a fact about cascade ordering rather than a guess: assertion 9 of
-- 12_anchor_provenance.sql deletes a project holding a live answer, and it
-- fails if the ordering is ever other than this.
--
-- Deliberately NOT weakened to "allow deletes when no one is looking": the
-- interactive path is unchanged, and 08_extraction.sql still asserts a field
-- with answers cannot be deleted out from under a live protocol.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.protect_answered_field()
returns trigger
language plpgsql
as $$
declare
  v_count integer;
begin
  -- The protocol is already gone: this row is being cleaned up by the cascade
  -- that removed it, not deleted by anyone. Nothing to protect.
  if not exists (select 1 from public.protocols p where p.id = old.protocol_id) then
    return old;
  end if;

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

comment on function public.protect_answered_field() is
  'Refuses to delete an answered protocol field from a LIVE protocol. Yields '
  'when the parent protocol is already gone, which is the cascade from a '
  'deleted project. See 20260815091000_guards_yield_to_cascade.sql.';
