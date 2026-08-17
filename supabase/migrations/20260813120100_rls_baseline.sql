-- ═══════════════════════════════════════════════════════════════════════════
-- RLS baseline — deny by default, fail closed.
--
-- This migration is the security boundary. Everything else in the app is a
-- convenience layer on top of it.
--
-- Design rules (docs/05-resolution-plan.md R-02):
--   1. Every table gets ENABLE + FORCE ROW LEVEL SECURITY. FORCE matters
--      because it applies policies to the table owner too, which is how a
--      migration-time mistake stops being a permanent hole.
--   2. Every policy predicate derives from request.jwt.claims. There is no
--      permissive fallback and no `OR true` anywhere in this file.
--   3. With no claim set, current_setting(..., true) returns NULL, the
--      predicate evaluates NULL, and every row is filtered. Empty result,
--      never another user's rows.
--   4. Porcupine_app has no BYPASSRLS. It is the role the app connects as.
--   5. Membership checks go through SECURITY DEFINER helpers so policies
--      never need a join — projectId is denormalized for exactly this reason.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── Application role ───────────────────────────────
-- The role the app connects as. Deliberately unprivileged: no BYPASSRLS, no
-- CREATEROLE, no SUPERUSER. Password is set per-environment, not here.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'Porcupine_app') then
    create role Porcupine_app nologin;
  end if;
end
$$;

alter role Porcupine_app nobypassrls;

-- Migration and test contexts need SET ROLE Porcupine_app so they can exercise
-- policies as the app sees them. Granting membership does NOT grant bypass —
-- postgres already outranks it. This is what lets pgTAP test the real role
-- instead of testing a superuser and proving nothing.
grant Porcupine_app to postgres;

grant usage on schema public to Porcupine_app;
grant select, insert, update, delete on all tables in schema public to Porcupine_app;
grant usage, select on all sequences in schema public to Porcupine_app;

alter default privileges in schema public
  grant select, insert, update, delete on tables to Porcupine_app;
alter default privileges in schema public
  grant usage, select on sequences to Porcupine_app;

-- Supabase's own roles need the same grants to reach these tables through
-- PostgREST. They remain subject to RLS.
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- ───────────────────────── Claim accessor helpers ───────────────────────────
-- Two claim sources must both work:
--   * PostgREST/supabase-js sets request.jwt.claims per request.
--   * Prisma sets it via withUserContext() as a transaction-local GUC.
-- Both land in the same GUC, so policies read one function and neither path
-- gets a special case.

create or replace function public.current_claims()
returns jsonb
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
$$;

comment on function public.current_claims() is
  'JWT claims for the current request, or NULL when unset. NULL propagates '
  'through every policy predicate, which is what makes RLS fail closed.';

create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(public.current_claims() ->> 'sub', '')::uuid;
$$;

comment on function public.current_user_id() is
  'Authenticated user id, or NULL when no claim is set.';

-- ──────────────────────── Membership helpers ────────────────────────────────
-- SECURITY DEFINER so a policy on project_members does not have to consult
-- project_members through its own policy — that recurses. Search path is
-- pinned so the definer rights cannot be hijacked by a mutable search_path.

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = public.current_user_id()
      and pm.removed_at is null
  );
$$;

comment on function public.is_project_member(uuid) is
  'True when the current claim identifies a non-removed member of the project.';

create or replace function public.has_project_role(
  p_project_id uuid,
  p_roles "AccessRole"[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = public.current_user_id()
      and pm.removed_at is null
      and pm.access_role = any(p_roles)
  );
$$;

comment on function public.has_project_role(uuid, "AccessRole"[]) is
  'True when the current user holds one of the given access roles on the project.';

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members om
    where om.org_id = p_org_id
      and om.user_id = public.current_user_id()
  );
$$;

-- These are called from policies, so every role that reads must execute them.
revoke execute on function public.is_project_member(uuid) from public;
revoke execute on function public.has_project_role(uuid, "AccessRole"[]) from public;
revoke execute on function public.is_org_member(uuid) from public;
grant execute on function public.current_claims() to Porcupine_app, authenticated, anon;
grant execute on function public.current_user_id() to Porcupine_app, authenticated, anon;
grant execute on function public.is_project_member(uuid) to Porcupine_app, authenticated;
grant execute on function public.has_project_role(uuid, "AccessRole"[]) to Porcupine_app, authenticated;
grant execute on function public.is_org_member(uuid) to Porcupine_app, authenticated;

-- ═══════════════════════════ Enable + FORCE RLS ═════════════════════════════

alter table public.users             enable row level security;
alter table public.users             force  row level security;
alter table public.devices           enable row level security;
alter table public.devices           force  row level security;
alter table public.organizations     enable row level security;
alter table public.organizations     force  row level security;
alter table public.org_members       enable row level security;
alter table public.org_members       force  row level security;
alter table public.projects          enable row level security;
alter table public.projects          force  row level security;
alter table public.project_members   enable row level security;
alter table public.project_members   force  row level security;
alter table public.project_keys      enable row level security;
alter table public.project_keys      force  row level security;

-- ═══════════════════════════════ Policies ═══════════════════════════════════
-- Named <table>_<verb>_<subject> so a failing pgTAP assertion names the policy.

-- ── users ───────────────────────────────────────────────────────────────────
-- You can read yourself, and anyone you share a project with (needed to render
-- member lists and, later, to fetch identity public keys for key wrapping).

create policy users_select_self_or_covisible on public.users
  for select
  using (
    id = public.current_user_id()
    or exists (
      select 1
      from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id
      where mine.user_id = public.current_user_id()
        and mine.removed_at is null
        and theirs.user_id = public.users.id
        and theirs.removed_at is null
    )
  );

create policy users_update_self on public.users
  for update
  using (id = public.current_user_id())
  with check (id = public.current_user_id());

-- No insert policy: rows are created by a trigger on auth.users signup.
-- No delete policy: account deletion is a service-context operation.

-- ── devices ─────────────────────────────────────────────────────────────────
-- Strictly private. A device row holds a wrapped Master Key; nobody else
-- ever has a reason to see one.

create policy devices_all_self on public.devices
  for all
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

-- ── organizations ───────────────────────────────────────────────────────────

create policy organizations_select_member on public.organizations
  for select
  using (public.is_org_member(id));

create policy organizations_update_admin on public.organizations
  for update
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = public.organizations.id
        and om.user_id = public.current_user_id()
        and om.role in ('OWNER', 'ADMIN')
    )
  )
  with check (
    exists (
      select 1 from public.org_members om
      where om.org_id = public.organizations.id
        and om.user_id = public.current_user_id()
        and om.role in ('OWNER', 'ADMIN')
    )
  );

-- ── org_members ─────────────────────────────────────────────────────────────

create policy org_members_select_covisible on public.org_members
  for select
  using (public.is_org_member(org_id));

create policy org_members_write_admin on public.org_members
  for all
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = public.org_members.org_id
        and om.user_id = public.current_user_id()
        and om.role in ('OWNER', 'ADMIN')
    )
  )
  with check (
    exists (
      select 1 from public.org_members om
      where om.org_id = public.org_members.org_id
        and om.user_id = public.current_user_id()
        and om.role in ('OWNER', 'ADMIN')
    )
  );

-- ── projects ────────────────────────────────────────────────────────────────

create policy projects_select_member on public.projects
  for select
  using (public.is_project_member(id) and deleted_at is null);

-- Anyone authenticated may create a project, but only as themselves. The
-- creator's OWNER membership row is created in the same transaction by the
-- application; a project with no members is invisible even to its creator,
-- which is the correct failure mode.
create policy projects_insert_self on public.projects
  for insert
  with check (
    created_by = public.current_user_id()
    and public.current_user_id() is not null
  );

create policy projects_update_admin on public.projects
  for update
  using (public.has_project_role(id, array['OWNER', 'ADMIN']::"AccessRole"[]))
  with check (public.has_project_role(id, array['OWNER', 'ADMIN']::"AccessRole"[]));

create policy projects_delete_owner on public.projects
  for delete
  using (public.has_project_role(id, array['OWNER']::"AccessRole"[]));

-- ── project_members ─────────────────────────────────────────────────────────

create policy project_members_select_member on public.project_members
  for select
  using (public.is_project_member(project_id));

-- Bootstrap case: the first membership row on a project the caller created
-- has no existing membership to check against, so it is allowed only when the
-- caller is both the project creator and the subject of the row.
create policy project_members_insert_admin_or_bootstrap on public.project_members
  for insert
  with check (
    public.has_project_role(project_id, array['OWNER', 'ADMIN']::"AccessRole"[])
    or (
      user_id = public.current_user_id()
      and exists (
        select 1 from public.projects p
        where p.id = project_id
          and p.created_by = public.current_user_id()
      )
      and not exists (
        select 1 from public.project_members existing
        where existing.project_id = project_members.project_id
      )
    )
  );

create policy project_members_update_admin on public.project_members
  for update
  using (public.has_project_role(project_id, array['OWNER', 'ADMIN']::"AccessRole"[]))
  with check (public.has_project_role(project_id, array['OWNER', 'ADMIN']::"AccessRole"[]));

create policy project_members_delete_admin on public.project_members
  for delete
  using (public.has_project_role(project_id, array['OWNER', 'ADMIN']::"AccessRole"[]));

-- ── project_keys ────────────────────────────────────────────────────────────
-- A member may read only the key wrapped TO them. Reading another member's
-- wrapped key is useless without their private identity key, but there is no
-- reason to expose it, and "no reason to expose it" is the whole rule.

create policy project_keys_select_own_wrap on public.project_keys
  for select
  using (user_id = public.current_user_id());

-- Members wrap keys for others during invite and rotation, so insert is
-- allowed to project members and attributed to the wrapper.
create policy project_keys_insert_member on public.project_keys
  for insert
  with check (
    public.is_project_member(project_id)
    and wrapped_by = public.current_user_id()
  );

-- No update and no delete policy, by design. Key epochs are append-only —
-- old ciphertext must stay readable at its own epoch forever. The ABSENCE
-- of a policy is the enforcement (docs/01-data-model.md §1 rule 5).
