-- File storage, stage 3 — the text layer's own access rule.
--
-- docs/12-file-storage-build-plan.md §6. The bytes are guarded by the storage
-- policy (18) and the record by file_objects (19); this is the third place the
-- same question is asked, and the one that carries the actual words of the
-- paper. A leak here is a leak of the paper, without needing the file at all.

begin;
select plan(9);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev',   'Bob',   now(), now()),
  ('55555555-5555-5555-5555-555555555555', 'sup@test.dev',   'Supervisor', now(), now()),
  ('66666666-6666-6666-6666-666666666666', 'obs@test.dev',   'Observer', now(), now());

insert into projects (id, slug, title, created_by, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice-thesis', 'Alice Thesis',
   '11111111-1111-1111-1111-111111111111', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'OWNER',    now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '55555555-5555-5555-5555-555555555555', 'REVIEWER', now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '66666666-6666-6666-6666-666666666666', 'OBSERVER', now(), now(), now());

insert into works (id, doi, title_norm, title, authors, published_year, updated_at) values
  ('c0000000-0000-0000-0000-000000000001', '10.1000/one', 'first paper', 'First Paper',
   '[]'::jsonb, 2020, now());

insert into file_objects
  (id, owner_id, project_id, work_id, bucket, storage_path, mime_type, size_bytes,
   sha256, upload_state, updated_at)
values ('f1000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'c0000000-0000-0000-0000-000000000001', 'papers',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1000000-0000-0000-0000-000000000001.pdf',
        'application/pdf', 4096, repeat('a', 64), 'COMPLETE', now());

insert into file_pages (id, project_id, file_id, page_number, text) values
  ('d1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'f1000000-0000-0000-0000-000000000001', 1, 'Sleep restriction impaired vigilance.');

-- ═══════════════ Reading is membership ══════════════════════════════════════

set local role porcupine_app;

select set_config('request.jwt.claims', '', true);
select is((select count(*) from file_pages)::int, 0,
  'no claim: the paper''s text returns nothing');

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
select is((select count(*) from file_pages)::int, 1,
  'a member reads the text of their project''s paper');

select set_config('request.jwt.claims',
  '{"sub":"66666666-6666-6666-6666-666666666666"}', true);
select is((select count(*) from file_pages)::int, 1,
  'an OBSERVER reads it too: a paper a member may download is one they may read');

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
select is((select count(*) from file_pages)::int, 0,
  'someone outside the project reads none of the paper');

set local role postgres;

-- Scoped to the fixture's file, NOT `count(*)`. An e2e run stores real page
-- text in this table and it is still there; an absolute count passes only on
-- an untouched database. Stage 1's suite made exactly this mistake.
select is((select count(*) from file_pages
           where file_id = 'f1000000-0000-0000-0000-000000000001')::int, 1,
  'MUTATION: the page was there the whole time');

-- ═══════════════ Writing is the same rule as the bytes ══════════════════════

set local role porcupine_app;

select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555"}', true);
select throws_ok(
  $$insert into file_pages (id, project_id, file_id, page_number, text)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'f1000000-0000-0000-0000-000000000001', 2, 'planted')$$,
  '42501',
  null,
  'a REVIEWER cannot write page text, matching the storage and file_objects rules'
);

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
select lives_ok(
  $$insert into file_pages (id, project_id, file_id, page_number, text)
    values (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'f1000000-0000-0000-0000-000000000001', 2, 'Effect sizes were smaller.')$$,
  'an OWNER may store the text they extracted'
);

/*
 * Page text is written once and never edited.
 *
 * There is no UPDATE policy, so this matches zero rows rather than raising —
 * the asymmetry 02_corpus_rls.sql documents. Asserted by reading the value
 * back, because "zero rows updated" and "the text did not change" are
 * different claims and only the second one matters.
 */
with attempted as (
  update file_pages set text = 'rewritten history'
   where file_id = 'f1000000-0000-0000-0000-000000000001' and page_number = 1
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'nobody can rewrite a page of a paper: there is no update policy');

select is(
  (select text from file_pages
    where file_id = 'f1000000-0000-0000-0000-000000000001' and page_number = 1),
  'Sleep restriction impaired vigilance.',
  'and the text is unchanged, which is the claim that actually matters'
);

select * from finish();
rollback;
