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
