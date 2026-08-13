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
