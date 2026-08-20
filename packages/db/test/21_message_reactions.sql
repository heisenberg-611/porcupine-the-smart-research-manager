-- Reactions: encrypted, one per person, and mutable in a way messages are not.
--
-- docs/14-messaging-ui-plan.md §2. The interesting claims are not "a member
-- can react" but the three that constrain it: nobody may react as somebody
-- else, nobody may touch anybody else's reaction, and one person gets one
-- reaction per message because that is the only uniqueness a server that
-- cannot read the emoji is able to enforce.

begin;
select plan(13);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('cc000000-0000-0000-0000-000000000001', 'react-alice@test.dev',   'Alice',   now(), now()),
  ('cc000000-0000-0000-0000-000000000002', 'react-bob@test.dev',     'Bob',     now(), now()),
  ('cc000000-0000-0000-0000-000000000003', 'react-mallory@test.dev', 'Mallory', now(), now());

insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
  ('cc000000-0000-0000-0000-0000000000a1', 'react-project', 'Talking', 'THESIS',
   'cc000000-0000-0000-0000-000000000001', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('cc000000-0000-0000-0000-0000000000b1', 'cc000000-0000-0000-0000-0000000000a1',
   'cc000000-0000-0000-0000-000000000001', 'OWNER', now(), now(), now()),
  ('cc000000-0000-0000-0000-0000000000b2', 'cc000000-0000-0000-0000-0000000000a1',
   'cc000000-0000-0000-0000-000000000002', 'CONTRIBUTOR', now(), now(), now());

insert into channels (id, project_id, name_ct, epoch, created_by, updated_at)
values ('cc000000-0000-0000-0000-0000000000d1', 'cc000000-0000-0000-0000-0000000000a1',
        '\x0102'::bytea, 1, 'cc000000-0000-0000-0000-000000000001', now());

insert into messages (id, project_id, channel_id, author_id, epoch, ciphertext)
values ('cc000000-0000-0000-0000-0000000000e1', 'cc000000-0000-0000-0000-0000000000a1',
        'cc000000-0000-0000-0000-0000000000d1',
        'cc000000-0000-0000-0000-000000000001', 1, '\xdeadbeef'::bytea);

set local role porcupine_app;

-- ═══════════════ Reacting ═══════════════════════════════════════════════════

select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-000000000002"}', true);

select lives_ok($$
  insert into message_reactions
    (id, project_id, message_id, author_id, epoch, ciphertext, updated_at)
  values ('cc000000-0000-0000-0000-0000000000f1',
          'cc000000-0000-0000-0000-0000000000a1',
          'cc000000-0000-0000-0000-0000000000e1',
          'cc000000-0000-0000-0000-000000000002', 1, '\xaa'::bytea, now())
$$, 'a member can react to a message in their project');

/*
 * The half that matters. A ciphertext is opaque, so a reaction written under
 * somebody else's name could never be spotted from its content — the policy is
 * the only thing standing between a member and putting words, or opinions, in
 * a colleague's mouth.
 */
select throws_ok($$
  insert into message_reactions
    (id, project_id, message_id, author_id, epoch, ciphertext, updated_at)
  values ('cc000000-0000-0000-0000-0000000000f2',
          'cc000000-0000-0000-0000-0000000000a1',
          'cc000000-0000-0000-0000-0000000000e1',
          'cc000000-0000-0000-0000-000000000001', 1, '\xbb'::bytea, now())
$$, '42501', null,
  'but cannot react as a colleague');

select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-000000000003"}', true);
select throws_ok($$
  insert into message_reactions
    (id, project_id, message_id, author_id, epoch, ciphertext, updated_at)
  values ('cc000000-0000-0000-0000-0000000000f3',
          'cc000000-0000-0000-0000-0000000000a1',
          'cc000000-0000-0000-0000-0000000000e1',
          'cc000000-0000-0000-0000-000000000003', 1, '\xcc'::bytea, now())
$$, '42501', null,
  'and an outsider cannot react at all');

-- ═══════════════ One per person per message ═════════════════════════════════

/*
 * Not a preference — the only uniqueness the server can express. A constraint
 * including the emoji would require the server to see the emoji, which is the
 * thing this table exists to avoid. So the client replaces rather than adds.
 */
set local role postgres;
select throws_ok($$
  insert into message_reactions
    (id, project_id, message_id, author_id, epoch, ciphertext, updated_at)
  values ('cc000000-0000-0000-0000-0000000000f4',
          'cc000000-0000-0000-0000-0000000000a1',
          'cc000000-0000-0000-0000-0000000000e1',
          'cc000000-0000-0000-0000-000000000002', 1, '\xdd'::bytea, now())
$$, '23505', null,
  'a second reaction from the same person is refused by the constraint');

-- ═══════════════ Reading ════════════════════════════════════════════════════

set local role porcupine_app;

select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-000000000001"}', true);
select is((select count(*) from message_reactions)::int, 1,
  'a colleague sees the reaction: it is only meaningful beside its message');

select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-000000000003"}', true);
select is((select count(*) from message_reactions)::int, 0,
  'somebody outside the project sees none');

select set_config('request.jwt.claims', '', true);
select is((select count(*) from message_reactions)::int, 0,
  'and no claim sees none');

set local role postgres;
select is((select count(*) from message_reactions)::int, 1,
  'MUTATION: the reaction was there the whole time');

-- ═══════════════ Changing your mind, and only your own ══════════════════════

/*
 * Reactions are mutable and messages are not, deliberately. `messages` has no
 * UPDATE or DELETE policy because an edited ciphertext is indistinguishable
 * from a substituted one, so the transcript is append-only. A reaction is a
 * current opinion about a line in it.
 */
set local role porcupine_app;

select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-000000000002"}', true);
with changed as (
  update message_reactions set ciphertext = '\xee'::bytea
   where id = 'cc000000-0000-0000-0000-0000000000f1'
  returning 1
)
select is((select count(*) from changed)::int, 1,
  'the author can change their own reaction');

select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-000000000001"}', true);
with attempted as (
  update message_reactions set ciphertext = '\xff'::bytea
   where id = 'cc000000-0000-0000-0000-0000000000f1'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'a colleague cannot change it — UPDATE is filtered, not raised');

select is(
  (select ciphertext from message_reactions
    where id = 'cc000000-0000-0000-0000-0000000000f1'),
  '\xee'::bytea,
  'and the value is unchanged, which is the claim that matters');

with attempted as (
  delete from message_reactions
   where id = 'cc000000-0000-0000-0000-0000000000f1'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'nor delete it');

select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-000000000002"}', true);
with withdrawn as (
  delete from message_reactions
   where id = 'cc000000-0000-0000-0000-0000000000f1'
  returning 1
)
select is((select count(*) from withdrawn)::int, 1,
  'the author can withdraw it');

select * from finish();
rollback;
