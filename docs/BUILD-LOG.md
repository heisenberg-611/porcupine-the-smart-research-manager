# Porcupine — Build Log

A running record of what was actually built, what it cost, and where reality diverged from the plan.

**Why this exists.** The plan documents say what we intend. Git says what changed. Neither says *what we learned building it* — which assumptions broke, which decisions got made under the keyboard rather than in an ADR, and which numbers turned out wrong. That gap is where the plan quietly rots. This file closes it.

**Convention.** One entry per phase, appended at the end of that phase, plus an entry for any replan. Every entry carries the same six headings, and **"Deviations" and "Problems" are never empty by omission** — if nothing went wrong, say so explicitly, because a phase with no surprises is itself information.

Anything here that contradicts a numbered doc means the numbered doc is stale. Fix it and note the fix under *Doc drift*.

---

## 2026-08-13 · v6 replan — Cloudflare → Vercel

**Trigger.** Vercel became available again, which invalidated the hosting half of the plan.

**Shipped.** `05-resolution-plan.md` (every conflict in `04` gets a mechanism and an acceptance test), ADR-019/020/021/022, and v6 revisions across `00`–`04`.

**Verification.** Limits confirmed against vendor docs rather than memory: Vercel Hobby is 300 s max duration / 2 GB / full Node (not the 10 s figure some blogs report); Supabase Realtime bills per delivered message *per subscriber*; Durable Objects bill incoming WebSocket messages 20:1 and are on the free plan.

**Decisions.**
- Split "where files live" from "where compute lives." The zero-egress argument was always an argument for R2, never for Workers. Keeping R2 and moving compute to Vercel gets both.
- Kept the Durable Object as a standalone relay. E2EE makes this clean: the relay *cannot* decrypt Yjs ops, so it was always a dumb ciphertext shuffler, and the 10 ms CPU cap that killed SSR on Workers is irrelevant to it.
- Cut volume-based contribution analytics outright (ADR-022) rather than mitigating C-07.

**Deviations from prior plan.** Three high-severity risks deleted (workerd/Prisma, bundle size, free-tier CPU). One new risk created (no inbound WebSockets). Timeline 38 → 34 weeks; MVP held at ~11.

**Problems.** SSRF posture got *worse* and the plan initially didn't say so — Cloudflare had no cloud metadata endpoint, Vercel-on-Lambda does. `02-security-and-e2ee.md` §7 now states this and the SSRF controls are marked load-bearing rather than defence-in-depth.

**Open.** Pricing numbers (forced by Vercel Hobby's non-commercial ToS). The three week-1 spikes.

---

## 2026-08-13 · Phase 0, week 1 — workspace + security boundary

**Planned:** `06-phase-0-build-plan.md` tasks 1.1–1.7.
**Status:** all seven complete. Week 2 not started.

### Shipped

| Task | Outcome |
|---|---|
| 1.1 | pnpm 11 workspace, TS strict (+`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint flat config, Prettier |
| 1.2 | `apps/web` — Next 16.3, React 19.2, Tailwind 4, design tokens, skip link |
| 1.3 | Local Supabase on Docker, Postgres 17.6 |
| 1.4 | Prisma 7 schema, Phase 0 slice: 7 tables, 8 enums |
| 1.5 | RLS baseline — FORCE on all 7 tables, `porcupine_app` without BYPASSRLS, 3 `SECURITY DEFINER` helpers |
| 1.6 | pgTAP: 31 assertions + the concurrency test |
| 1.7 | CI: 4 jobs — static, boundaries, RLS, a11y |

Plus, ahead of schedule: `capabilities(kind)` in `packages/shared` (R-06), and the a11y gate (task 2.6) landed early because it was cheap once Playwright existed.

### Verification — measured, not asserted

```
pnpm typecheck      ✓  3 packages
pnpm lint           ✓  clean
pnpm format:check   ✓  clean
web build           ✓  2.2s (Turbopack)
pnpm db:test        ✓  31 assertions + concurrency · 0.4s against a 90s budget
pnpm test:e2e       ✓  4 tests, 0 WCAG 2.2 AA violations, desktop + mobile
```

**The R-02 proof.** 800 scoped reads across 32 concurrent clients over a deliberately undersized pool (pool max = clients/4, so connections are reused aggressively — reuse is the condition a leak needs). Zero cross-tenant rows. Zero cases of a claim surviving commit onto a reused connection.

C-02 was the highest-severity item in `04-conflicts-and-hazards.md`. It is now **proven** closed rather than argued closed, and the proof runs on every PR.

### Decisions made during the build

These were made at the keyboard and are recorded here rather than as ADRs, because none of them is expensive to reverse.

1. **snake_case columns + `timestamptz` everywhere.** Prisma defaults to camelCase columns and naive `timestamp`. Hand-written RLS and pgTAP are first-class artifacts in this project, and quoted `"camelCase"` in SQL is a permanent tax. `timestamptz` closes hazard B-07 before any date math exists. Cost: `@map` on every column.
2. **TypeScript held at 5.9 although 7.0 is GA.** `typescript-eslint` and the Next plugin are guaranteed against 5.9. Revisit when the ecosystem catches up; nothing in the codebase depends on the difference.
3. **Migration ownership split.** Prisma owns the schema; `supabase/migrations/` owns what ran; `prisma migrate diff` is the bridge; RLS is hand-written SQL. `prisma migrate dev` must never touch this database — it doesn't know about policies and would drop them. Now stated in the schema header.
4. **`grant porcupine_app to postgres`.** Without it, pgTAP can't `SET ROLE` and would test as superuser — which passes regardless of policy and proves nothing. Membership does not grant bypass.
5. **The a11y gate runs on a mobile viewport too.** Responsive is a stated requirement; touch-target and reflow violations only appear there.

### Deviations from the plan

| Plan said | Reality | Action |
|---|---|---|
| Next.js 15 | Next 16.3 is current | Took 16.3. Docs updated. |
| Prisma (unversioned) | Prisma 7 moves connection URLs out of the schema and **requires a driver adapter** | Took it — the Supabase pooler guidance assumes 7. Added `@prisma/adapter-pg`. |
| Phase 0 = 2 weeks | Week 1 done in one session | Sequencing held; no scope was skipped. |
| shadcn/ui in 1.2 | Not installed | Deferred to week 2 — no component needed one yet, and installing a library before a use case is how design systems get incoherent. |

### Problems hit

1. **Corepack couldn't activate pnpm 11** (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`) and its shim then blocked `npm i -g`. Fixed by `corepack disable`, removing the shims, installing via npm.
2. **`grant porcupine_app to supabase_admin` aborted the whole migration** — reserved role, superuser only. The failure left `porcupine_app` uncreated, so 11 downstream assertions failed with a misleading "role does not exist." Removed the grant.
3. **pgTAP `has_function` needs the quoted enum type** — `"AccessRole"[]`, not `AccessRole[]`.
4. **`LayoutProps` doesn't exist before a build.** Next 16 generates it into `.next/types`, so a cold `tsc --noEmit` fails. Wrote explicit prop types instead — better anyway, since CI typechecks before building.
5. **`exactOptionalPropertyTypes` rejected `workers: undefined`** in the Playwright config. Conditional spread. The flag doing exactly its job.
6. **Removing a zero-width space broke a block comment.** `apps/*/src/server/db` contains `*/`, which terminates it. The ZWSP had been load-bearing. Reworded the comment.
7. **Prettier reformatted all the prose docs** on first run, mangling hand-aligned tables. Added `docs/**` to `.prettierignore`.

### Doc drift corrected

- `00-product-plan.md` and `06-phase-0-build-plan.md` said "Next.js 15" — now 16.
- `06-phase-0-build-plan.md` said `prisma migrate diff --to-schema-datamodel`; the flag is `--to-schema` in Prisma 7.

### Open going into week 2

- **Highest risk in the stack is now the DO relay (R-21)**, having inherited the title from the workerd question Vercel deleted. Unproven in this codebase.
- Docker is allocated 3.8 GB. C-13 budgets the browser against a 4 GB tablet *while* the local stack runs — worth watching before Phase 5.
- Pre-flight items still open: R-08 (Docs named-range marker), R-14 (`Work.language` — lands with the `Work` table in Phase 1), R-20 (pricing).
- Week 2: Supabase Auth, identity keypairs at signup, create-project / invite-member, shadcn/ui.

---

## 2026-08-13 · Phase 0, week 2 — auth, identity keys, and the exit criterion

**Planned:** `06-phase-0-build-plan.md` tasks 2.1–2.9.
**Status:** the exit criterion is met and passing end to end. Two doc-only pre-flight items remain.

### Shipped

| Task | Outcome |
|---|---|
| 2.1 | `withUserContext` was already in place; the ESLint boundary and CI greps now have real code to guard |
| 2.2 | Supabase Auth — email OTP, browser/server clients, session-refresh middleware, callback + sign-out routes |
| 2.3 | `packages/crypto` — X25519 + Ed25519 generated in-browser, private bundle wrapped under an Argon2id KEK |
| 2.4 | Create project (atomic with owner membership), invite member with the ADR-006 history prompt |
| 2.5 | Hand-written primitives — `Button`, `Field`, `Input`, `Select`, `Textarea`, `Card`, `EmptyState`, `Banner` |
| 2.6 | a11y gate extended to `/sign-in` |
| 2.7 | **Done differently, and better** — see Deviations |
| 2.8 | Still open (doc-only) |
| 2.9 | Still open (doc-only) |

Also landed: `handle_new_auth_user` trigger, database-level `updated_at` triggers, and OTP email templates.

### Verification

```
pnpm typecheck      ✓  4 packages
pnpm lint           ✓  clean        pnpm format:check   ✓  clean
web build           ✓  8 routes + middleware
crypto tests        ✓  8 passed
pnpm db:test        ✓  31 assertions + concurrency · 0.4s
pnpm test:e2e       ✓  20 passed — 10 checks × desktop and mobile
```

**The exit criterion runs for real.** The e2e suite signs up through the UI, reads the OTP out of Mailpit, generates actual Argon2id-wrapped keys, creates a project, and invites a supervisor. Nothing is mocked.

Three assertions are worth naming because they encode decisions rather than behaviour:
- **Enrollment cannot run twice.** Regenerating would strand every ciphertext already wrapped to the old key.
- **"cannot be recovered" is asserted visible** at the moment the passphrase is shown. If that warning ever moves to a help article, the test fails — which is the point.
- **The wrapped bundle contains no cleartext private key**, checked by hex-substring search over the exact blob the server stores.

### Decisions made during the build

1. **The recovery passphrase *is* the KEK source.** There is no password to derive from — auth is OTP and OAuth. ADR-009's mandatory recovery codes therefore do double duty as account recovery *and* the only thing between the server and the private keys. Consequence stated in the UI at the moment it matters: lose it, lose encrypted content.
2. **Six-digit codes, not magic links.** Links break in webmail previewers and in-app browsers, a code can be typed on the device that asked for it, and it is the only variant testable without driving a mail client. Required overriding two Supabase email templates, which default to `{{ .ConfirmationURL }}` only.
3. **Project creation is one transaction.** `projects_insert_self` lets anyone create a project, but `projects_select_member` makes a member-less project invisible to everyone including its creator. The transaction is what makes the permissive insert policy safe.
4. **No permission checks in `inviteMember`.** Authorization is entirely the RLS policy's job. Adding an application-level check would create a second source of truth that can drift from the policy.
5. **Invite errors do not distinguish "no account" from "not permitted."** The `users` policy means a stranger's row genuinely isn't visible, which doubles as not confirming whether an address has an account.
6. **Prisma client is now lazy** behind a Proxy. Eager construction meant importing a module required a live `DATABASE_URL` — which broke `next build` — and opened a pool in every serverless instance that imported it without querying.

### Deviations from the plan

| Plan said | Reality | Action |
|---|---|---|
| 2.5 shadcn/ui | Hand-written primitives | Still deferred. Nothing yet needs a dialog, menu, or combobox — Radix's value is keyboard/focus semantics for those, and there are none. Pulling it in now would be cargo cult. |
| 2.7 `Work.language` column in the baseline migration | `Work` does not exist until Phase 1 | **Encoded the decision instead**: `text_search_config(lang)` and `build_tsvector(lang, body)`, both `IMMUTABLE` so they can back generated columns. R-14's actual requirement was that the decision be settled before the first searchable table exists — it now is, and Phase 1 inherits it. |
| 2.2 Google OAuth | Email OTP only | Deferred. Google OAuth needs real credentials and a consent screen, which is setup work with no code risk. The callback route is written and works. |

### Problems hit

1. **libsodium-wrappers-sumo@0.7.16 ships a broken ESM build** — it imports `./libsodium-sumo.mjs`, which is not in the package. The `libsodium-sumo` package *does* ship that ESM artifact; only the specifier is wrong. Tried a bundler alias first (Turbopack mangled the absolute path into a relative one), then fixed it properly with `pnpm patch` changing the specifier to `libsodium-sumo`. **The patch file is 198 KB because the source is minified to one line** — ugly in a diff, but it fixes resolution for every consumer including the future relay, rather than needing an alias in each.
2. **Argon2id parameters read at module load were `undefined`.** libsodium populates its constants during `ready`, so `crypto_pwhash_OPSLIMIT_INTERACTIVE` captured at import is nothing. Moved to a call-time accessor.
3. **`@prisma/client-runtime-utils` was in the store but unlinked**, so the generated client (which lives outside `node_modules`) could not resolve it. Added as an explicit dependency.
4. **`.js` extensions in relative imports don't resolve under `moduleResolution: "Bundler"`.** Correct for NodeNext, wrong here. Stripped.
5. **`useSearchParams` without Suspense** opted `/sign-in` out of static prerendering and failed the build.
6. **Next only reads `.env` from the app directory.** Symlinked `apps/web/.env.local` → root `.env`; gitignored, and production env comes from Vercel.
7. **Playwright gives each test a fresh context**, so the session cookie vanished between steps of what is one continuous journey. Switched to a shared page across the serial block.
8. **Playwright compiles its config to CJS**, so `import.meta` is unavailable there — used `process.cwd()` instead.
9. **`getByText("OWNER")` matched three elements** because the generated test email started with `owner-` and `getByText` does case-insensitive substring matching. Renamed the fixtures and used `exact: true`.
10. **Vitest picked up the Playwright specs.** Scoped it to `src/**`.

### Open going into Phase 1

- **R-21 (DO relay) is still the highest risk in the stack** and still unproven.
- Pre-flight leftovers, both doc-only: **R-08** (Docs named-range marker format) and **R-20** (pricing numbers, forced by Vercel Hobby's non-commercial ToS).
- Google OAuth needs credentials before it can be finished.
- Email invitations for people without accounts need a token table and a transactional provider — folded into G-01 (notifications) in Phase 1.
- The 198 KB libsodium patch should be dropped the moment upstream fixes the ESM artifact.

---

## 2026-08-13 · R-21 spike — the collaboration relay · **GO**

**Trigger.** ADR-020 was the highest-risk unknown left in the stack: Vercel cannot hold an inbound WebSocket, and nothing in the codebase proved a Durable Object could do the job.

**Verdict: GO.** ADR-020 stands. `apps/relay` is real code, not a throwaway.

### Shipped

- `packages/shared/src/relay-ticket.ts` — Ed25519 ticket mint/verify on Web Crypto only, so identical code runs on Node 24 and workerd. Plus the wire protocol types.
- `apps/relay` — Worker + `LatexDoc` Durable Object, SQLite-backed, WebSocket Hibernation.
- `apps/web/src/server/relay.ts` — the minting half, which is the side that owns the database.
- `apps/relay/scripts/generate-keys.mjs` — per-environment keypair generation.

### Verification — 13 acceptance tests, real workerd

```
ticket authorization   ✓ 8   no ticket · non-upgrade GET · health · forged signature
                             · edited payload · expired · wrong file · valid
collaboration          ✓ 3   awareness fan-out (not to sender) · persistence and
                             replay to a late joiner · stale-epoch rejection
latency budget         ✓ 1   p50 0.3ms · p95 0.7ms over 120 rounds, 4 clients
durability             ✓ 1   no content loss across a full disconnect cycle
```

**On the latency number.** 0.7 ms p95 is loopback, and it does *not* mean production p95 will be 0.7 ms. What it proves is that **the relay contributes approximately nothing to the 150 ms budget** — the budget is network RTT, which is what it was always going to be, and which a single-region DO fan-out is the right shape for. Claiming the acceptance criterion is met in production would be dishonest until it runs on real Cloudflare with real clients.

**The 20-minute soak was not run.** Thirteen scripted tests are not the same as four humans editing for twenty minutes. That test belongs in Phase 5 against a real Yjs document, and it is recorded as outstanding rather than quietly dropped.

### Decisions made during the build

1. **Ed25519, not HMAC.** With a shared secret the relay would hold a key capable of *minting* tickets, so compromising it would mean forging access to any document. Asymmetric means the relay can only verify, and a full compromise yields nothing beyond the ciphertext it was already shuffling.
2. **Tickets are bound to a file, and `expectedFileId` is a required argument.** A ticket that verifies cryptographically but was minted for another document is precisely the attack the binding exists to stop; making the check optional invites forgetting it.
3. **The relay fails closed with no key configured** — 503, never a fallback to trusting the ticket payload.
4. **Rejection reasons go in a header, never the response body.** The body is what a curious browser console displays.
5. **`mintRelayTicket` performs no authorization of its own.** A helper that sometimes checks and sometimes doesn't is worse than one that never does, because the caller stops thinking about it. Callers must have run `is_project_member` first, and the doc comment says so.
6. **Awareness and updates are separate channels on one socket.** Awareness is fanned out and never stored; updates are appended and replayed. Keeping them distinct is what stops cursor traffic from bloating document history — the exact failure that made Supabase Realtime the wrong shape.

### Deviations

| Expected | Reality |
|---|---|
| Relay would be the hard part | It was the easy part. The DO model fits this problem almost exactly — one actor per file, hibernation for idle cost, SQLite for the op log. The fiddly work was ticket handling, not collaboration. |
| 20-minute four-browser soak | Deferred to Phase 5 with a real Yjs document. Scripted tests cover the mechanics; the soak covers the thing scripts can't. |

### Problems hit

1. **`pnpm` wrote a malformed `allowBuilds` entry** (`workerd: set this to true or false`) into `pnpm-workspace.yaml`, producing a YAML duplicate-key error that broke every subsequent command. Hand-corrected.
2. **Node's `fetch` refuses to send an `Upgrade` header** (`UND_ERR_INVALID_ARG`), so the no-ticket case had to go through a real socket. Turned into three sharper tests instead of one.
3. **`packages/shared` had no DOM lib**, so `TextEncoder`, `crypto`, `CryptoKey`, and `btoa` were untyped. Added `DOM` — these globals exist in both Node 24 and workerd; the DOM lib is just where TypeScript keeps their declarations.
4. **ESLint's `no-undef` fired on `crypto` and `Buffer`** in scripts and tests. Extended the globals block to cover test files too.

### Also closed this session

The last two Phase 0 pre-flight items, both doc-only:

- **R-08 — the Docs provenance marker format.** Google Docs **named ranges**: `pcp.cite.<citationKey>`, `pcp.claim.<claimId>`, `pcp.bib.<protocolVersion>`. Invisible to the writer, survive editing, readable via the API. Sentinel text was the alternative and is worse in every way — users delete it, reformat it, and paste it into their prose. Recorded in `00-product-plan.md` §5.2 **with the reason it could not wait**: Docs written before the format exists have no markers and cannot be retrofitted, so every Doc in that window would be permanently un-importable by the Phase 5 Doc → LaTeX path.
- **R-20 — pricing.** Free (1 project, 2 GB, unlimited collaborators) · Researcher $6/mo · Lab $5/seat · Institution quoted. Numbers provisional, shape not. Collaborators and supervisors are never billed — charging for them taxes exactly the behaviour the product exists to encourage. Storage is the metered axis because storage is the cost that scales with users. In `00-product-plan.md` §8.1.

**Phase 0 is complete.** Every definition-of-done item is ticked and every pre-flight item is closed.

### Open

- The 20-minute soak, in Phase 5.
- `docEpoch` currently bootstraps from the first ticket. Phase 5 must make Postgres the authority and have the relay read it, or a malformed first connection could pin a document to the wrong epoch.
- The remaining two spikes: **R-01** (`docEpoch` protocol, offline-Alice/PR-Bob) and **ADR-007** (WASM TeX on a real thesis).

---

## 2026-08-14 · Phase 0 merged — CI runs for the first time

### Shipped

PR #1 merged to `main`. All six jobs green on a clean Ubuntu runner, first attempt: static 0.9 min · boundaries 0.1 min · RLS 3.5 min · unit 0.7 min · relay 0.8 min · e2e 4.8 min.

The 3.5 min RLS figure is **not** the pgTAP suite against its 90 s budget (hazard B-03) — nearly all of it is `supabase start` pulling Docker images. The suite itself is still 0.5 s. Watch the suite, not the job.

### Problems hit

1. **CI had never actually run.** The workflow triggers on `push: branches: [main]` and `pull_request`; `phase-0-foundations` was pushed but was neither, so every "green" result through Phase 0 was local-only and "pgTAP is a merge gate" was a claim about a YAML file. Closed by opening PR #1. Worth remembering: a gate is not a gate until it has been observed to run.
2. **Duplicated `upload-artifact` step** in the e2e job — same artifact name twice, both `if: failure()`. v4 rejects a duplicate name, so the second would 409 exactly when a test had failed and the report was worth having. Removed.
3. **The forged-signature relay test was flaky at ~25%, and failed on the post-merge `main` run.** No relay bug: the test was wrong. It tampered with the ticket by editing the *last base64url character* of the signature. A 64-byte Ed25519 signature is 512 bits, but 86 base64url characters carry 516 — the final character holds 2 meaningful bits and 4 of padding, so real signatures only ever end in `A`, `Q`, `g`, or `w`. Swapping a trailing `A` for `B` changes nothing but padding, decodes to identical bytes, and the relay then correctly verified a genuine signature. The PR run passed on luck. Fixed by flipping a bit in the *decoded* signature. Verified 5/5 consecutive runs.

   The general lesson, worth carrying into Phase 1: **a negative test that passes is not evidence until you know it can fail.** This one asserted a rejection that the relay was never asked to make.

### Open

Unchanged from the entry above — the 20-minute soak, `docEpoch` bootstrap authority, and the R-01 and ADR-007 spikes.

---

## 2026-08-14 · Phase 1, week 1 — corpus schema, RLS, language-aware FTS

### Shipped

Eight tables — `works`, `project_works`, `project_work_questions`, `questions`, `saved_searches`, `file_objects`, `anchors`, `annotations` — each with RLS enabled, forced, and policied in the same migration. Plus `packages/db/scripts/diff.mjs`, which `package.json` had referenced since Phase 0 without it existing.

Two tables are not shaped like the Phase 0 ones:

- **`works` is deliberately global.** Bibliographic metadata is public fact; per-project copies would mean re-fetching every provider for every project. It has **no write policy at all** — writes go through `upsert_work()`, a SECURITY DEFINER function owning normalization and identifier dedupe. A per-user write path on a shared table is a cross-tenant integrity risk, and `citation_key` must never move once a LaTeX project cites it.
- **`annotations` separates PRIVATE from PROJECT**, and PRIVATE excludes the project owner. A private reading note a supervisor can read is not private. There is also no moderation path: an owner who could rewrite a supervisor's comment makes the review trail worthless.

A REVIEWER can annotate but cannot change a screening decision.

### Verification

| Check | Result |
| --- | --- |
| `pnpm db:test` | 61 assertions + concurrency, 0.5 s (budget 90 s) |
| sabotage probe | red in 3 independent places, restored, green |
| `pnpm db:diff` | no drift |
| CI | 2 jobs green on a clean runner |

### Problems hit

1. **A live R-14 bug.** `text_search_config` was `STRICT`, so a NULL language short-circuited to NULL instead of falling through to `simple` — making the `coalesce(lang,'')` in its body dead code for exactly the case it existed to handle. Most providers do not report a language, so most works would have had a NULL `search_tsv` and been **silently unfindable**: no error, just a search returning less than it should. Fixed in its own migration; CI now greps for hardcoded configs; `01-data-model.md` §4 contained the same wrong pattern and was corrected.
2. **`db:diff` wanted to destroy search.** It proposed dropping the three GIN indexes and `ALTER COLUMN search_tsv DROP DEFAULT` — which reads harmlessly and deletes the generation expression. Fixed by declaring the generated column (`Unsupported` + `dbgenerated()`) and the GIN indexes in `schema.prisma`. A drift check now runs in CI.
3. **The pgTAP runner had the relay flake's disease.** It only grepped `^not ok`, so a plan mismatch — assertions silently not running — reported success. Found because this week's first draft planned 18 tests, ran 16, and passed. It now also fails on plan mismatches, pgTAP's own failure summary, and suites producing no assertions.
4. **RLS raises 42501 on INSERT but silently filters UPDATE.** A `throws_ok` assertion on a forbidden UPDATE was simply wrong; rewritten to assert the effect and read the value back.

### Decisions made during the build

**The mutation rule, now standing policy.** Every `count(*) = 0` assertion is paired with the same query run with RLS disabled, which must return rows. A zero in both conditions means the test was vacuous. This is the Phase 0 relay flake generalized, and it immediately caught a vacuous assertion of my own in week 2's rate-limit suite.

---

## 2026-08-14 · Phase 1, week 2 — providers, dedupe, rate limiting, SSRF

### Shipped

`packages/discovery`: SSRF-safe fetch, the Postgres token bucket, identifier and title normalization, five provider adapters (OpenAlex, Crossref, arXiv, Europe PMC, Semantic Scholar), union-find dedupe, and federated search with partial failure.

### Verification

| Check | Result |
| --- | --- |
| discovery tests | 96 passed |
| `pnpm db:test` | 79 assertions + 2 concurrency proofs, 0.7 s |
| token bucket under load | **exactly 12/24 takes granted against a bucket of 12** |
| typecheck · lint · format | clean |

### Problems hit

1. **`timestamptz(3)` broke the token bucket.** Millisecond precision rounds the stored timestamp, and when it rounds *up* the next read computes a **negative** elapsed time — so a freshly created, full bucket refills by a negative amount and refuses its own first token. In production: the first arXiv call after a cold start intermittently sleeping three seconds for nothing. Fixed with full precision plus `greatest(0, …)`, which also guards a clock moving backwards.
2. **Title normalization deleted whitespace instead of collapsing it.** Stripping punctuation before collapsing whitespace turned `Deep\n  Learning` into `deeplearning`. **arXiv's Atom feed wraps titles across lines**, so this would have broken arXiv↔OpenAlex dedupe on precisely the papers most likely to appear in both. The SQL had the identical bug, so the two agreed with each other and were both wrong. Fixed on both sides, with `05_normalize_parity.sql` as the canary.
3. **A vacuous assertion of my own.** "The bucket table is not readable directly" ran before any bucket existed, so it compared an empty table against zero. Moved after the first take, with a companion assertion that the row it cannot see does exist.
4. **`upsert_work()` in a WHERE clause never ran.** Postgres evaluates it per candidate row and `works` starts empty, so it scanned nothing and returned NULL. The insert has to precede the read explicitly.

### Decisions made during the build

- **Fuzzy title matching never auto-merges.** A wrong automatic merge destroys one of two genuinely different papers and gives the user no way to notice — the losing paper simply never appears and nothing looks broken. Near-matches are surfaced as candidates for a human instead.
- **Partial failure is the design point**, not an error path. Five providers means five chances to be down; four sets of results beat an error page. A rate-limited provider is reported as a failure rather than stalling the search, so no search is as slow as the slowest provider.
- **Ed25519-style reasoning applied to open access:** `oaPdfUrl` is set only when a provider states the file is open. Crossref's `link` entries are publisher URLs, not proof, so Crossref never sets it. R-04 depends on that field being trustworthy.

### Open

- ~~The DNS-rebinding TOCTOU window is not closed.~~ **Closed the same day**, before starting week 3. `safeFetch` now connects through a `pinnedAgent` that overrides the socket's `lookup`, so the connection goes to the address that was validated instead of to whatever DNS answers a second time. Every redirect hop is revalidated and pinned independently; Host header and TLS SNI still carry the original hostname, so certificate verification is unaffected.

  Proven in both directions, because "it failed" is not by itself evidence of a working security control: pinned to an unrelated public address the request fails, and pinned to the host's own real address it returns 200. The first alone would also pass if pinning simply broke everything.

  `SSRF_KNOWN_GAPS` now lists one item, and it is an availability concern rather than a security one: we validate every address a host resolves to but pin the first, so there is no failover if that one is unreachable. *(Closed 2026-08-15 — see the entry at the end of this log.)*
- The R-04 OA dedupe rate (assumed 45 %) is still unmeasured; it needs a real corpus, which arrives with week 3's search UI.
- Unchanged from Phase 0: the 20-minute soak, `docEpoch` bootstrap authority, and the R-01 and ADR-007 spikes.

---

## 2026-08-14 · Phase 1 weeks 3–6 and the R-04 measurement

### Shipped

Search (week 3), import and library (week 4), screening and the queue (week 5), the anchoring engine, reader and progress view (week 6). Each has its own PR and its own reasoning; what follows is what those entries would otherwise repeat.

### The R-04 number, finally measured

`05-resolution-plan.md` had carried "45 %, measure it in Phase 1" since the v6 replan. Measured across 293 deduplicated works in six fields: **66.6 %** report an open-access PDF.

The assumption was pessimistic, and **its caveat was wrong in direction**: the plan said 45 % was "optimistic for humanities", but humanities measured 58 %. The lowest field was ecology at 46 % — at the assumed rate, not below it.

It is a **ceiling, not the answer**. It measures OpenAlex's `is_oa`, which says a free copy exists; it does not check the licence, and R-04 only allows `R2_SHARED` for files verified redistributable. That needs Unpaywall, in Phase 2. The planning figure stays 45 % until then, because a green-OA copy in a repository is readable by anyone and still not ours to serve to a second user.

The measurement lives in `packages/discovery/test/oa-rate.measure.ts`, deliberately outside the default suite: it makes real provider calls, and a measurement that runs in CI is one that eventually gets deleted for being flaky. It asserts only that the sample is large enough — **not** that the rate clears 45 %, because an assertion there would turn a measurement into something that gets adjusted until it passes.

### Problems hit

1. **A stacked PR missed the merge.** PR #7 (week 6) was based on `phase-1-screening`; PR #6 merged that branch into `main` at 08:06:22 and #7 merged into it 14 seconds later — into a branch that had already been merged away. Week 6 was absent from `main` and nobody would have noticed until the next branch cut from it. Landed via PR #8. A stacked PR only works if it merges first, and I did not say so when opening it.

2. **Three bugs, one shape.** `previewImport` called external providers with no authorization check — it writes nothing, so the check looked unnecessary, but it spends the shared R-22 token bucket and any signed-in user could have used it as a free proxy. Annotations vanished entirely on a record with no abstract. A PostgREST embed failed and the ignored error rendered as "0 annotations".

   The last two are the same mistake: **an error path and an empty path rendering identically**. Query errors now throw.

3. **Vitest 4 removed the `--include` CLI flag**, so the measurement script needed its own config file rather than a one-line override.

4. **A test that asserted nothing.** The first version of the reader e2e was called "highlights a passage" and only checked an empty state, because BibTeX imports carry no abstract. Fixed by giving the fixture a real abstract and driving a DOM selection, so it now highlights, reloads, and asserts the mark is painted with no drift warning.

### Open

- **The 300-paper, 4-person trial has not run.** Everything works at 2 papers and 1 person. That is Phase 1's exit criterion and the thing that would actually tell us whether this is usable.
- Unpaywall licence verification, for the real redistributable rate.
- PDF reading, which needs the R2 file pipeline.
- Unchanged from Phase 0: the 20-minute relay soak, `docEpoch` bootstrap authority, and the R-01 and ADR-007 spikes.

---

## 2026-08-14 · Phase 1 exit trial — 4 people, 300 papers · **it found a real bug**

### What ran

Four real accounts, four browser sessions, 300 real papers from OpenAlex imported through the actual import path — parse, dedupe, `upsert_work`, RLS. Not a seeded database: seeding rows behind the app would skip most of what could break at this size.

| step | time |
| --- | --- |
| preview 150 BibTeX entries | 163 ms |
| commit 150 papers | 409 ms |
| preview + commit second 150 | 174 / 384 ms |
| library page, 300 rows | 181 ms |
| progress page | 105 ms |
| concurrent screening, 4 × 5 | 1552 ms |

Comfortably inside the 3 s budget. **Performance was never the problem.**

### The bug it found

**Four members screening the same queue silently overwrote each other.**

The screen page serves every member an identical list ordered by relevance, and each session starts at index 0 — so all four screened the same papers. 20 decisions produced **7 screened papers**, and every member's UI reported "5 decided this session". Last writer won.

For a systematic review this is serious rather than merely wasteful: a supervisor's exclusion could be reversed by a colleague's include, with no indication anywhere a human would look. And it is invisible to any single-user test, which is exactly why the exit criterion says *four people*.

### The fix, in two parts

1. **Compare-and-swap.** `recordDecision` now takes the status the client was DISPLAYING. If the row has moved since, the decision is refused and reported — `ok: true` with a conflict, because nothing went wrong, the paper is simply already handled.

2. **`SELECT … FOR UPDATE`.** CAS alone still left a window: two members can both read `IDENTIFIED` before either writes. The trial reproduced it — 14 of 15 collisions caught, one slipped through. Locking the row serializes the read-modify-write, for the same reason `rate_limit_take()` locks (R-22).

| | decisions recorded | distinct papers | silent overwrites |
| --- | --- | --- | --- |
| no check | 20 | 5 | **15** |
| CAS only | 6 | 5 | **1** |
| CAS + FOR UPDATE | 5 | 5 | **0** |

The screening header also now shows *"N already handled by someone else"*. Duplicated effort is worth surfacing: a screener who cannot see it has no way to know their afternoon overlapped a colleague's.

### Problems hit

1. **The first fix did nothing, and the tests still passed.** The client edit failed to apply — a scripted replacement did not match after Prettier reformatting — so the server had the check and the client never sent the field. Caught only by querying the database directly and seeing 20 decisions again. A green run is not evidence the change took effect.
2. **The trial's first assertion was wrong.** It expected `screened === 20`, which assumed no collisions. Four people sharing a queue landing on the same paper is legitimate; a decision *silently overwriting* another is not. Rewritten to assert the invariant rather than the tidy number.
3. **Counting the toast measured the wrong thing.** The conflict message shows only the last outcome, so counting it tested whether the *final* decision happened to collide. Replaced with a running tally, which is better UX anyway.

### What this does NOT prove

Whether screening 300 papers in this UI is bearable. That needs four humans and an afternoon, and no test substitutes for it. Everything above is about correctness and speed, not ergonomics.

### Open

- **A shared queue is still a queue four people collide in.** Conflicts are now detected and reported rather than silent, but nobody is *partitioned*. The product answer is assignment-driven screening — screen your queue, not the project's — and that is a Phase 2 decision, not a bug fix.
- Unpaywall licence verification, for the real redistributable rate.
- PDF reading, which needs the R2 file pipeline.
- Unchanged from Phase 0: the 20-minute relay soak, `docEpoch` bootstrap authority, R-01 and ADR-007.

---

## 2026-08-14 · Per-member queue ordering — the last of the collision problem

### The problem, restated with numbers

The exit trial found four members screening the same papers. The
compare-and-swap and row lock fixed the *correctness* half — no more silent
overwrites — but left the *waste*: every attempt after the first landed on a
paper someone else had already decided. Twenty decisions, five screened
papers, fifteen refusals. Correct, and still most of an afternoon.

### The fix, and what it is not

Each member walks the **same** relevance-ranked pool in a **different**
deterministic order, from a stable hash of `paperId:memberId`.

It is deliberately not a claim table. Claims need expiry, and an expiry is
wrong in both directions — too short and two people collide anyway, too long
and a paper is frozen because somebody shut their laptop. This needs no
schema, no state, and nothing to reconcile.

Two properties, both tested: the order is **stable** for a member across
renders — a list that reshuffles between page loads is unusable for work done
by position — and every member still sees the **same set**, so this
distributes starting points rather than partitioning ownership.

### Measured

| | recorded | distinct papers | overwrites | wasted |
| --- | --- | --- | --- | --- |
| original | 20 | 5 | **15** (silent) | — |
| + compare-and-swap | 6 | 5 | 1 | 14 |
| + `for update` | 5 | 5 | 0 | **15** |
| + per-member order | **20** | **20** | **0** | **0** |

The compare-and-swap stays. It is the backstop for the tail of the queue,
where eight papers and four people collide by arithmetic rather than by
design — a unit test asserts that overlap rises as the pool shrinks, so the
limitation is recorded rather than discovered later.

### Open

- Unpaywall licence verification, for the real redistributable rate.
- PDF reading, which needs the R2 file pipeline.
- Unchanged from Phase 0: the 20-minute relay soak, `docEpoch` bootstrap
  authority, R-01 and ADR-007.
- **Still not proven: whether screening 300 papers in this UI is bearable.**
  Four humans, one afternoon. No test replaces it.

---

## 2026-08-14 · The evidence table — Phase 2 week 4

### What it had to be

Papers as rows, protocol fields as columns, filter and sort and group, cell →
source, CSV and XLSX out. `08-phase-2-build-plan.md` 4.1–4.6.

The obvious build selects `v_evidence_table` for the project and pivots it in
TypeScript. It breaks two requirements at once, and neither failure is loud:

- **4.1**: 6,000 rows over the wire, per keystroke of a filter, before
  anything renders.
- **4.2**: sorting in the client sorts only the page already fetched. The top
  of a "sorted" 300-row table would be the top of whichever 100 rows arrived
  first — which looks exactly like a sorted table.

So `evidence_rows()` pivots, filters, sorts, groups and pages in Postgres, and
the page renders what it is handed.

### Measured — 4.1's budget

300 papers × 20 fields, 5,140 recorded values, on the local stack:

| query | time |
| --- | --- |
| page 1, sorted by title | 55.6 ms |
| sorted by a NUMBER column, descending | 53.1 ms |
| filtered on a text column | 52.4 ms |
| grouped | 51.3 ms |
| the whole 300-row export | 51.2 ms |
| coverage view | 0.6 ms |

Against a 3 s budget. **This measures the database, not the page** — server
render, network and React are not in these numbers. The database was the part
at risk, and it is now using under 2% of the budget; the rest is unmeasured
and should not be assumed.

### The type-aware sort

Sample sizes of 3, 9, 25, 100 sort lexically as 100, 25, 3, 9. The fixture
picks numbers where numeric order and lexical order are **not reverses of each
other**, so a direction bug cannot pass itself off as a type bug.

The regex guard around the cast matters more than the cast. Nothing at the
database level stops prose landing in a NUMBER column — one test paper's
sample size is `'not reported'`, which is what real extractions look like —
and an unguarded `::numeric` aborts the **entire query**. One untidy cell
would blank the whole evidence table. Non-numeric sorts last instead.

### Sabotage verification

| sabotage | result |
| --- | --- |
| `SECURITY DEFINER` on `evidence_rows` | assertion 31 fails; 32 correctly survives (the coverage view carries its own `security_invoker`) |
| numeric branch removed | assertions 1 and 2 fail — lexical order |
| paging tiebreak removed | **nothing fails, across 5 runs** |

The third is recorded rather than papered over. At five rows Postgres returns
a stable order regardless, so assertion 25 proves paging behaves — not that
the tiebreak is load-bearing. It stays because the reasoning is right; it is
simply not a verified guard, and saying so is cheaper than believing it.

### Problems

**The mobile viewport found three real defects, none of them test artefacts.**

1. **A sticky column is opaque and sits on top of what scrolls under it.** At
   412 px the paper column covered most of the table, and cells behind it
   could not be clicked at all. Sticky from `sm` up only; on a phone,
   scrolling the title away beats losing a column.
2. **A wrapped inline link's bounding box spans its line boxes**, so its
   centre point can land in the *gap between two lines* — where the click hits
   the cell, not the link. Visible, enabled, stable, and not clickable. Cells
   are now one line with the full value in `title`, which is also just how a
   20-column table stays readable.
3. **The sticky header swallows anything scrolled to**, including a focused
   link. Fixed globally with `scroll-padding-top`. This was *not* the cause of
   the failure being chased at the time, and the comment in `globals.css` says
   so rather than taking the credit.

**`apps/web` had a `test` script and a vitest config that nothing invoked.** A
unit test written there would have passed locally and never once run in CI.
Found while looking for somewhere to put the export tests. Now in
`pnpm verify`.

**My own week-2 trigger rejected my own test fixture** — a `SYSTEMATIC_REVIEW`
refused an EXCLUDED paper with no exclusion reason. The rule works.

**A literal BOM and literal control bytes in TypeScript source** made
`xlsx.ts` stop being a text file: `file` reported `data` and grep treated it
as binary. Both are now escapes. ESLint caught the BOM; nothing caught the
control bytes, which is worth remembering.

### Decisions worth recording

**XLSX is hand-written**, ~150 lines over `node:zlib`, rather than SheetJS or
ExcelJS. The evidence table needs one sheet, strings and numbers, and no
styling; both libraries are large and bring transitive dependencies. It is
verified with the system `unzip` — reading my own archive with my own reader
would happily agree with itself about a wrong offset or a wrong CRC.

**Numbers are written as numeric cells.** Writing everything as a string
produces a file that opens correctly and cannot be averaged, summed or
charted — quietly undoing ADR-001's typed plaintext.

**CSV and XLSX values are neutralised against formula injection.** A cell
beginning `=` `+` `-` `@` is executed on open by Excel, LibreOffice and
Sheets. That is a live risk here, not a theoretical one: extracted values are
typed by people, and a systematic review is a document that gets emailed
around, so whoever opens the file is usually not whoever wrote the cell.

**Column headers are the field keys.** This is what week 2's immutability rule
was *for*. A label is prose and people improve it; two exports of the same
review would otherwise disagree about what a column is called, and any script
joining on it would break silently.

### Open

- **The page-level render time for 300 × 20 is unmeasured.** The database half
  is 51 ms; the rest is an assumption.
- Coverage counts a question as answered when *any* included paper answers
  *any* field tied to it. "Half the papers answer it" is not yet visible.
- Unpaywall licence verification, for the real redistributable rate.
- PDF reading, which needs the R2 file pipeline.
- Unchanged from Phase 0: the 20-minute relay soak, `docEpoch` bootstrap
  authority, R-01 and ADR-007.
- **Still not proven: whether screening 300 papers in this UI is bearable.**
  Four humans, one afternoon. No test replaces it.

---

## 2026-08-14 · Dual extraction and reconciliation — Phase 2b

### Sequencing, stated plainly

`08-phase-2-build-plan.md` deferred this until after real usage, per R-06: the
loose path first, because the rigorous path is a strict superset and building
reconciliation for a workflow nobody has exercised is the risk. It was built
now on request. The argument for waiting has not been answered — it has been
overridden, which is a decision and not an oversight, and is recorded here so
nobody later reads the sequence as evidence that the original reasoning was
wrong.

### Cohen's κ, and the number that must not be printed

    κ = (po − pe) / (1 − pe)

When both extractors used exactly one category — every paper marked "RCT" —
pe is 1, the denominator is 0, and **κ is undefined**. The tempting
implementation returns 1.0, "they agreed on everything", and that is precisely
backwards: a field with no variance says nothing about the raters, because
chance alone would have produced the same result. Reporting a confident 1.00
there puts a number in a published methods section that the data does not
support.

`cohensKappa` returns `number | null` and says why. The UI renders the reason.
The floating-point form is its own test: pe computes to 0.9999999999999998,
not 1, so an `=== 0` guard sails past and returns a κ of roughly **-4000**.

κ is reported for **ENUM and BOOLEAN only**. Over free text it measures the
text rather than the raters — two people writing "randomised controlled trial"
and "RCT" have agreed completely and would score zero. MULTI_ENUM is excluded
too: categorical but set-valued, and Cohen's κ is not defined for multi-label
data. Treating each distinct set as a category is a real technique and a
*different* statistic, so substituting it quietly would be worse than
declining.

Raw agreement is shown alongside κ, always, because the two answer different
questions. 90% agreement with a poor κ is a field where one answer dominates —
and where saying the same thing every time without reading would score about
as well.

### Sabotage verification

| sabotage | result |
| --- | --- |
| `SECURITY DEFINER` on `evidence_rows` (week 4) | 31 fails; 32 survives correctly |
| independence rule removed | 11 and 17 fail |
| capability gate removed | 16 fails — a THESIS could record a reconciliation |
| type-aware comparison removed | 1, 2, 3, 6 fail |
| shared's vitest include narrowed | `check-tests.sh` reports the orphan, exits 1 |
| control byte planted in a source file | guard names the file, exits 1 |

Recorded because the labels do not line up with the rules the way you would
assume: with the independence rule disabled, assertion 10 **still passes** —
Alice is caught first by the "your own extraction" rule. Assertion 11 is the
one that isolates independence.

### Problems

**Three tests that never ran.** The κ tests reported green *without running*:
`packages/shared` collected only `test/**/*.spec.ts`, so `agreement.test.ts`
sat in that directory being ignored. That is the third instance — `apps/web`
had a test script nothing invoked, and `packages/discovery` had the same
include waiting to do the same. A test that does not run is worse than no
test: it reports the reassurance of coverage while providing none, and it
fails in the one direction nobody checks. `scripts/check-tests.sh` now asks
vitest what it would collect and diffs that against the filesystem.

**A guard that lied.** The first version of the control-byte guard used
`grep -P`; BSD grep on macOS has no PCRE, so the command failed, printed
nothing, and the check *passed* with a control byte planted in the tree. Found
only because every guard in this repo gets sabotage-tested before it is
believed. A guard that cannot fail is worse than no guard, because it is
trusted.

**A keyboard trap in reverse, in five tables at once.** axe on the mobile
viewport: `scrollable-region-focusable`, serious. Every wide table was a
hand-rolled `overflow-x-auto` div, which scrolls with a mouse or a finger and
cannot be reached with a keyboard — so a keyboard user never sees the columns
past the fold, and nothing on screen suggests there are any. WCAG 2.1.1. True
of the library table since Phase 1; caught only when the reconcile page put a
narrow enough table in front of axe. Now a `TableScroll` primitive, because
five hand-rolled copies of one thing is how one of them stays broken.

**A real constraint interaction.** `extractions` is unique on (paper,
protocol, extractor), and a reconciliation is a row authored by the verifier —
so a verifier with their own extraction of that paper, even an abandoned
draft, collides with themselves. The constraint is right: someone who has
extracted the paper is a third *reader*, not a neutral adjudicator. What was
wrong was being told so by a raw 23505 naming a unique index.

**Raw control bytes in TypeScript source, three times in one day.** Each from
pasting a literal control character into a string or regex. `file` reports the
source as `data`, grep treats it as binary and silently stops matching.
Nothing in the toolchain said so; ESLint catches a BOM and not these.

**Two fixtures rejected by my own week-1 triggers** — values written after
submission, and a second reading of one work in one project.

### Open

- **κ is per field and unweighted.** No weighted κ for ordered categories, and
  no confidence intervals. Both are standard in published reviews and neither
  is here.
- Reconciliation resolves to one row; there is no record of *why* a verifier
  chose one reading over the other. A rationale field is an obvious next step.
- Nothing detects that two people were assigned the same paper — dual
  extraction currently happens because two people both chose it.
- The page-level render time for 300 × 20 is still unmeasured.
- Unpaywall licence verification; PDF reading, which needs the R2 pipeline.
- Unchanged from Phase 0: the 20-minute relay soak, `docEpoch` bootstrap
  authority, R-01 and ADR-007.
- **Still not proven: whether any of this is bearable for a real review team.**
  Four humans, one afternoon. No test replaces it.

---

## 2026-08-15 · Every provider "down", and none of them were

### The symptom

Federated search reported all five providers as failed. Not one — all five,
every time. Five independent external APIs do not fail together, so the
failure was ours.

### What it was

`safeFetch` validates every address a hostname resolves to, then pins the
socket to a validated one so DNS cannot be consulted a second time. It pinned
`addresses[0]`. When that first address was an AAAA record and the machine's
IPv6 route was a blackhole, the socket did not refuse — it *hung*, for the
full 10 s, until `safeFetch`'s abort and undici's connect timeout (both 10 s;
nothing in the search path shortens either) raced to end it. What surfaced was
"provider unavailable", five times over, rather than "one address was
unreachable", once.

The A record was sitting right there in the validated list, unused.

`pinnedAgent` now hands the socket **every** validated address, IPv4 first.
Node's own connection failover (Happy Eyeballs) takes it from there.

### Why this costs nothing in safety

The array passed to `pinnedAgent` is exactly the array `resolveAndValidate`
already classified, address by address — an address absent from it still can
never be connected to, and no new DNS lookup happens. The pin is unchanged in
what it forbids; it is only less arbitrary about what it permits.

Two details that are easy to get wrong and are therefore tested directly:

- **IPv4 first, but DNS order preserved within a family.** Resolvers rotate
  records to spread load; re-sorting inside a family would quietly undo that
  and pile every request onto one host.
- **A non-IP string is dropped, not sorted.** `isIP` returns 0 for one, which
  would sort it to the *front* — ahead of every real address. The failure mode
  of keeping it is the worst one available, so it is filtered out.

### Proven by sabotage

Restoring the one-address behaviour (`.slice(0, 1)`) makes the new test fail
with `UND_ERR_CONNECT_TIMEOUT` after 10 s against a host that is up — the
production symptom exactly, reproduced on demand. End to end, search now
returns four providers in 2.6 s; the fifth is a Semantic Scholar 429, which is
a rate limit and is reported as one.

`SSRF_KNOWN_GAPS` is now empty, and the test asserts that rather than trusting
it.

---

## 2026-08-15 · Closing Phase 2's last open number, and the UI audit it enabled

### Shipped

`pnpm db:seed` — a demo project you can sign into. Two projects: a
300-paper SYSTEMATIC_REVIEW with a 20-field protocol, a partly-screened
library, a reconciliation backlog and 5,553 answers; and a small THESIS
where none of that machinery appears. Deterministic RNG, so two runs give
the same corpus. Idempotent, so re-running replaces exactly those two
projects.

`pnpm --filter @porcupine/web measure` — the page-level timing that Phase 2
signed off without.

### The measurement, finally

Phase 2's exit criteria carried one unchecked box: the 3 s evidence-table
budget had been proved against the **database** (51–56 ms per query shape)
and nothing else. That number was real and it was the easy half. It says
nothing about the server component awaiting the RPC, the React tree built
from 5,000-odd cells, the payload on the wire, or the browser laying out 23
columns — all of which sit between the query and the person waiting.

300 papers × 20 fields, production build, local Supabase, median of 7 runs:

| Shape | TTFB | LCP | HTML |
|---|---|---|---|
| page 1, default sort | 240 ms (worst 314) | 276 ms (worst 352) | 510 KB |
| sorted by a number | 248 ms (worst 256) | 284 ms (worst 292) | 510 KB |
| filtered | 245 ms (worst 290) | 284 ms (worst 328) | 510 KB |
| grouped | 245 ms (worst 271) | 284 ms (worst 312) | 526 KB |
| last page | 243 ms (worst 273) | 280 ms (worst 308) | 506 KB |

**280 ms against a 3 s budget**, with about 190 ms of that being server
render and framework rather than the query. The budget is not close to
binding, which is a conclusion with a consequence: *performance is not what
is wrong with this interface*, and the UI plan can afford to be ambitious
without arguing about it first.

Two caveats stated rather than buried. This is a developer laptop against a
local database — not Vercel, not a pooler, not a phone on a train. And
**510 KB of HTML for fifty rows** is the number to watch: it is fine over
loopback and it is not fine over mobile data.

It is deliberately not a merge gate. A timing assertion on a developer
laptop is a flaky test, and a flaky test teaches people to ignore the suite.
It prints numbers.

### Problems

**The seed script could not run twice.** Re-seeding deletes the previous
demo project, and that failed with

    ERROR: The field "Primary outcome" requires a quoted passage from the source.

Two guards written for interactive editing were firing inside cascades,
where the thing they protect is being deleted anyway.

1. `extraction_values.anchor_id` was `on delete set null` — Prisma's default
   for an optional relation, which means nobody chose it — while
   `enforce_value_anchor` is a BEFORE UPDATE trigger refusing exactly that
   null. The cascade's own UPDATE was vetoed by the trigger it triggered.
2. `protect_answered_field` made any project containing one extracted answer
   undeletable, and explained itself by naming a protocol field the user had
   not touched.

The trigger is right in both cases and the cascade was wrong. A QUOTE field
exists so an answer is traceable to its passage; `set null` silently converts
a traceable answer into an untraceable one, which is the outcome the field
type was invented to prevent.

**And the fix's first draft was wrong in an instructive way.** `no action`
looks like the answer and is not: it differs from `restrict` only in whether
other triggers run first, and both are checked immediately. The invariant is
not "an anchor may never be deleted" but *"at the end of the transaction no
answer cites a passage that is gone"* — and those differ by a whole project,
because a project delete cascades to anchors and to extraction_values in an
order Postgres does not promise. `deferrable initially deferred` is what
actually states the invariant. The pgTAP suite caught the first draft.

**A vacuous assertion, nearly shipped.** With a deferred constraint, a suite
that ends in `rollback` never reaches a commit — so "the project deleted
fine" would have passed no matter what the constraint did. Assertion 10
forces the deferred check to run inside the transaction. Worth remembering
next time a deferred constraint gets tested.

### Open

- The measurement is a laptop against loopback. Vercel + Supavisor + a real
  network is a different number and is not yet known.
- 510 KB of HTML per evidence page is untested on mobile data.
- Everything under "Open" in the previous entry is unchanged.

---

## 2026-08-15 · Phase 2c week 1 — the shell

### Shipped

A project layout with its own navigation; the hub rebuilt as an overview that
reflects state; capability gating moved to the door; `loading.tsx` and
`error.tsx` where there were none.

`lib/project-sections.ts` is the single source of truth for which screens a
project kind has. The hub and the nav both read it, so a section that is not
in that list for a kind cannot be linked from anywhere — a stronger guarantee
than remembering to check in two places.

### What the hub was

Nine identical outline buttons in one flat wrapping row, in an order that was
neither the workflow's nor alphabetical, carrying no state whatsoever. Not the
paper count, not whether a protocol existed, not what was left to screen.
Every number the app had already computed was one click away and none of it was
there. It was also the only page that hand-rolled its header instead of using
`PageHeader`, and its copy still said "Email invitations arrive in Phase 1".

It now opens with four counts — papers, unscreened, included, excluded — each
a link to the filtered library view it counts, and one named next action
derived from the project's actual state ("24 papers are still unscreened →
Continue screening"). Sections follow, grouped Collect · Screen · Extract ·
Synthesise.

### The measurement moved, and not all in one direction

Same fixture, same machine, before and after:

| | TTFB | LCP | HTML |
|---|---|---|---|
| before | 240 ms | 276 ms | 510 KB |
| after | 64 ms | 416 ms | 562 KB |

**First byte is roughly four times faster and largest contentful paint is
about 120 ms slower.** Both are real and the trade was the point: the page now
streams, so a skeleton is on screen in 64 ms where there used to be 240 ms of
nothing at all. The table itself arrives later — partly the extra 52 KB the
navigation adds to every page, partly a client component to hydrate.

Worth being plain about, because "we added skeletons and everything got
faster" would be the comfortable version and is not what happened. Against a
3 s budget, 416 ms leaves the same order of magnitude of headroom. The 562 KB
is the number that is now growing rather than shrinking, and week 3.5 owns it.

### Problems

**I hid a working feature.** `projectSections` gated PRISMA behind
`capabilities().prismaDiagram`, which is false for a thesis — so three of the
four project kinds silently lost a screen they had. The flag does not gate the
diagram at all: the page renders it for every kind and uses the flag only to
add a note saying exclusion reasons were optional here, so the boxes may be
sparse. I read the capability's NAME instead of what the destination does.

Caught by an existing e2e test that clicks through to PRISMA in a THESIS, and
by nothing else — my own "no link leads to a refusal" test passed happily,
because it looks for refusal *wording* and the PRISMA page never had any. A
test that checks the symptom does not check the judgement. `USING-PORCUPINE.md`
had the same error in its capability table and is corrected.

**Two pre-existing tests broke on `getByRole("list").first()`.** The project
nav is a list, and it now precedes everything. The selectors were fragile and
the fix is not a more specific index: the import preview and the protocol field
list have accessible names now, which is what they should have had anyway.

**A serious axe violation, self-inflicted.** The four counts started as a `dl`
with an anchor wrapping each `dt`/`dd` pair. A `dl` may contain only `dt`, `dd`
or a `div` grouping them, so the anchor broke the association — WCAG 1.3.1,
serious. They are four navigation targets that happen to carry numbers, so
they are a list of links now.

**The first e2e run found zero sections on the hub** and blamed the hub. It was
the skeleton: `waitForURL` returns while the RSC payload is still streaming, so
the page at that instant is a `main` with no links in it. The new loading state
working exactly as intended, mistaken for the thing it was hiding.

### Open

- 562 KB per evidence page, up from 510 KB. Week 3.5.
- The nav is horizontally scrollable on a phone rather than collapsing into a
  menu. It is reachable and labelled, and it is not what a menu would be.
- Weeks 2–5 of `09-phase-2c-usability-build-plan.md` are untouched.

---

## 2026-08-15 · Phase 2c week 2 — screening at speed, and a plan that was mostly wrong

### Most of this week was already built

Week 2 was written from audit finding 1.5: "there is no overlay layer, so there
is no feedback layer." The first half is true. The second does not follow from
it, and I did not check before planning four tasks on top of it.

What the code actually had:

- **Pending state on every mutation.** Every form and action disables its
  control and names what it is doing — "Sending…", "Creating…", "Adding…",
  "Recording…". Hand-rolled with `useState` rather than `useFormStatus`, which
  is exactly why the audit's grep for `useTransition|useActionState|
  useFormStatus` reported zero and I believed it.
- **A shared announcement path.** `Banner` carries `role="alert"`; the pages
  that report progress wrap it in `aria-live="polite"`. Consistent, through a
  primitive, not improvised six times.
- **Confirmation on the destructive action that warrants it.** Deleting a
  protocol field is a two-step inline confirm, with a comment arguing that a
  modal needs a focus trap and escape handling to be correct and that inline is
  *harder to trigger by accident than a dialog whose default button is OK*.

So Radix is deferred. Nothing needs a dialog yet, and adding a dependency
because a plan written the day before said so would contradict this plan's own
decisions section. It arrives with the first screen that genuinely needs an
overlay — the evidence table's column manager is the likely candidate.

A grep for three API names is not an audit of whether feedback exists. Noted
for the remaining weeks: check the behaviour, not the imports.

### What was real

**Optimistic screening.** A decision now applies immediately instead of waiting
for the round trip. That trip is 100–250 ms — imperceptible once, and a minute
of thumb-twiddling across 300 papers, distributed into 300 separate pauses each
landing exactly where the person had built up rhythm.

Optimism is safe here for a specific reason: the failure case was already
solved. `recordDecision` is a compare-and-swap against the status the screen
was showing, so a colleague deciding the same paper first is refused rather
than overwritten — the lost-update guard proved in `pgtap.mjs`. That gives a
real answer to roll back to, which is the thing most optimistic UIs do not
have.

Plain state, not `useOptimistic`: `done` is client-only and never comes back
from the server, so there is nothing to reconcile against and `useOptimistic`
would add a rollback we would then have to suppress.

**Keyboard-first screening**, pulled forward from week 4 because it targets the
same surface and shares the same end-to-end setup. `i` include, `e` exclude,
`s` skip, `1`–`9` exclusion reason, `?` for the list — with a visible hint,
because a shortcut nobody is told about is a feature for whoever wrote it.

### Problems

**The optimistic path could not handle a dropped connection.** A server action
that cannot REACH the server throws; it does not return `{ ok: false }`. The
first draft only handled the returned-failure case, so the rejection escaped
the transition, the paper stayed optimistically decided, and the person was
told nothing — the exact failure optimism is accused of and usually guilty of.
A dropped connection is the *likeliest* way to lose a decision, not a refusal.

Found because the rollback test aborts the request rather than mocking a failed
response. Mocking the response would have passed against the broken code.

**A test that would have passed either way.** The first version of "advances
without waiting for the server" simply clicked and asserted the queue moved —
which is also true of a blocking implementation against a fast local server. It
now holds the action open for three seconds and asserts the queue moved within
250 ms, so it can only pass if the advance really is optimistic.

**`getByRole("alert")` resolves to Next's route announcer**, an empty
`role="alert"` div the framework renders on every page. An unscoped query finds
it first and waits out the timeout against an empty string.

### Open

- Radix, and the overlay layer, when something needs it.
- Weeks 3 and 5 untouched; week 4 is down to the extraction form, the split
  reader, and the queue.
- The 562 KB evidence page is still growing rather than shrinking.

---

## 2026-08-15 · Phase 2c week 3 — the evidence table, and a bug I could not explain

### Shipped

Column selection. `?cols=a,b,c` on the evidence URL picks which protocol fields
are columns, and a chooser writes it. In the URL rather than per-person storage
for the same reason sort and filter are: a table narrowed to the five fields
that matter today is exactly the thing someone sends to a supervisor, and
per-browser state would make that link mean something different at each end.

`visibleFields()` is shared by the page and the export route, so "export what I
am looking at" now includes the columns. It did not: the Export CSV link
carried the filter and the sort and not `cols`, so narrowing to two fields and
clicking Export handed back twenty. My own test missed it because it built the
export URL by hand instead of reading the button's href — it asserted the
route's behaviour and called it the feature's. It now clicks the real link.

The `title` attribute is gone from every cell. It duplicated the full text of
all 1,150 cells in the HTML, and a tooltip is not reachable by keyboard or
announced, so it was never an answer for everyone.

### The bug

An existing mobile test — a quoted evidence cell opening the reader at its
passage — started failing. The link was reported by Playwright as visible,
enabled, stable, and not clickable, with the filter form named as intercepting
the pointer.

Five hypotheses, each tested and each wrong:

1. **The extra trailing detail column** made rows wider. Removed it; still red.
2. **The first column's width**, once a button sat beside the title. Moved the
   control into the existing "12/20" cell, which adds no width. Still red.
3. **Radix.** Replaced the dialog with a bare `<button>` of identical
   geometry. Still red.
4. **`useSearchParams()` in a client component with no `<Suspense>` above it**,
   which widens the page's client boundary. Passed the query down from the
   server instead. Still red.
5. **Position** — the chooser folded into the controls row. Moved it to its own
   row. Still red.

What did work: not rendering the chooser below the `sm` breakpoint. The mobile
suite went green immediately and stayed green.

So the established fact is narrow and real — *the interaction only happens on
the narrow layout* — and the mechanism is still unknown. The column chooser is
desktop-only and the row-detail panel is reverted, both with that written where
the next person will find it. Choosing among twenty columns is a
desktop-shaped problem anyway, which makes this a tolerable place to stop; the
detail panel is not, and it is owed.

**A methodological note worth more than the fix.** Three of those five runs
were wasted because I bisected with `--project=mobile` alone while the failure
needed the full suite. A green single-project run told me "removing X fixes
it", and it was not true. When a failure appears under one command, reproduce
it under that command.

### Problems

**A sticky header that could not work.** `TableScroll` sets `overflow-x: auto`,
which makes the div a scroll container on both axes — so `position: sticky;
top: 4.5rem` pins the header 4.5 rem below the *container's* top, permanently
over the first two rows. Reverted. Doing it properly means giving the table its
own vertical scroll, which changes how the whole page scrolls.

**Four stray debug files in the working tree**, not mine — `test-pg.ts`,
`auth/debug-search/route.ts`, `auth/debug-ip/route.ts`, and an incomplete
`Promise.all` → `Promise.allSettled` edit in `packages/discovery/src/search.ts`
whose consumer was never updated. Two of them broke `next build` outright and
the rest fail `pnpm verify`. They have been moved to the session scratchpad
rather than deleted; the `search.ts` edit is left exactly as found.

A `/auth/debug-search` route that calls five external APIs with no auth check
is worth removing rather than formatting.

### Open

- The narrow-layout interaction, unexplained. It blocks the row-detail panel
  and keeps the chooser desktop-only.
- Sticky headers, which need the table to own its vertical scroll.
- Saved views and column reordering: both need somewhere per-person to live,
  and this phase does not touch the database.
- The payload was not re-measured, because the measurement needs a clean tree.

---

## 2026-08-15 · Phase 2c week 4 — orientation on the two long screens

### Shipped

**The extraction form now says where you are.** "12 of 20 answered", live, in a
sticky header beside the questions — on a form long enough that "am I nearly
done" was only answerable by scrolling and counting. Beside it, an unsaved-
changes marker and a `beforeunload` guard.

**Every empty required field, named at once, each a link to itself.** Twenty
fields against a paper is twenty minutes of reading, and finding out about the
holes one at a time costs one failed submission per hole.

**The queue can be acted on.** Every row is now a link to the thing it is
asking for — the screening surface for unscreened work, the reader for
everything else — and an empty queue says what would put something in it. It
used to name a paper and link only to its PROJECT, which made it a list of
instructions with no way to follow any of them: you read "screen this paper",
clicked, and arrived at an overview to start navigating from scratch.

### Two more plan items that were already done

**4.3, "reader and extraction side by side", was built in Phase 2.** The form
has shown the paper and the questions in two columns from the start, with the
source sticky while the questions scroll, and its header says why. I wrote the
task without opening the file.

**4.4's stated reason was wrong too.** The queue already showed the project,
the status and the due date, sorted soonest-first with overdue in red. The
audit claimed it had "no sense of priority, age, or which project each belongs
to"; it had all but age. The real defect was that none of it was actionable.

That is three weeks running where the plan described work that existed. The
pattern is consistent: the audit measured the code with greps and inferred
behaviour from what they did not find. Week 5 gets read first.

### Problems

**My first version of the required-field check made a server rule untestable.**
It computed the missing fields and returned early, refusing to submit. That
felt obviously right and quietly broke something: `submitExtraction` is where
that rule actually lives — in the server action, not a trigger — and the only
thing proving it was an e2e assertion that a submission with a hole comes back
refused. A client check that short-circuits the request makes the server rule
untested and, in time, untrue. The existing test failed on the changed message,
which is exactly what it was there for.

So the server stays the gate and stays the headline message; the client adds
the part the server cannot give, which is every missing field at once with a
link to each.

**`isVisible()` again, for the third time in this phase.** It answers
immediately and every route streams, so it kept answering "no" about a button
that was on its way. `waitFor({ state: "visible" })` is the answer and now
carries a comment saying so.

**Two ordinary selector traps**, both from names that overlap: an unanchored
`/extract/i` matched the back-link to a project called "Extraction spine", and
`/add field/i` did not match the button that opens the form, which is called
"Add a field" — one word apart from the "Add field" that submits it.

**A stale build cost a debugging cycle**: the test ran against the previous
`next build` and reported the old message, so the fix looked like it had not
applied.

### Open

- Week 5 (arrival: the project-kind choice, empty states, a first-run path, a
  root README) is untouched.
- The narrow-layout interaction from week 3 is still unexplained, and still
  blocks the row-detail panel.
- Four stray debug files remain in the working tree and are not mine; they
  break `next build` and `pnpm verify` until finished or removed.
