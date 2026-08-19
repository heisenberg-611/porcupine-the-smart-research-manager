-- File storage, stage 1 — RLS on the papers bucket.
--
-- docs/12-file-storage-build-plan.md §4. This suite is the reason the backend
-- is Supabase Storage rather than R2: file authorization is a database policy,
-- so it is testable by the same method as every other rule here. If this file
-- could not exist, the decision in plan §2 was wrong.
--
-- Runs as `authenticated` rather than porcupine_app, which is the one place
-- this suite departs from its neighbours. It is not a preference: the storage
-- API connects as `authenticated` with the caller's JWT, and porcupine_app has
-- no grants on storage.objects at all — so a test using it would get
-- "permission denied for table objects" and pass for a reason that has nothing
-- to do with the policies under test.
--
-- Every zero here is paired with the same count taken as postgres. A policy
-- suite that only asserts zeros passes just as well against an empty table.

begin;
select plan(21);

set local role postgres;

-- ── People ──────────────────────────────────────────────────────────────────
insert into users (id, email, display_name, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.dev',   'Alice',   now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.dev',     'Bob',     now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'mallory@test.dev', 'Mallory', now(), now()),
  ('44444444-4444-4444-4444-444444444444', 'carol@test.dev',   'Carol',   now(), now()),
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
  ('a1a1a1a1-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '66666666-6666-6666-6666-666666666666', 'OBSERVER',    now(), now(), now()),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'OWNER',       now(), now(), now());

-- ── Objects ─────────────────────────────────────────────────────────────────
--
-- One per project, plus a key that does not begin with a project id at all.
-- That third row is the regression test for the cast: written naively as
-- `(storage.foldername(name))[1]::uuid`, this single object raises 22P02 and
-- takes SELECT down for every user of the bucket rather than being denied.
insert into storage.objects (bucket_id, name) values
  ('papers', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1.pdf'),
  ('papers', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/f2.pdf'),
  ('papers', 'not-a-uuid/f3.pdf');

-- ═══════════════ The bucket is private and fails closed ═════════════════════

select ok(
  not (select public from storage.buckets where id = 'papers'),
  'the papers bucket is private: a public bucket serves every object to anyone with the URL, policies uninvolved'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'papers'),
  array['application/pdf'],
  'the storage service enforces the type itself, so it holds even when an upload skips the app'
);

set local role authenticated;

select set_config('request.jwt.claims', '', true);
select is((select count(*) from storage.objects)::int, 0,
  'no claim: the bucket returns nothing at all');

-- ═══════════════ Membership is the read rule ════════════════════════════════

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);

-- Unscoped is correct HERE, and only here: the claim is precisely that this
-- user sees one object in the whole bucket. Objects an e2e run left behind
-- belong to other projects and are invisible to her, so a leftover row that
-- made this fail would be a policy failure and should fail.
select is((select count(*) from storage.objects)::int, 1,
  'a member reads their own project''s object');
select is((select name from storage.objects),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1.pdf',
  'and it is their project''s object, not just some object');

-- The point of the whole feature. Bob's PDF is a paper someone paid for.
select is((select count(*) from storage.objects
           where name like 'bbbbbbbb%')::int, 0,
  'a member of another project reads nothing of theirs');

select is((select count(*) from storage.objects
           where name like 'not-a-uuid%')::int, 0,
  'a key that is not {projectId}/... is invisible rather than an error');

select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
select is((select count(*) from storage.objects)::int, 0,
  'a user in no project reads nothing');

select set_config('request.jwt.claims',
  '{"sub":"66666666-6666-6666-6666-666666666666"}', true);
select is((select count(*) from storage.objects)::int, 1,
  'an OBSERVER reads it too: reading is membership, not rank');

-- ═══════════════ MUTATION: the zeros above are the policy ═══════════════════

set local role postgres;

-- Scoped to the fixtures, NOT `count(*)` over the table.
--
-- storage.objects is not controlled by this transaction: an e2e run uploads
-- real files to the papers bucket and they are still there. An absolute count
-- passes only on a database that happens to be untouched, which is luck rather
-- than a property — the same trap 02_corpus_rls.sql documents for `works`, and
-- this suite fell into it.
select is((select count(*) from storage.objects
           where name in (
             'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1.pdf',
             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/f2.pdf',
             'not-a-uuid/f3.pdf'))::int, 3,
  'MUTATION: all three fixture objects were there the whole time');
select is((select count(*) from storage.objects where name like 'bbbbbbbb%')::int, 1,
  'MUTATION: the object Alice could not see does exist');

-- ═══════════════ Writing is gated on role, like project_works ═══════════════

set local role authenticated;

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('papers', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/new.pdf')$$,
  'a CONTRIBUTOR may add a paper to their project'
);

select set_config('request.jwt.claims',
  '{"sub":"66666666-6666-6666-6666-666666666666"}', true);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('papers', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/observer.pdf')$$,
  '42501',
  null,
  'an OBSERVER may read the project''s papers and may not add one'
);

select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('papers', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/planted.pdf')$$,
  '42501',
  null,
  'an owner cannot write into a project they are not a member of'
);

-- A path with no project prefix resolves to NULL, which has_project_role()
-- answers false to. Without this the bucket would have an unowned root that
-- anyone authenticated could write to.
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('papers', 'loose.pdf')$$,
  '42501',
  null,
  'and cannot write to the bucket root, where no project owns the key'
);

-- ═══════════════ An update cannot move an object across a tenant ════════════

-- The WITH CHECK half. With only USING, a contributor could rename their own
-- object onto another project's prefix and hand it over the boundary — the
-- one write that turns an access-control policy into a delivery mechanism.
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
select throws_ok(
  $$update storage.objects
      set name = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/smuggled.pdf'
    where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1.pdf'$$,
  '42501',
  null,
  'a contributor cannot rename their object into another project'
);

-- ═══════════════ Deleting ═══════════════════════════════════════════════════

/*
 * Two independent guards, and the first one is not ours.
 *
 * storage.protect_objects_delete is a statement-level BEFORE DELETE trigger
 * that refuses every direct SQL delete unless `storage.allow_delete_query` is
 * set — which is how the Storage API marks its own deletes, so that a row
 * cannot be removed while its bytes are left behind as an orphan.
 *
 * It fires BEFORE any row is filtered, so it raises 42501 for everyone. That
 * matters for this suite: the first version of the OBSERVER assertion below
 * passed against the trigger and would have gone on passing with the delete
 * policy removed entirely. Both halves are therefore asserted separately —
 * the guard, and then the policy underneath it with the guard lifted exactly
 * as the API lifts it.
 */
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
select throws_ok(
  $$delete from storage.objects
     where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1.pdf'$$,
  '42501',
  null,
  'even a CONTRIBUTOR cannot delete by direct SQL: orphaned bytes are the worse failure'
);

-- From here on, as the Storage API itself runs.
select set_config('storage.allow_delete_query', 'true', true);

select set_config('request.jwt.claims',
  '{"sub":"66666666-6666-6666-6666-666666666666"}', true);
with attempted as (
  delete from storage.objects
   where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1.pdf'
  returning 1
)
select is((select count(*) from attempted)::int, 0,
  'an OBSERVER''s delete matches no rows — DELETE is filtered by RLS, not raised');

select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
with attempted as (
  delete from storage.objects
   where name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/f1.pdf'
  returning 1
)
select is((select count(*) from attempted)::int, 1,
  'a CONTRIBUTOR''s delete removes exactly the one row');

-- ═══════════════ The policies are scoped to this bucket ═════════════════════

-- Every policy is `bucket_id = 'papers' and ...`. A future bucket therefore
-- starts closed and needs its own rule, rather than quietly inheriting this
-- one — which is what assert-rls.sh now checks for.
set local role postgres;
insert into storage.buckets (id, name, public) values ('other', 'other', false);
insert into storage.objects (bucket_id, name)
  values ('other', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/elsewhere.pdf');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
select is((select count(*) from storage.objects where bucket_id = 'other')::int, 0,
  'a bucket with no policy of its own shows nothing, even to a project member'
);

set local role postgres;
select is((select count(*) from storage.objects where bucket_id = 'other')::int, 1,
  'MUTATION: that object exists'
);

select * from finish();
rollback;
