-- Phase 1 — RLS for the corpus tables.
--
-- Runs as porcupine_app throughout. Running as a superuser would pass whatever
-- the policies said and prove nothing.
--
-- Two shapes here are unlike Phase 0 and get explicit coverage:
--   * `works` is global — every authenticated user reads it, nobody writes it
--     directly. Both halves are asserted; the read half is easy to break by
--     "tightening" it later.
--   * `annotations` distinguishes PRIVATE from PROJECT. A private reading note
--     that a co-member can read is not private, so that is tested from both
--     sides.
--
-- Every assertion that expects zero rows is paired with a mutation check in
-- 03_mutation_checks.sql, which proves the zero is caused by the policy and
-- not by an empty table.

begin;
select plan(30);

set local role postgres;

-- ── People ──────────────────────────────────────────────────────────────────
insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev',   'Alice',   now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev',     'Bob',     now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'mallory@test.dev', 'Mallory', now(), now()),
  ('44444444-4444-4444-4444-444444444444', 'carol@test.dev',   'Carol',   now(), now()),
  ('55555555-5555-5555-5555-555555555555', 'sup@test.dev',     'Supervisor', now(), now()),
  ('66666666-6666-6666-6666-666666666666', 'obs@test.dev',     'Observer', now(), now());

insert into projects (id, slug, title, created_by, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice-thesis', 'Alice Thesis',
   '11111111-1111-1111-1111-111111111111', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bob-review', 'Bob Review',
   '22222222-2222-2222-2222-222222222222', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'OWNER',       now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '44444444-4444-4444-4444-444444444444', 'CONTRIBUTOR', now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '55555555-5555-5555-5555-555555555555', 'REVIEWER',    now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '66666666-6666-6666-6666-666666666666', 'OBSERVER',    now(), now(), now()),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'OWNER',       now(), now(), now());

-- ── Corpus ──────────────────────────────────────────────────────────────────
insert into works (id, doi, title_norm, title, authors, published_year, updated_at) values
  ('c0000000-0000-0000-0000-000000000001', '10.1000/one', 'first paper', 'First Paper',
   '[]'::jsonb, 2020, now()),
  ('c0000000-0000-0000-0000-000000000002', '10.1000/two', 'second paper', 'Second Paper',
   '[]'::jsonb, 2021, now());

insert into project_works
  (id, project_id, work_id, added_by, source, created_at, updated_at) values
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'search', now(), now());

insert into questions (id, project_id, "order", text, keywords, created_at, updated_at)
values ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        0, 'Does it work?', array['work'], now(), now());

insert into saved_searches (id, project_id, name, query, created_by, created_at, updated_at)
values ('f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'weekly immunology', '{}'::jsonb, '11111111-1111-1111-1111-111111111111',
        now(), now());

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
values
  ('30000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'd0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'NOTE', 'shared with the team', 'PROJECT',
   now(), now()),
  ('30000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'd0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'NOTE', 'my own half-formed thought', 'PRIVATE',
   now(), now());

set local role porcupine_app;

-- ═══════════════ Fail closed, including the global table ════════════════════

select is((select count(*) from works)::int, 0,
  'no claim: even the global works table returns zero rows');
select is((select count(*) from project_works)::int, 0,
  'no claim: project_works returns zero rows');
select is((select count(*) from annotations)::int, 0,
  'no claim: annotations returns zero rows');

-- ═══════════════ works is global on purpose ═════════════════════════════════

-- Scoped to the fixtures, NOT `count(*)` over the table.
--
-- `works` is deliberately global, so its row count is not controlled by this
-- transaction: anything another test or a local e2e run left behind changes
-- it. An absolute count passes in CI only because the database happens to be
-- fresh, which is luck rather than a property. Asserting the fixture rows
-- also states the actual claim more precisely — a specific work outside the
-- user's project is visible.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
select is(
  (select count(*) from works
    where id in ('c0000000-0000-0000-0000-000000000001',
                 'c0000000-0000-0000-0000-000000000002'))::int,
  2,
  'an authenticated user reads every work, not just their project''s');

-- 'second paper' is in nobody's project_works, so seeing it is the property.
select is(
  (select title from works where id = 'c0000000-0000-0000-0000-000000000002'),
  'Second Paper',
  'a work belonging to no project of theirs is still readable');

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
select is(
  (select count(*) from works
    where id in ('c0000000-0000-0000-0000-000000000001',
                 'c0000000-0000-0000-0000-000000000002'))::int,
  2,
  'a user with no project membership still reads the global bibliography');

-- ═══════════════ Everything else is tenant-scoped ═══════════════════════════

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
select is((select count(*) from project_works)::int, 1, 'alice sees her corpus');
select is((select count(*) from questions)::int, 1, 'alice sees her questions');
select is((select count(*) from saved_searches)::int, 1, 'alice sees her saved searches');
select is((select count(*) from anchors)::int, 1, 'alice sees her anchors');
select is((select count(*) from file_objects)::int, 1, 'alice sees her own file');

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
select is((select count(*) from project_works)::int, 0,
  'bob, who owns a different project, sees none of alice''s corpus');

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
select is((select count(*) from project_works)::int, 0, 'non-member sees no corpus');
select is((select count(*) from questions)::int, 0, 'non-member sees no questions');
select is((select count(*) from anchors)::int, 0, 'non-member sees no anchors');
select is((select count(*) from file_objects)::int, 0, 'non-member sees no files');

-- ═══════════════ PRIVATE means private ══════════════════════════════════════

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
select is((select count(*) from annotations)::int, 1,
  'a co-member sees the PROJECT annotation');
select is((select body from annotations), 'shared with the team',
  'and the one they see is the shared one, not the private one');

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
select is((select count(*) from annotations)::int, 2,
  'the author sees both their own private note and the shared one');

-- A co-member can read the project file row (to know it exists) — the bytes
-- are gated separately by the presigned-URL path, not by this policy.
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
select is((select count(*) from file_objects)::int, 1,
  'a co-member sees that a project file exists');

-- ═══════════════ works has no direct write path ═════════════════════════════

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

select throws_ok(
  $$insert into works (id, title_norm, title, authors, updated_at)
    values (gen_random_uuid(), 'sneaky', 'Sneaky', '[]'::jsonb, now())$$,
  '42501',
  null,
  'a user cannot insert into works directly — there is no insert policy'
);

-- Note the asymmetry: RLS raises 42501 when an INSERT fails a WITH CHECK, but
-- an UPDATE with no matching policy is silently filtered to zero rows. So this
-- is asserted by effect, not by exception — and the value is read back,
-- because "zero rows updated" and "the value did not change" are different
-- claims and only the second one is what we actually care about.
with attempted as (
  update works set citation_key = 'stolen_2020_key'
  where id = 'c0000000-0000-0000-0000-000000000001'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'a user cannot update works: the write matches zero rows');

select is(
  (select citation_key from works where id = 'c0000000-0000-0000-0000-000000000001'),
  null,
  'and the citation_key that other projects cite is unchanged'
);

-- ═══════════════ upsert_work is the door ════════════════════════════════════

select isnt(
  public.upsert_work('{"title":"A Third Paper","doi":"10.1000/three"}'::jsonb),
  null,
  'upsert_work creates a work through the definer function'
);

select is(
  public.upsert_work('{"title":"First Paper Reprinted","doi":"10.1000/one"}'::jsonb),
  'c0000000-0000-0000-0000-000000000001'::uuid,
  'upsert_work dedupes on DOI rather than creating a second row'
);

select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$select public.upsert_work('{"title":"Anonymous"}'::jsonb)$$,
  '42501',
  null,
  'upsert_work refuses to run without an authenticated claim'
);

-- ═══════════════ Role boundaries ════════════════════════════════════════════
-- A supervisor comments; they do not silently move papers through screening.

select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555"}', true);

with attempted as (
  update project_works set screen_status = 'EXCLUDED'
  where id = 'd0000000-0000-0000-0000-000000000001'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'a REVIEWER cannot change a screening decision');

select lives_ok(
  $$insert into annotations
      (id, project_id, project_work_id, anchor_id, author_id, kind, body,
       visibility, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-000000000001',
            '55555555-5555-5555-5555-555555555555', 'NOTE',
            'consider the 2019 replication', 'PROJECT', now(), now())$$,
  'a REVIEWER can annotate — that is what a supervisor is for'
);

select set_config('request.jwt.claims',
  '{"sub":"66666666-6666-6666-6666-666666666666"}', true);
select throws_ok(
  $$insert into annotations
      (id, project_id, project_work_id, anchor_id, author_id, kind, body,
       visibility, created_at, updated_at)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'd0000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-000000000001',
            '66666666-6666-6666-6666-666666666666', 'NOTE', 'me too', 'PROJECT',
            now(), now())$$,
  '42501',
  null,
  'an OBSERVER cannot annotate'
);

-- An author owns their own words: nobody else may edit them.
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
with attempted as (
  update annotations set body = 'rewritten by someone else'
  where id = '30000000-0000-0000-0000-000000000001'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'a co-member cannot rewrite another member''s annotation');

select * from finish();
rollback;
