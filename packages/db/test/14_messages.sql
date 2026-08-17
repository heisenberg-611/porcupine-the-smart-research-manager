-- Channels and messages — who can read, who can write, and what the server
-- can see.
--
-- Two claims are under test and they are different claims:
--
--   1. RLS scopes conversations to project members. That is ordinary and is
--      asserted the ordinary way, with mutation checks.
--
--   2. The stored bytes are OPAQUE. Encryption happens in the browser, so this
--      suite cannot verify a ciphertext — but it can verify that the plaintext
--      is not sitting next to it in a column somebody forgot about. A claim
--      about what the server cannot read should be checked against the server.
--
-- And the absences again: no UPDATE policy, no DELETE policy on either table.
-- An edited ciphertext is indistinguishable from a substituted one.

begin;
select plan(17);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('bb000000-0000-0000-0000-000000000001', 'msg-alice@test.dev', 'Alice', now(), now()),
  ('bb000000-0000-0000-0000-000000000002', 'msg-bob@test.dev',   'Bob',   now(), now()),
  ('bb000000-0000-0000-0000-000000000003', 'msg-mallory@test.dev','Mallory', now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('bb000000-0000-0000-0000-0000000000a1', 'msg-project', 'Talking', 'THESIS',
   'bb000000-0000-0000-0000-000000000001', now(), now()),
  -- A second project Mallory IS in, so "Mallory sees nothing" cannot pass just
  -- because Mallory sees nothing anywhere.
  ('bb000000-0000-0000-0000-0000000000a2', 'msg-other', 'Elsewhere', 'THESIS',
   'bb000000-0000-0000-0000-000000000003', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('bb000000-0000-0000-0000-0000000000b1', 'bb000000-0000-0000-0000-0000000000a1',
   'bb000000-0000-0000-0000-000000000001', 'OWNER', now(), now(), now()),
  ('bb000000-0000-0000-0000-0000000000b2', 'bb000000-0000-0000-0000-0000000000a1',
   'bb000000-0000-0000-0000-000000000002', 'CONTRIBUTOR', now(), now(), now()),
  ('bb000000-0000-0000-0000-0000000000b3', 'bb000000-0000-0000-0000-0000000000a2',
   'bb000000-0000-0000-0000-000000000003', 'OWNER', now(), now(), now());

-- ── Alice opens a channel and says something ────────────────────────────────

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"bb000000-0000-0000-0000-000000000001"}', true);

select lives_ok($$
  insert into channels (id, project_id, name_ct, epoch, created_by, updated_at)
  values ('bb000000-0000-0000-0000-0000000000d1',
          'bb000000-0000-0000-0000-0000000000a1',
          '\x0102'::bytea, 1, 'bb000000-0000-0000-0000-000000000001', now())
$$, 'a member can open a channel');

select throws_ok($$
  insert into channels (id, project_id, name_ct, epoch, created_by, updated_at)
  values ('bb000000-0000-0000-0000-0000000000d2',
          'bb000000-0000-0000-0000-0000000000a1',
          '\x0102'::bytea, 1, 'bb000000-0000-0000-0000-000000000002', now())
$$, '42501', null,
  'but cannot create one attributed to a colleague');

select lives_ok($$
  insert into messages (id, project_id, channel_id, author_id, epoch, ciphertext)
  values ('bb000000-0000-0000-0000-0000000000e1',
          'bb000000-0000-0000-0000-0000000000a1',
          'bb000000-0000-0000-0000-0000000000d1',
          'bb000000-0000-0000-0000-000000000001', 1, '\xdeadbeef'::bytea)
$$, 'and post to it');

-- The half that matters most. A ciphertext is opaque, so a message written
-- under someone else's name could never be spotted from its content.
select throws_ok($$
  insert into messages (id, project_id, channel_id, author_id, epoch, ciphertext)
  values ('bb000000-0000-0000-0000-0000000000e2',
          'bb000000-0000-0000-0000-0000000000a1',
          'bb000000-0000-0000-0000-0000000000d1',
          'bb000000-0000-0000-0000-000000000002', 1, '\xdeadbeef'::bytea)
$$, '42501', null,
  'nobody can post a message signed with a colleague''s name');

-- A channel in one project cannot receive a message labelled with another
-- project's id — which is what the `exists` clause in the insert policy is for.
select throws_ok($$
  insert into messages (id, project_id, channel_id, author_id, epoch, ciphertext)
  values ('bb000000-0000-0000-0000-0000000000e3',
          'bb000000-0000-0000-0000-0000000000a2',
          'bb000000-0000-0000-0000-0000000000d1',
          'bb000000-0000-0000-0000-000000000001', 1, '\xdeadbeef'::bytea)
$$, '42501', null,
  'a message cannot claim a project its channel does not belong to');

-- ── Bob, a member, reads it ─────────────────────────────────────────────────

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"bb000000-0000-0000-0000-000000000002"}', true);

select is((select count(*)::int from channels), 1, 'a member sees the channel');
select is((select count(*)::int from messages), 1, 'and the message in it');

select lives_ok($$
  insert into messages (id, project_id, channel_id, author_id, epoch, ciphertext)
  values ('bb000000-0000-0000-0000-0000000000e4',
          'bb000000-0000-0000-0000-0000000000a1',
          'bb000000-0000-0000-0000-0000000000d1',
          'bb000000-0000-0000-0000-000000000002', 1, '\xcafe'::bytea)
$$, 'and can reply');

-- ── Mallory, in a different project, sees none of it ────────────────────────

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"bb000000-0000-0000-0000-000000000003"}', true);

select is((select count(*)::int from channels), 0, 'a non-member sees no channels');
select is((select count(*)::int from messages), 0, 'and no messages (fail closed)');

set local role postgres;
-- Scoped to this fixture's project: an unscoped count passes or fails on
-- whatever else happens to be in the database, which is not what is being
-- asserted. See the same correction in 13_project_keys.sql.
select is((select count(*)::int from channels
            where project_id = 'bb000000-0000-0000-0000-0000000000a1'), 1,
  'MUTATION: there is a channel to hide');
select is((select count(*)::int from messages
            where project_id = 'bb000000-0000-0000-0000-0000000000a1'), 2,
  'MUTATION: there are two messages to hide');

-- ── Append-only ─────────────────────────────────────────────────────────────

set local role Porcupine_app;
select set_config('request.jwt.claims',
  '{"sub":"bb000000-0000-0000-0000-000000000002"}', true);

with edited as (
  update messages set ciphertext = '\xffff'::bytea
   where id = 'bb000000-0000-0000-0000-0000000000e4'
  returning 1
)
select is((select count(*)::int from edited), 0,
  'a member cannot edit even their own message — no UPDATE policy');

with removed as (
  delete from messages where id = 'bb000000-0000-0000-0000-0000000000e4' returning 1
)
select is((select count(*)::int from removed), 0,
  'nor delete it — no DELETE policy');

set local role postgres;
select is(
  (select ciphertext from messages where id = 'bb000000-0000-0000-0000-0000000000e4'),
  '\xcafe'::bytea,
  'MUTATION: the message was there to be edited, and was not'
);

-- ── What the server can see ─────────────────────────────────────────────────
--
-- Encryption happens in the browser, so this suite cannot check a ciphertext.
-- What it CAN check is that no column alongside it holds the plaintext — the
-- realistic way an end-to-end claim gets quietly broken is a helpful
-- `body_preview` or `search_text` added later by someone who did not know.

select is(
  (select count(*)::int
     from information_schema.columns
    where table_schema = 'public'
      and table_name in ('messages', 'channels')
      and data_type in ('text', 'character varying')),
  0,
  'no text column on messages or channels — content lives only in bytea'
);

select is(
  (select count(*)::int
     from pg_class
    where relname = 'messages' and relrowsecurity and relforcerowsecurity),
  1,
  'messages has RLS enabled AND forced'
);

select * from finish();
rollback;
