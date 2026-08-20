-- Reactions on messages, encrypted like everything else in this conversation.
--
-- docs/14-messaging-ui-plan.md §2.
--
-- Their own table rather than a column, because they have their own lifetime:
-- a reaction arrives and leaves independently of the message it is on, and
-- `messages` is append-only.

create table public.message_reactions (
  id         uuid primary key,
  project_id uuid not null references public.projects(id) on update cascade on delete cascade,
  message_id uuid not null references public.messages(id) on update cascade on delete cascade,
  author_id  uuid not null references public.users(id)    on update cascade on delete cascade,

  /*
   * The emoji is CIPHERTEXT, and the epoch says which project key opens it.
   *
   * "Alice 👍 the message about the null result" is sentiment and social
   * graph. Storing it in the clear beside a table we went to some trouble to
   * encrypt — including the channel's own name — would be the same half-claim
   * the schema already refuses once.
   */
  epoch      integer not null,
  ciphertext bytea   not null,

  created_at timestamptz(3) not null default now(),
  -- No default: Prisma's @updatedAt writes it, and `touch_updated_at()` below
  -- covers anything that reaches the table another way. Matches every other
  -- table here; a default would show up forever as schema drift.
  updated_at timestamptz(3) not null,

  /*
   * One reaction per person per message, which is a product decision forced by
   * the encryption rather than a preference.
   *
   * Allowing several would mean a uniqueness constraint including the emoji,
   * and the server cannot see the emoji. So reacting again replaces your
   * reaction, and reacting with what you already chose removes it.
   */
  constraint message_reactions_message_id_author_id_key unique (message_id, author_id)
);

comment on table public.message_reactions is
  'One encrypted reaction per person per message. The emoji is ciphertext; the server sees only who reacted to what.';

create index message_reactions_message_id_idx on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;
alter table public.message_reactions force row level security;

-- Read: anyone who can read the conversation. A reaction is only meaningful
-- beside its message, and the message is already gated on membership.
create policy message_reactions_select_member on public.message_reactions
  for select
  using (public.is_project_member(project_id));

-- Write: your own, in a project you belong to. `author_id` is checked against
-- the claim rather than trusted from the row.
create policy message_reactions_insert_own on public.message_reactions
  for insert
  with check (
    author_id = public.current_user_id()
    and public.is_project_member(project_id)
  );

/*
 * Reactions are mutable and messages are not, deliberately.
 *
 * `messages` has no UPDATE or DELETE policy because an edited ciphertext is
 * indistinguishable from a substituted one, so the transcript is append-only.
 * A reaction is not part of the transcript — it is a current opinion about a
 * line in it, and an opinion that cannot be withdrawn is not worth recording.
 */
create policy message_reactions_update_own on public.message_reactions
  for update
  using (author_id = public.current_user_id())
  with check (author_id = public.current_user_id());

create policy message_reactions_delete_own on public.message_reactions
  for delete
  using (author_id = public.current_user_id());

grant select, insert, update, delete on public.message_reactions to Porcupine_app;
grant select, insert, update, delete on public.message_reactions to authenticated;

-- Live on the same signal a message uses: one row per project per kind,
-- updated rather than appended, so a reaction wakes the same refetch without
-- adding a delivery per reader.
create trigger message_reactions_bump_activity
  after insert or update or delete on public.message_reactions
  for each row execute function bump_project_activity('messages');

create trigger message_reactions_touch_updated_at
  before update on public.message_reactions
  for each row execute function touch_updated_at();
