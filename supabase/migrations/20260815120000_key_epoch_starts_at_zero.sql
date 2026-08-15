-- ═══════════════════════════════════════════════════════════════════════════
-- `projects.current_key_epoch` starts at 0, meaning "no key provisioned yet".
--
-- It defaulted to 1, so a brand-new project claimed to be at epoch 1 while
-- holding no keys at all. That forced every caller into a special case: is
-- this the FIRST provisioning, which should write epoch 1, or a rotation,
-- which should write 2? The two are indistinguishable from the column alone.
--
-- Answering it from `project_keys` does not work either, and the reason is
-- worth writing down: that table's SELECT policy is `user_id =
-- current_user_id()`, so a member counting rows sees only their OWN wraps. A
-- member who has not yet been given a key would count zero and conclude the
-- project had never been provisioned — then write epoch 1 wraps for everybody
-- and collide with the existing ones. RLS doing exactly its job turns a
-- convenient query into a wrong answer.
--
-- With 0 as "none", the rule is one line with no branches:
--
--     the next epoch is always current_key_epoch + 1
--
-- Existing rows are moved to 0 only where the project genuinely has no keys,
-- which today is every row and will not be for long. A project that already
-- has wraps keeps the epoch it has.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.projects
  alter column current_key_epoch set default 0;

update public.projects p
   set current_key_epoch = 0
 where p.current_key_epoch = 1
   and not exists (select 1 from public.project_keys k where k.project_id = p.id);

comment on column public.projects.current_key_epoch is
  '0 means no content key has been provisioned. The next epoch is always this '
  'plus one — see 20260815120000_key_epoch_starts_at_zero.sql for why asking '
  'project_keys instead gives a wrong answer under RLS.';
