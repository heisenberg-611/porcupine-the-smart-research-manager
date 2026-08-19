-- File storage, stage 1: the boundary, before any interface.
--
-- docs/12-file-storage-build-plan.md §3 and §4. Nothing in this migration is
-- reachable from the UI yet, and that is the point: the access-control rule
-- lands and is tested before there is anything to upload.
--
-- The decision this encodes (plan §2) is that file authorization is a database
-- policy rather than application code. The original design put it in a
-- Cloudflare Worker that validated a JWT and issued presigned URLs; ADR-019
-- moved the app to Vercel and that Worker never existed. Rehoming it in a
-- route handler would have made file access the only security boundary here
-- that RLS does not enforce and pgTAP cannot test — guarding the one asset
-- where a mistake is a copyright incident as well as a privacy one.

-- ── §3. Rename the enum before a single row exists ───────────────────────────
--
-- `Residency` named a vendor that is no longer the plan. `file_objects` has
-- zero rows today, so this costs one statement; after the first upload it
-- costs a data migration and every call site. There are no code call sites of
-- these labels — only comments and docs — which is exactly why now is the
-- moment.
--
-- RENAME VALUE keeps the label's OID, so the column default that reads
-- 'R2_USER'::"Residency" follows the rename rather than dangling.
alter type "Residency" rename value 'R2_SHARED' to 'SHARED';
alter type "Residency" rename value 'R2_USER' to 'PRIVATE';

-- ── The path is the access-control key ───────────────────────────────────────
--
-- Objects live at {projectId}/{fileId}.pdf, which lets a storage policy ask
-- the same question every other policy in this schema asks:
-- is_project_member(project_id).
--
-- The cast has to be total. `(storage.foldername(name))[1]::uuid` raises
-- 22P02 on any object whose first path segment is not a UUID, and a policy
-- that raises does not deny a row — it fails the whole query, for every user,
-- until someone finds the object. A single malformed key inserted by
-- service_role or by a restore would take the bucket down for everyone.
--
-- So the shape is checked before the cast and a non-conforming name yields
-- NULL, which is_project_member() answers false to. Verified against an
-- object literally named 'not-a-uuid/f3.pdf': invisible to every role, and no
-- error.
create or replace function public.storage_project_id(p_name text)
returns uuid
language sql
immutable
parallel safe
set search_path to pg_catalog
as $$
  select case
    when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
    then substring(p_name from 1 for 36)::uuid
  end;
$$;

comment on function public.storage_project_id(text) is
  'The project a storage key belongs to, or NULL if the key is not {uuid}/... '
  'Total by construction: a policy that can raise is a policy that can take '
  'the bucket down rather than deny a row.';

-- ── The bucket ───────────────────────────────────────────────────────────────
--
-- Private. `public = true` on a Supabase bucket serves every object to anyone
-- holding the URL, with no policy consulted at all — which for paywalled
-- publisher PDFs is a copyright incident, not a preference (R-04).
--
-- The MIME allow-list and size cap are the storage service's own checks, so
-- they hold even if an upload skips the app entirely. They are NOT the whole
-- validation story: both the extension and the declared content type are
-- attacker-controlled, so stage 2 still checks the magic bytes (%PDF-) at the
-- boundary. This is defence the client cannot talk its way past.
--
-- 50 MiB matches supabase/config.toml:118 for the local stack. Plan §9: the
-- hosted project has its own limit set in the dashboard, and the two must
-- agree or local testing proves nothing about production.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('papers', 'papers', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ── The policies ─────────────────────────────────────────────────────────────
--
-- Deliberately mirrors project_works, because a paper's PDF is the same asset
-- as the paper's row and splitting the rule would mean two answers to one
-- question:
--   read   → any member
--   write  → OWNER, ADMIN, CONTRIBUTOR
--
-- Targeting PUBLIC rather than `to authenticated` follows every other policy
-- in this schema: the role is not the authorization, the `sub` claim is.
-- is_project_member() returns false when there is no claim, so anon and an
-- unauthenticated porcupine_app connection both see nothing.
drop policy if exists papers_select_member on storage.objects;
create policy papers_select_member on storage.objects
  for select
  using (
    bucket_id = 'papers'
    and public.is_project_member(public.storage_project_id(name))
  );

drop policy if exists papers_insert_contributor on storage.objects;
create policy papers_insert_contributor on storage.objects
  for insert
  with check (
    bucket_id = 'papers'
    and public.has_project_role(
      public.storage_project_id(name),
      array['OWNER', 'ADMIN', 'CONTRIBUTOR']::"AccessRole"[]
    )
  );

-- Both halves. Without USING, an update could not find the row to change;
-- without WITH CHECK, it could rewrite `name` to another project's prefix and
-- hand the object across a tenant boundary.
drop policy if exists papers_update_contributor on storage.objects;
create policy papers_update_contributor on storage.objects
  for update
  using (
    bucket_id = 'papers'
    and public.has_project_role(
      public.storage_project_id(name),
      array['OWNER', 'ADMIN', 'CONTRIBUTOR']::"AccessRole"[]
    )
  )
  with check (
    bucket_id = 'papers'
    and public.has_project_role(
      public.storage_project_id(name),
      array['OWNER', 'ADMIN', 'CONTRIBUTOR']::"AccessRole"[]
    )
  );

drop policy if exists papers_delete_contributor on storage.objects;
create policy papers_delete_contributor on storage.objects
  for delete
  using (
    bucket_id = 'papers'
    and public.has_project_role(
      public.storage_project_id(name),
      array['OWNER', 'ADMIN', 'CONTRIBUTOR']::"AccessRole"[]
    )
  );
