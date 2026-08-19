# File storage — Build Plan

The largest remaining gap in the product. The reader shows abstracts, there is
no upload anywhere, and `apps/web/src/app/projects/[id]/read/[workId]/page.tsx:85`
has said "Full PDF text needs the file pipeline" since Phase 1.

Grounded in the tree as of 2026-08-19, after account deletion and the PRISMA
2020 work. Every claim below carries a reference so it can be checked rather
than taken.

---

## 1. Most of this is already designed. Do not restart it.

Four pieces exist and are correct. The plan is to use them, not to redo them.

**The table.** `FileObject` (`packages/db/prisma/schema.prisma:776`) already
models residency, a SHA-256 content hash for dedupe, `uploadState`,
`scanStatus`, `textStatus`, page count and size. It has **zero rows**, so its
shape is still free to change — see §2.

**The anchoring engine.** `packages/anchoring/src/anchor.ts` already carries
`page?: number` on `AnchorSelector`, and its own documentation talks about "a
PDF re-extraction changed a ligature". It resolves to `OK / DRIFTED / BROKEN`
rather than found/not-found, precisely so a quote that moved is reported rather
than silently repointed. **This is the hardest part of the feature and it is
already built and tested.** Stage 3 is wiring, not design.

**The security checklist.** `docs/02-security-and-e2ee.md` §7 "Files" settles
presigned uploads, treating URLs as bearer tokens, size and magic-byte checks,
and pdf.js configuration. `apps/web/next.config.ts` already sets
`Referrer-Policy: no-referrer` for hazard B-10, which exists only because of
this feature.

**The copyright rule.** `docs/05-resolution-plan.md` R-04 decides what may be
shared: an Unpaywall-verified open-access file may be deduped across users; a
paywalled one may not leave the fetching user's browser. That is a legal
constraint, not a storage decision, and it survives any choice of backend.

---

## 2. The assumption that broke

`docs/02-security-and-e2ee.md` §7 says:

> R2 has no row-level security, so authorization moves up a layer: a Worker
> route validates the JWT, calls `app.is_project_member()`, then issues a
> presigned GET with a 5-minute TTL. `FileObject` is therefore not merely
> metadata — it is the access-control record, and a bug there is a data leak.

**There is no Worker.** ADR-019 moved the application to Vercel, and the
security document notes the SSRF consequence of that move while leaving this
one unstated. Rehoming the authorization layer in a Next.js route handler is
possible, and it makes file access control the only security boundary in this
codebase that is application code rather than a database policy.

That matters here more than it would elsewhere. Every other rule in this
project is enforced by RLS and tested by dropping it and watching the suite go
red — the discipline recorded in `README.md` and exercised across eighteen
pgTAP files. A hand-written authorization layer cannot be tested that way, and
it would guard the one asset where a mistake is a copyright incident as well as
a privacy one.

### Decision: Supabase Storage

`storage.objects` is a Postgres table with row-level security. File
authorization becomes the same kind of rule as every other rule here,
expressible as a policy and testable by the same method. The project is already
on Supabase, already authenticated with the same JWT, and
`supabase/config.toml:115` already has `[storage] enabled = true`.

**What this gives up** is R2's zero egress, which was the reason Cloudflare was
originally chosen (`docs/05-resolution-plan.md`, cost table). Against that: the
same document estimates ~2 GB of storage with OA dedupe, and re-adding
Cloudflare means a second vendor, a second credential set and a second deploy
target — which is what ADR-019 removed.

`FileObject.bucket` and `FileObject.storagePath` remain the seam. If egress
ever justifies R2, the migration is a byte copy and a path rewrite rather than
a redesign.

### Decision: server-stored files only in v1

R-04 splits files three ways. `DEVICE_ONLY` — paywalled PDFs whose bytes stay
in the browser, with anchors and extractions syncing normally — is a genuinely
different code path, not a flag. It needs an IndexedDB store, a cache-eviction
story, and a reader that renders from two sources.

v1 handles files the server may hold: open-access PDFs and anything a user
uploads themselves. `DEVICE_ONLY` stays in the enum, unused, and is a later
phase.

---

## 3. Rename the enum before writing a single row — **done**

`Residency` is `R2_SHARED | R2_USER | DEVICE_ONLY`
(`packages/db/prisma/schema.prisma:118`). Two of those three name a vendor that
is no longer the plan.

`file_objects` has zero rows **today**. Renaming costs one migration now, and a
data migration plus every call site later.

    SHARED | PRIVATE | DEVICE_ONLY

Do it in the first migration of Stage 1, before anything can insert.

**Done** in `supabase/migrations/20260819132216_file_storage_boundary.sql`.
`ALTER TYPE ... RENAME VALUE` keeps each label's OID, so the column default
followed the rename rather than dangling — checked, not assumed. There were no
code call sites, only comments and docs.

---

## 4. Stage 1 — the boundary, before any interface — **done**

Nothing else starts until this stage's tests are green. This is the stage that
justifies the choice of backend, so it is also the stage that proves it.

**The idea: the path IS the access-control key.** Objects are stored at
`{projectId}/{fileId}.pdf`, which lets the policy ask the same question every
other policy in this schema asks:

```sql
create policy files_select_member on storage.objects
  for select using (
    bucket_id = 'papers'
    and public.is_project_member(((storage.foldername(name))[1])::uuid)
  );
```

Insert and delete get policies of the same shape, gated on the roles that may
add or remove papers rather than on membership alone.

**Deliverables**

- A migration creating the `papers` bucket (private) and its policies.
- `packages/db/test/18_storage_rls.sql`: a member reads their project's object,
  a non-member reads nothing, a member of *another* project reads nothing, and
  each zero is paired with the same count taken as `postgres`.
- The enum rename from §3.

**One thing that will bite.** `scripts/assert-rls.sh` checks
`where n.nspname = 'public'` — `storage.objects` is invisible to it. The guard
that has caught every unprotected table so far would not catch an unprotected
bucket. Extend it in this stage, not later.

### What the stage actually found

Three things the plan above had wrong or did not know.

**The cast has to be total.** `((storage.foldername(name))[1])::uuid`, written
exactly as it appears above, raises `22P02` on any object whose first path
segment is not a UUID. A policy that raises does not deny one row — it fails
the whole query, for every user, until somebody finds the object. One malformed
key from `service_role` or a restore would take the bucket down. The migration
uses `public.storage_project_id(text)`, which checks the shape before casting
and yields NULL — which `is_project_member()` answers false to. There is an
object literally named `not-a-uuid/f3.pdf` in the suite to keep it that way.

**FORCE does not apply here, so the guard asks a different question.**
`storage.objects` is owned by `supabase_storage_admin` and is deliberately not
`FORCE`d; requiring it would fail against a correctly configured project. RLS
is already enabled, so a table-level check would pass while the real mistake —
adding a bucket and forgetting its policies — went unnoticed. `assert-rls.sh`
now refuses any bucket that is public, and any bucket no policy names.
`quote_literal` does the matching, so a bucket called `paper` is not covered by
the `'papers'` policy.

**Deletes are already guarded, and not by us.**
`storage.protect_objects_delete` is a statement-level BEFORE DELETE trigger
that refuses every direct SQL delete unless `storage.allow_delete_query` is
set — which is how the Storage API marks its own, so a row cannot vanish while
its bytes stay behind as an orphan. It fires before any row is filtered, so it
raises for everyone. The first version of the OBSERVER delete assertion passed
against *that* and would have gone on passing with the delete policy dropped
entirely. Both halves are now asserted separately.

### Delivered

- `supabase/migrations/20260819132216_file_storage_boundary.sql` — the enum
  rename, `storage_project_id()`, the private `papers` bucket (50 MiB,
  `application/pdf`), and four policies mirroring `project_works`: read is
  membership, write is OWNER/ADMIN/CONTRIBUTOR.
- `packages/db/test/18_storage_rls.sql` — 21 assertions. Runs as
  `authenticated` rather than `porcupine_app`, which is the role the Storage
  API actually connects as and the only one with grants on `storage.objects`.
  Every zero is paired with the same count taken as `postgres`.
- `scripts/assert-rls.sh` — extended to the `storage` schema.

Each policy was dropped in turn and the suite watched to go red: `select` costs
5 assertions, each of the other three costs 1.

---

## 5. Stage 2 — upload

Client uploads directly to Supabase Storage with the user's own JWT. Bytes
never pass through a Vercel function, which sidesteps body-size and duration
limits exactly as the original R2 design intended.

`file_objects` is written `PENDING` first and flipped to `COMPLETE` on
confirmation. That enum exists because **an upload can succeed without the app
hearing about it** — the schema comment says so — which means this stage also
owes an orphan reconciler.

That reconciler has a pattern to follow: `/tasks/purge-accounts`
(`apps/web/src/app/tasks/purge-accounts/route.ts`) is a
`CRON_SECRET`-authenticated endpoint driven by `apps/web/vercel.json`. This is
its second consumer, and adding one is a route plus a cron entry.

**Validation at the boundary**: size cap, MIME allow-list, and magic bytes
(`%PDF-`). The extension and the declared content type are both
attacker-controlled; the first bytes are not.

---

## 6. Stage 3 — the reader

pdf.js with `isEvalSupported: false` and scripting disabled, per
`docs/02-security-and-e2ee.md` §7. Extract the text layer per page and hand it
to `packages/anchoring`, which already accepts a page number.

The abstract stays as the fallback when a work has no file, which will be most
works for a long time. The reader gains a source, it does not swap one.

**Watch the CSP.** pdf.js may want `wasm-unsafe-eval`; the security document
already requires that it be scoped to the worker rather than the document.

---

## 7. Stage 4 — the payoff

Quote-typed protocol fields anchor into the PDF text layer with a page number.

This is what the whole provenance design was built for. `enforce_value_anchor`
has refused un-sourced quotes since Phase 2, and the evidence table's
dotted-underlined cells have opened "the passage" since the same phase — but
the passage has always been a sentence in an abstract. This is the first time
clicking a cell lands on a page of the actual paper.

---

## 8. Deferred, and the UI must say so

**Virus scanning.** `docs/02-security-and-e2ee.md` §7: *"Do not claim files are
scanned until it exists."* There is no long-running process to run ClamAV in.
v1 has type validation, size caps and sandboxed rendering; the residual risk is
a malicious PDF downloaded and opened in a native reader, which sandboxing does
not cover. The upload screen states this rather than implying more.

**`DEVICE_ONLY`** and cross-user OA dedupe by content hash, per §2.

---

## 9. Two numbers to settle before starting

- **Supabase free tier is 1 GB.** One 300-paper review at ~2 MB a paper is
  600 MB, so a single real project fills most of it. Pro includes 100 GB. This
  decides itself quickly and should be decided deliberately rather than by a
  failed upload.
- **`file_size_limit = "50MiB"`** is set in `supabase/config.toml:118` for the
  local stack. The hosted project has its own limit, set in the dashboard, and
  the two should agree or local testing proves nothing about production.

---

## 10. Acceptance

The phase is done when a member can upload a PDF to a paper, another member of
the same project can read it and highlight it, a member of a different project
receives nothing from the storage API when asking for it by path, an extraction
quote resolves to a page of that PDF, and `pnpm verify --e2e` is green with the
storage policies asserted in pgTAP and `assert-rls.sh` covering the `storage`
schema.
