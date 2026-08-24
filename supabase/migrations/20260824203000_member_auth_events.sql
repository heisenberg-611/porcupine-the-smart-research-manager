-- ═══════════════════════════════════════════════════════════════════════════
-- Member Auth Events: Permanent chronological audit log for login and logout
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.member_auth_events (
  id           uuid        not null default gen_random_uuid(),
  user_id      uuid        not null references public.users(id) on delete cascade on update cascade,
  event_type   text        not null check (event_type in ('LOGIN', 'LOGOUT')),
  action       text        not null,
  device_label text,
  created_at   timestamptz not null default now(),

  primary key (id)
);

comment on table public.member_auth_events is
  'Permanent chronological log of member authentication events (login, logout, session start, device unlock).';

create index if not exists member_auth_events_user_id_created_at_idx
  on public.member_auth_events(user_id, created_at desc);

alter table public.member_auth_events enable row level security;
alter table public.member_auth_events force row level security;

-- Users can insert their own events (or service context can insert)
drop policy if exists member_auth_events_insert_self on public.member_auth_events;
create policy member_auth_events_insert_self on public.member_auth_events
  for insert
  with check (user_id = public.current_user_id());

-- Project members can select auth events of members belonging to shared projects or their own
drop policy if exists member_auth_events_select on public.member_auth_events;
create policy member_auth_events_select on public.member_auth_events
  for select
  using (
    user_id = public.current_user_id()
    or exists (
      select 1
      from public.project_members pm1
      join public.project_members pm2 on pm1.project_id = pm2.project_id
      where pm1.user_id = public.current_user_id()
        and pm2.user_id = member_auth_events.user_id
        and pm1.removed_at is null
        and pm2.removed_at is null
    )
  );

grant select, insert, update, delete on public.member_auth_events to authenticated, anon, service_role, Porcupine_app;

-- Seed existing users' initial login records from users table so existing users have login entries immediately
insert into public.member_auth_events (user_id, event_type, action, device_label, created_at)
select
  u.id,
  'LOGIN',
  'Signed in to Porcupine',
  'Web Session',
  coalesce(u.created_at, now())
from public.users u
on conflict do nothing;

-- Notify PostgREST to refresh its schema cache immediately
notify pgrst, 'reload schema';
