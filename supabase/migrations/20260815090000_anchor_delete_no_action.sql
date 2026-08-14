-- ═══════════════════════════════════════════════════════════════════════════
-- The schema and the trigger disagreed about what a quote is.
--
-- `extraction_values.anchor_id` was `on delete set null` — Prisma's default
-- for an optional relation, which means nobody chose it. `enforce_value_anchor`
-- meanwhile is a BEFORE INSERT OR UPDATE trigger refusing any value on a
-- `requires_anchor` field whose anchor_id is null.
--
-- So deleting an anchor fired the cascade's `update extraction_values set
-- anchor_id = null`, the trigger vetoed the update it had just been handed,
-- and the whole delete failed with:
--
--     The field "Primary outcome" requires a quoted passage from the source.
--
-- A message about a field the user was not editing, raised by a delete they
-- did not know touched it. Found by `pnpm db:seed` on its second run:
-- re-seeding deletes the previous demo project, and the cascade could not get
-- past its own trigger.
--
-- WHICH SIDE IS RIGHT: the trigger. A QUOTE field exists precisely so an
-- answer is traceable to the passage it came from — that is the whole argument
-- for a field type you cannot type into. `set null` quietly converts a
-- traceable answer into an untraceable one, which is the outcome the field
-- type was invented to prevent. The app already has a concept for "the passage
-- moved or vanished": `anchors.status` = DRIFTED / BROKEN. Deletion is not it.
--
-- ── Why DEFERRABLE, which is the part that is easy to get wrong ─────────────
--
-- The invariant is not "you may never delete an anchor". It is:
--
--     at the end of the transaction, no answer cites a passage that is gone.
--
-- Those differ, and the difference is a whole project. Deleting a project
-- cascades to anchors AND to extractions → extraction_values, in an order
-- Postgres does not promise. With an IMMEDIATE constraint the anchors can go
-- first, and the delete fails against rows that were themselves about to be
-- deleted in the same statement. Making projects undeletable is not a
-- provenance rule, it is a leak with a justification.
--
-- `no action` alone does NOT fix that — the first draft of this migration
-- assumed it did. `no action` and `restrict` differ only in whether other
-- triggers get to run first; both are checked immediately unless the
-- constraint is deferrable. `deferrable initially deferred` is what actually
-- moves the check to COMMIT, which is where the invariant is stated.
--
-- The cost is that deleting a cited passage now fails at commit rather than at
-- the statement. Under PostgREST every request is one transaction, so the
-- caller still sees a failed request; only the moment moves.
--
-- Sabotage checks for whoever revisits this — 12_anchor_provenance.sql:
--   * put `set null` back        → assertion 2 goes red
--   * drop `deferrable`          → assertion 9 goes red (projects stop deleting)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.extraction_values
  drop constraint extraction_values_anchor_id_fkey;

alter table public.extraction_values
  add constraint extraction_values_anchor_id_fkey
  foreign key (anchor_id) references public.anchors(id)
  on update cascade on delete no action
  deferrable initially deferred;

comment on constraint extraction_values_anchor_id_fkey on public.extraction_values is
  'Deferred, not SET NULL: a cited passage cannot be deleted out from under the '
  'answer that cites it, but a whole project still deletes in one statement '
  'because the check runs at commit. See 20260815090000_anchor_delete_no_action.sql.';
