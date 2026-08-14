-- Mutation checks: prove the negative assertions can actually fail.
--
-- Why this file exists.
--
-- Phase 0 shipped a relay test asserting that a forged ticket was rejected.
-- The "forgery" re-encoded the signature without changing its bytes, so the
-- relay was verifying a genuine ticket and the assertion was never made. It
-- passed. For a quarter of runs it passed while proving nothing.
--
-- Most of this RLS suite is negative assertions of exactly that shape —
-- `count(*) = 0` — and `count(*) = 0` is equally true when:
--   * the policy correctly filtered every row, or
--   * the fixtures never inserted, or
--   * the table is empty, or
--   * a typo pointed the query at the wrong tenant.
--
-- Only the first is evidence. So: run the same queries with RLS switched off
-- and require them to return rows. If a count is zero in BOTH conditions, the
-- test was vacuous and this file fails — which is the point.
--
-- This is a test of the tests. It asserts nothing about policy logic; 02 does
-- that. It asserts that 02's zeros mean something.

begin;
select plan(16);

set local role postgres;

-- ── Fixtures, one row per corpus table ──────────────────────────────────────
insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now());

insert into projects (id, slug, title, created_by, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice-thesis', 'Alice Thesis',
   '11111111-1111-1111-1111-111111111111', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'OWNER', now(), now(), now());

insert into works (id, title_norm, title, authors, updated_at) values
  ('c0000000-0000-0000-0000-000000000001', 'first paper', 'First Paper',
   '[]'::jsonb, now());

insert into project_works
  (id, project_id, work_id, added_by, source, created_at, updated_at) values
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'search', now(), now());

insert into questions (id, project_id, "order", text, keywords, created_at, updated_at)
values ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        0, 'Does it work?', array['work'], now(), now());

insert into project_work_questions (project_work_id, question_id, relevance) values
  ('d0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 2);

insert into saved_searches (id, project_id, name, query, created_by, created_at, updated_at)
values ('f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'weekly', '{}'::jsonb, '11111111-1111-1111-1111-111111111111', now(), now());

insert into file_objects
  (id, owner_id, project_id, bucket, storage_path, mime_type, size_bytes, sha256,
   created_at, updated_at)
values ('10000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'papers', 'alice/one.pdf', 'application/pdf', 1024, 'deadbeef', now(), now());

insert into anchors (id, project_id, file_id, page, quote, created_at, updated_at)
values ('20000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '10000000-0000-0000-0000-000000000001', 3, 'the effect was significant',
        now(), now());

insert into annotations
  (id, project_id, project_work_id, anchor_id, author_id, kind, body, visibility,
   created_at, updated_at)
values ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'd0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'NOTE', 'a note', 'PROJECT',
        now(), now());

-- ═══════════ Condition A: policies engaged, no claim → must be zero ═════════

set local role porcupine_app;
select set_config('request.jwt.claims', '', true);

select is((select count(*) from works)::int,                  0, 'guarded: works');
select is((select count(*) from project_works)::int,          0, 'guarded: project_works');
select is((select count(*) from project_work_questions)::int, 0, 'guarded: project_work_questions');
select is((select count(*) from questions)::int,              0, 'guarded: questions');
select is((select count(*) from saved_searches)::int,         0, 'guarded: saved_searches');
select is((select count(*) from file_objects)::int,           0, 'guarded: file_objects');
select is((select count(*) from anchors)::int,                0, 'guarded: anchors');
select is((select count(*) from annotations)::int,            0, 'guarded: annotations');

-- ═══════════ Condition B: policies removed → the SAME queries must ══════════
-- ═══════════ return rows, or condition A proved nothing.           ══════════

set local role postgres;

alter table public.works                  disable row level security;
alter table public.project_works          disable row level security;
alter table public.project_work_questions disable row level security;
alter table public.questions              disable row level security;
alter table public.saved_searches         disable row level security;
alter table public.file_objects           disable row level security;
alter table public.anchors                disable row level security;
alter table public.annotations            disable row level security;

set local role porcupine_app;

select cmp_ok((select count(*) from works)::int, '>', 0,
  'MUTATION: works is non-empty with RLS off — the zero above was the policy');
select cmp_ok((select count(*) from project_works)::int, '>', 0,
  'MUTATION: project_works is non-empty with RLS off');
select cmp_ok((select count(*) from project_work_questions)::int, '>', 0,
  'MUTATION: project_work_questions is non-empty with RLS off');
select cmp_ok((select count(*) from questions)::int, '>', 0,
  'MUTATION: questions is non-empty with RLS off');
select cmp_ok((select count(*) from saved_searches)::int, '>', 0,
  'MUTATION: saved_searches is non-empty with RLS off');
select cmp_ok((select count(*) from file_objects)::int, '>', 0,
  'MUTATION: file_objects is non-empty with RLS off');
select cmp_ok((select count(*) from anchors)::int, '>', 0,
  'MUTATION: anchors is non-empty with RLS off');
select cmp_ok((select count(*) from annotations)::int, '>', 0,
  'MUTATION: annotations is non-empty with RLS off');

-- The rollback restores RLS on every table above. DDL is transactional in
-- Postgres, which is the only reason this file is safe to run at all — but
-- 00_structure.sql re-asserts enable+force from scratch, so a leak here is
-- caught rather than assumed impossible.

select * from finish();
rollback;
