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

## 5. Stage 2 — upload — **done**

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

### What the stage actually found

**The magic-byte check has nowhere obvious to run, and the obvious answers are
both wrong.** The bytes never reach a server action, so there is no request to
inspect. Checking in the browser is worth doing — it refuses a Word document in
20 ms instead of after fifty megabytes — but it is a courtesy, not a control:
an upload that skips the form skips the check. Downloading the object in the
confirming action to look at it would pull up to 50 MB into a serverless
function to read five bytes.

The answer is a signed URL and a `Range: bytes=0-4` request: 206 Partial
Content, five bytes, nothing else transferred. Measured against local storage
before it was written into the code. This is also the check that the bucket's
`allowed_mime_types` cannot make — that setting refuses a declared `image/png`,
but a PNG *declared* `application/pdf` satisfies the extension, the header and
the bucket, and fails only here.

**The two policies disagreed about who may upload.** Stage 1 gated the object
on OWNER/ADMIN/CONTRIBUTOR; `file_objects_insert_own` asked only for
membership. A REVIEWER sat in that gap — allowed the metadata row, refused the
bytes, leaving a PENDING record that could never complete and would be swept to
ORPHANED an hour later with nothing explaining why. Aligned in this stage's
migration, and asserted from both sides.

**The reconciler is an anti-join, which is the backend decision paying off
again.** Finding objects no row claims would have meant paginating a bucket
listing and joining it in application memory under R2. `storage.objects` is a
table, so it is `not exists (select 1 from file_objects ...)`. Both listings
need a grace period, and that is correctness rather than politeness: an upload
in flight writes its object before the confirming action runs, so without the
window the sweeper deletes files out from under people watching a progress bar.

**A skipped test is how a scheduled job rots.** Both `/tasks` routes are closed
without `CRON_SECRET`, correctly, but that meant their specs skipped on any
machine that had never set one — and `/tasks/purge-accounts` has had no e2e
coverage at all since it shipped for exactly this reason. `scripts/verify.sh`
now supplies a fixed local value for the e2e run.

### Delivered

- `supabase/migrations/20260819141500_file_upload_reconciliation.sql` — the
  aligned insert policy, `stale_pending_uploads()` and
  `orphaned_paper_objects()`.
- `packages/shared/src/files.ts` — size, MIME, the PDF signature and the
  storage path, in one place because three enforcement points must agree.
- `apps/web/src/server/paper-files.ts` — one judgement of what an acceptable
  object is, called by the upload action with the user's JWT and by the cron
  with the secret key.
- The upload form on the reader, the two server actions behind it, and a
  `FileInput` primitive (the repo's own guard asked for it).
- `apps/web/src/app/tasks/reconcile-uploads/route.ts` plus its `vercel.json`
  entry.
- `packages/db/test/19_file_uploads.sql` (14 assertions) and
  `apps/web/e2e/file-upload.spec.ts` (7), including a planted non-PDF that
  never went past a browser and a non-member asking for the object by path.

---

## 6. Stage 3 — the reader — **done**

pdf.js with `isEvalSupported: false` and scripting disabled, per
`docs/02-security-and-e2ee.md` §7. Extract the text layer per page and hand it
to `packages/anchoring`, which already accepts a page number.

The abstract stays as the fallback when a work has no file, which will be most
works for a long time. The reader gains a source, it does not swap one.

**Watch the CSP.** pdf.js may want `wasm-unsafe-eval`; the security document
already requires that it be scoped to the worker rather than the document.

### What the stage actually found

**`isEvalSupported: false` no longer exists, and neither does the CSP.** The
option was removed upstream in pdf.js v5 along with the thing it guarded: the
built library at 6.2.108 contains no `eval(` and no `new Function(` in either
`pdf.mjs` or `pdf.worker.mjs`. Passing the option today would be a comforting
no-op. The requirement is now met by the library version rather than by
anything we write, so `apps/web/src/lib/pdf-text.test.ts` asserts the property
directly and turns red on an upgrade that reintroduces one. The wasm question
does not arise either: v6 uses WebAssembly only for JPEG 2000 and JBIG2 image
decoding, only when handed a `wasmUrl`, and the package ships no `.wasm` files.
And `apps/web/next.config.ts` sets no `Content-Security-Policy` header at all —
so there is nothing to scope. **That gap is real and is not this stage's to
close**, but it should be recorded rather than discovered again.

**There was nowhere to put the text.** `file_objects` has carried `text_status`
and `page_count` since Phase 1 with no table to hold the words, which is a
large part of why the reader still showed abstracts. `file_pages` is one row
per page — the unit `AnchorSelector.page` has always named and the unit a
reader cites — and it is insert-only. A re-extraction producing different text
is a different file, and every anchor into the old text needs to drift-check
against the new; making that an UPDATE would hide exactly what the anchoring
engine exists to report.

**Extraction runs in the browser.** The file is already in the uploading tab's
memory, so this costs no server time and never meets a function's duration
limit; the result is stored once and every other member reads it. It goes back
in chunks because a server action's body is capped at 1 MB and a 300-page
document clears that on its own — which would have worked in testing on short
papers and failed on precisely the long ones that need full-text reading.

**The upload said "done" before it was.** `completeUpload` called
`revalidatePath`, which re-rendered the reader, replaced the upload form with
"The PDF is attached", and unmounted the component that was still extracting
and storing text. Pages landed in the database while `text_status` stayed
PENDING forever, and anyone who navigated on seeing "attached" cut the
remaining work off mid-flight. The screen now changes once, at the end, when
the form asks for it — and a failed extraction is reported from stored state
rather than from component state that the refresh destroys.

**Attaching a PDF must not appear to destroy existing annotations.** Every
anchor made before this stage was captured against the abstract and carries no
page. Resolving those only against the new page text would turn a colleague's
highlights into a wall of "lost in this document" — so `resolveInSections`
looks for an exact match anywhere before it accepts a drifted one anywhere,
and an abstract quote lands on the paper's first page where it is usually
reproduced.

### Delivered

- `supabase/migrations/20260819160000_file_page_text.sql` — `file_pages`,
  insert-only, read by members, written by OWNER/ADMIN/CONTRIBUTOR.
- `apps/web/src/lib/pdf-text.ts` — extraction in a worker, text layer only, no
  canvas, no fonts, no wasm.
- `apps/web/src/lib/reader-document.ts` — placing a stored anchor in a
  paginated document, with unit tests for the migration case.
- The reader renders pages, labels them, and records the page a highlight was
  made on; the abstract remains the fallback.
- `packages/db/test/20_file_pages.sql` (9 assertions) and two more e2e tests:
  the paper's own pages become what you read, and a highlight on page two is
  recorded as being on page two.

**Not done here:** a visual PDF viewer. The reader annotates text, the
anchoring engine resolves against text, and a page image would add a canvas, a
font loader and the CSP argument above to buy something nothing in the product
needs yet.

---

## 7. Stage 4 — the payoff — **done**

Quote-typed protocol fields anchor into the PDF text layer with a page number.

This is what the whole provenance design was built for. `enforce_value_anchor`
has refused un-sourced quotes since Phase 2, and the evidence table's
dotted-underlined cells have opened "the passage" since the same phase — but
the passage has always been a sentence in an abstract. This is the first time
clicking a cell lands on a page of the actual paper.

### What the stage actually found

**The page was being dropped on the floor.** `AnchorSelector` has carried
`page` since Phase 1 and `anchors.page` has been a column for just as long,
but the extraction action's Zod schema did not accept the field and the anchor
was created without it. Nothing was broken by that until now — the only
quotable text was an abstract, which is not a page of anything — so it had sat
there as a column that was always NULL. Three lines, and the reason the rest of
the design needed no changes at all.

**One loader, or the provenance rots silently.** The extraction form and the
reader must show byte-identical text: a quote is captured against one and
resolved against the other every time somebody follows an evidence cell back
to its source. Two independently written queries would drift eventually — a
different `order by`, one of them joining the abstract in — and the symptom
would not be an error. It would be every historical citation quietly
downgrading to "possibly moved", months later, with nothing to point at. So
`loadPaperDocument()` is called by both, and the e2e test asserts OK rather
than merely "not broken".

### Delivered

- `apps/web/src/server/paper-text.ts` — the one loader.
- The extraction source panel renders the paper page by page, labelled, and
  `createSelector` records which page a quote came from.
- `page` accepted and stored by the extraction action.
- A `data-field-key` hook on each question, so one field of twenty can be
  addressed without depending on the DOM around it.
- Three e2e tests: a quote captured from page two, the stored anchor asserted
  in the database to carry page 2, and following it landing on that page with
  status OK.

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

## 10. Acceptance — **met**

The phase is done when a member can upload a PDF to a paper, another member of
the same project can read it and highlight it, a member of a different project
receives nothing from the storage API when asking for it by path, an extraction
quote resolves to a page of that PDF, and `pnpm verify --e2e` is green with the
storage policies asserted in pgTAP and `assert-rls.sh` covering the `storage`
schema.

Every clause has a test behind it, and they are named so a reader can check
rather than take this on trust:

| Clause | Where it is asserted |
| --- | --- |
| A member can upload a PDF | `file-upload.spec.ts` — "a member attaches the PDF" |
| Another member can read and highlight it | `file-upload.spec.ts` — "the paper's own pages become the thing you read", "a highlight on page two" |
| A different project gets nothing by path | `file-upload.spec.ts` — "gets nothing when asking by path" (non-200 for a stranger, 200 for the owner) |
| A quote resolves to a page of the PDF | `file-upload.spec.ts` — "the stored anchor carries the page", "following it opens the paper at that page" |
| Storage policies in pgTAP | `18_storage_rls.sql` (21), `19_file_uploads.sql` (14), `20_file_pages.sql` (9) |
| `assert-rls.sh` covers `storage` | Refuses a public bucket and a bucket no policy names; both sabotage-tested |

`pnpm verify --e2e`: 201 passed.

### What is still open

- **§9 is undecided and is not a code question.** The hosted project's
  file-size limit must match the 50 MiB baked into the bucket, and the free
  tier's 1 GB holds roughly one 300-paper review.
- **`CRON_SECRET` must be set in Vercel** or `/tasks/reconcile-uploads` stays
  closed and abandoned uploads bill forever.
- **There is no `Content-Security-Policy` header at all** (`next.config.ts`).
  Unrelated to files, discovered here, and larger than this phase.
- **Deferred by §8 and still deferred:** virus scanning, `DEVICE_ONLY`, and
  cross-user OA dedupe by content hash. The `sha256` recorded at upload is
  client-asserted and must be re-derived server-side before it is ever used to
  decide that two users may share bytes.
- **No visual PDF viewer.** See §6.
