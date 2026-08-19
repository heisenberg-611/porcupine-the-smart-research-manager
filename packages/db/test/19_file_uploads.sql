-- File storage, stage 2 — the upload record and the two ways it half-happens.
--
-- docs/12-file-storage-build-plan.md §5. Stage 1 proved who may touch the
-- BYTES; this proves the row that tracks them, and the two functions that
-- reconcile the two when they disagree.
--
-- Runs as porcupine_app for the file_objects half and as postgres for the
-- definer functions, which is what the cron route's NIL-claim context reduces
-- to: no policy of its own can match, so the function is all it can reach.

begin;
select plan(14);

set local role postgres;

insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev', 'Alice', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev',   'Bob',   now(), now()),
  ('55555555-5555-5555-5555-555555555555', 'sup@test.dev',   'Supervisor', now(), now());

insert into projects (id, slug, title, created_by, created_at, updated_at) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice-thesis', 'Alice Thesis',
   '11111111-1111-1111-1111-111111111111', now(), now());

insert into project_members
  (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'OWNER',    now(), now(), now()),
  ('a1a1a1a1-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '55555555-5555-5555-5555-555555555555', 'REVIEWER', now(), now(), now());

insert into works (id, doi, title_norm, title, authors, published_year, updated_at) values
  ('c0000000-0000-0000-0000-000000000001', '10.1000/one', 'first paper', 'First Paper',
   '[]'::jsonb, 2020, now());

insert into project_works
  (id, project_id, work_id, added_by, source, created_at, updated_at) values
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'search', now(), now());

-- ═══════════════ Who may claim a place for a file ═══════════════════════════

set local role porcupine_app;

/*
 * The metadata row and the object must agree.
 *
 * Before stage 2 this policy asked only for membership, while the storage
 * policy asks for OWNER/ADMIN/CONTRIBUTOR. A REVIEWER therefore sat in the
 * gap: allowed the row, refused the bytes — a PENDING record that could never
 * complete, swept to ORPHANED an hour later with nothing explaining why.
 */
select set_config('request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555"}', true);
select throws_ok(
  $$insert into file_objects
      (id, owner_id, project_id, work_id, bucket, storage_path, mime_type,
       size_bytes, sha256, updated_at)
    values (gen_random_uuid(), '55555555-5555-5555-5555-555555555555',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'c0000000-0000-0000-0000-000000000001', 'papers', 'x/y.pdf',
            'application/pdf', 100, repeat('a', 64), now())$$,
  '42501',
  null,
  'a REVIEWER cannot claim a place for a file, matching the storage policy that would refuse the bytes'
);

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
select lives_ok(
  $$insert into file_objects
      (id, owner_id, project_id, work_id, bucket, storage_path, mime_type,
       size_bytes, sha256, upload_state, updated_at)
    values ('f1000000-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            'c0000000-0000-0000-0000-000000000001', 'papers',
            'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1000000-0000-0000-0000-000000000001.pdf',
            'application/pdf', 209, repeat('a', 64), 'PENDING', now())$$,
  'an OWNER may claim a place for a file'
);

select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
select is((select count(*) from file_objects)::int, 0,
  'a stranger sees no file records at all');

-- The default the whole rename was about.
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
select is(
  (select residency::text from file_objects
    where id = 'f1000000-0000-0000-0000-000000000001'),
  'PRIVATE',
  'a new file is PRIVATE: nothing is shared between users until Unpaywall says it may be'
);

-- ═══════════════ Rows whose bytes never arrived ═════════════════════════════

set local role postgres;

-- Fresh: an upload that may still be in flight. Naming it would let the
-- reconciler delete a file out from under someone watching a progress bar.
select is((select count(*) from stale_pending_uploads())::int, 0,
  'a PENDING row younger than the grace period is left alone');

update file_objects set created_at = now() - interval '2 hours'
 where id = 'f1000000-0000-0000-0000-000000000001';

select is((select count(*) from stale_pending_uploads())::int, 1,
  'and is listed once it is old enough that the app has plainly lost it');

select is(
  (select storage_path from stale_pending_uploads()),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1000000-0000-0000-0000-000000000001.pdf',
  'with the path, which is all the caller needs to go and look'
);

update file_objects set upload_state = 'COMPLETE'
 where id = 'f1000000-0000-0000-0000-000000000001';
select is((select count(*) from stale_pending_uploads())::int, 0,
  'a finished upload is not listed again — the sweep is idempotent'
);

-- ═══════════════ Bytes whose row never arrived ══════════════════════════════

insert into storage.objects (bucket_id, name, created_at) values
  ('papers', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1000000-0000-0000-0000-000000000001.pdf',
   now() - interval '2 hours'),
  ('papers', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/99999999-9999-9999-9999-999999999999.pdf',
   now() - interval '2 hours'),
  ('papers', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/88888888-8888-8888-8888-888888888888.pdf',
   now());

select is((select count(*) from orphaned_paper_objects())::int, 1,
  'exactly the object no row claims — not the claimed one, not the fresh one');

select is(
  (select name from orphaned_paper_objects()),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/99999999-9999-9999-9999-999999999999.pdf',
  'and it is the unclaimed one'
);

-- The grace period again, from the other side: an object uploaded moments ago
-- has not had time for its confirming action to run.
select is(
  (select count(*) from orphaned_paper_objects('10 minutes'::interval))::int, 1,
  'the window is a parameter, and a fresh object stays out of it'
);

-- ═══════════════ The definer functions are not a back door ══════════════════

/*
 * SECURITY DEFINER runs as the owner, so execute rights are the only thing
 * standing between these and any authenticated user reading every file path in
 * the product. Both were revoked from PUBLIC; only porcupine_app may call
 * them, which is the application's own role and not one a browser holds.
 */
select ok(
  not has_function_privilege('anon', 'public.stale_pending_uploads(interval)', 'execute'),
  'anon cannot call the pending-upload listing'
);
select ok(
  not has_function_privilege('authenticated', 'public.orphaned_paper_objects(interval)', 'execute'),
  'a signed-in user cannot call the orphan listing — it names paths across every project'
);
select ok(
  has_function_privilege('porcupine_app', 'public.orphaned_paper_objects(interval)', 'execute'),
  'the application role can, which is what the cron route runs as'
);

select * from finish();
rollback;
