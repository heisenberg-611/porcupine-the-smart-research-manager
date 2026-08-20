-- File storage, stage 2: upload, and the two ways an upload half-happens.
--
-- docs/12-file-storage-build-plan.md §5. Bytes go straight from the browser to
-- Supabase Storage under the user's own JWT, so they never pass through a
-- Vercel function and neither the body-size nor the duration limit applies.
--
-- The cost of that is that the app is not in the path. An upload can succeed
-- without it hearing, and it can hear about one that never succeeded, so the
-- row and the bytes can disagree in both directions. `UploadState` exists for
-- exactly this; what it needed was something to resolve it.

-- ── The metadata row and the object must agree about who may write ───────────
--
-- `file_objects_insert_own` asked for membership; the storage policy added in
-- stage 1 asks for OWNER/ADMIN/CONTRIBUTOR, mirroring project_works. A
-- REVIEWER therefore sat in the gap: allowed to create the row, refused the
-- bytes, leaving a PENDING row that could never complete and that the
-- reconciler below would sweep to ORPHANED an hour later.
--
-- The rule is one rule. Where a file may live is decided in one place, and
-- both halves ask the same question.
drop policy if exists file_objects_insert_own on public.file_objects;
create policy file_objects_insert_own on public.file_objects
  for insert
  with check (
    owner_id = public.current_user_id()
    and (
      project_id is null
      or public.has_project_role(
        project_id,
        array['OWNER', 'ADMIN', 'CONTRIBUTOR']::"AccessRole"[]
      )
    )
  );

-- ── Rows whose bytes never arrived ───────────────────────────────────────────
--
-- A PENDING row older than the grace period means the browser asked for an
-- upload and the app never heard how it went — the tab closed, the network
-- dropped, the confirming action failed. It says nothing about whether the
-- BYTES arrived, so the caller checks storage before deciding; this only says
-- which rows are worth checking.
--
-- Ids and paths, nothing else, in the shape of due_account_deletions() and for
-- the same reason: a cron has no claim, an ordinary read is filtered to
-- nothing by RLS, and a definer function that returns more than the caller
-- needs is a bypass waiting to be reused.
create or replace function public.stale_pending_uploads(p_older_than interval default '1 hour')
returns table (id uuid, owner_id uuid, bucket text, storage_path text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select f.id, f.owner_id, f.bucket, f.storage_path
  from public.file_objects f
  where f.upload_state = 'PENDING'
    and f.created_at < now() - p_older_than
  order by f.created_at
  -- Bounded like its neighbour: what one run does not reach, the next does.
  limit 200;
$$;

comment on function public.stale_pending_uploads(interval) is
  'PENDING file_objects old enough that the app has plainly lost track of them. Ids and paths only.';

revoke execute on function public.stale_pending_uploads(interval) from public;
grant execute on function public.stale_pending_uploads(interval) to Porcupine_app;

-- ── Bytes whose row never arrived ────────────────────────────────────────────
--
-- The other direction, and the one that costs money rather than tidiness: an
-- object in the bucket that no `file_objects` row claims. Nothing in the app
-- can see it, nothing will ever delete it, and it counts against the storage
-- quota forever.
--
-- This is the query that justifies the whole backend decision. Under the
-- original R2 design, finding these meant paginating a bucket listing and
-- joining it to the database in application memory. `storage.objects` is a
-- Postgres table, so it is an anti-join.
--
-- The age filter is not politeness — it is correctness. An upload in flight
-- has its object written before the completing action runs, so without a grace
-- period this function would name files that are seconds away from being
-- claimed, and the reconciler would delete them out from under a user who is
-- still watching the progress bar.
create or replace function public.orphaned_paper_objects(p_older_than interval default '1 hour')
returns table (name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'papers'
    and o.created_at < now() - p_older_than
    and not exists (
      select 1
      from public.file_objects f
      where f.bucket = 'papers'
        and f.storage_path = o.name
    )
  order by o.created_at
  limit 200;
$$;

comment on function public.orphaned_paper_objects(interval) is
  'Objects in the papers bucket that no file_objects row claims. Names only; the caller deletes them through the Storage API.';

revoke execute on function public.orphaned_paper_objects(interval) from public;
grant execute on function public.orphaned_paper_objects(interval) to Porcupine_app;
