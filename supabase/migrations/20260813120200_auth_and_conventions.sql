-- ═══════════════════════════════════════════════════════════════════════════
-- Auth integration, mutation hygiene, and the FTS language convention.
--
-- Three unrelated-looking things belong in one migration because each must
-- exist before any row does:
--   1. public.users must appear the moment auth.users does, or a signed-in
--      user has a session and no profile.
--   2. updated_at must be enforced in the database — supabase-js writes go
--      through PostgREST and never touch Prisma's @updatedAt.
--   3. The tsvector convention (R-14) must be settled before the first
--      searchable table exists. Retrofitting a generated column across a
--      large table is an outage, so we encode the decision now and Phase 1
--      inherits it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────── 1. Profile row follows the auth row ─────────────────────

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.users (id, email, display_name, avatar_url, created_at, updated_at)
  values (
    new.id,
    new.email,
    -- Prefer what the identity provider gave us; fall back to the local part
    -- of the email. Never null: display_name is NOT NULL and a signup that
    -- half-succeeds is worse than one that fails loudly.
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, 'researcher'), '@', 1)
    ),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    now(),
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Creates the public.users profile when an auth.users row appears. '
  'SECURITY DEFINER because auth.users triggers run without a claim.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Keep email in sync when the user changes it upstream.
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.users
       set email = new.email, updated_at = now()
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();

-- ───────────────── 2. updated_at enforced in the database ──────────────────
-- Prisma's @updatedAt is client-side only. Reads go through supabase-js and
-- writes may too, so the guarantee has to live in Postgres or it is not a
-- guarantee.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'organizations', 'projects', 'project_members'
  ]
  loop
    execute format(
      'drop trigger if exists touch_%1$s_updated_at on public.%1$I', t
    );
    execute format(
      'create trigger touch_%1$s_updated_at
         before update on public.%1$I
         for each row execute function public.touch_updated_at()', t
    );
  end loop;
end
$$;

-- ───────────────── 3. FTS language convention (R-14) ───────────────────────
-- `to_tsvector('english', …)` stems incorrectly for every other language and
-- mangles CJK entirely. Research is not English-only, so `simple` is the
-- default and a per-row language upgrades it when we actually know.
--
-- This helper is IMMUTABLE so it can back a generated column — which is the
-- whole point of settling it now rather than in Phase 1.

create or replace function public.text_search_config(lang text)
returns regconfig
language sql
immutable
strict
parallel safe
as $$
  -- Map an ISO-639-1 code to a Postgres config, defaulting to `simple`
  -- (no stemming, no stopwords) rather than guessing wrong.
  select case lower(coalesce(lang, ''))
    when 'en' then 'english'::regconfig
    when 'fr' then 'french'::regconfig
    when 'de' then 'german'::regconfig
    when 'es' then 'spanish'::regconfig
    when 'pt' then 'portuguese'::regconfig
    when 'it' then 'italian'::regconfig
    when 'nl' then 'dutch'::regconfig
    when 'ru' then 'russian'::regconfig
    when 'da' then 'danish'::regconfig
    when 'fi' then 'finnish'::regconfig
    when 'hu' then 'hungarian'::regconfig
    when 'no' then 'norwegian'::regconfig
    when 'sv' then 'swedish'::regconfig
    when 'tr' then 'turkish'::regconfig
    else 'simple'::regconfig
  end;
$$;

comment on function public.text_search_config(text) is
  'R-14: maps a language code to a text search configuration, defaulting to '
  '`simple`. IMMUTABLE so generated tsvector columns can call it. Phase 1 '
  'must use this rather than hardcoding ''english''.';

create or replace function public.build_tsvector(lang text, body text)
returns tsvector
language sql
immutable
parallel safe
as $$
  select to_tsvector(public.text_search_config(lang), coalesce(body, ''));
$$;

comment on function public.build_tsvector(text, text) is
  'R-14: language-aware tsvector for generated columns. Never call '
  'to_tsvector(''english'', …) directly — see docs/05-resolution-plan.md R-14.';

grant execute on function public.text_search_config(text) to Porcupine_app, authenticated, anon;
grant execute on function public.build_tsvector(text, text) to Porcupine_app, authenticated, anon;
