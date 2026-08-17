# Phase 0 — Foundations · Build Plan

**2 weeks.** Exit criterion: _create a project, invite a member, and nothing else — but every table has a tested RLS policy and the `05-resolution-plan.md` §5 pre-flight is green._

No feature code until the pgTAP suite is a merge gate. That ordering is the whole point of Phase 0.

---

## Repository shape

```
Porcupine/
├── apps/
│   ├── web/               Next.js 16 App Router → Vercel
│   └── relay/             CF Worker + Durable Object (week-1 spike, ADR-020)
├── packages/
│   ├── db/                Prisma schema, generated client, RLS SQL, pgTAP
│   └── shared/            Zod schemas + types shared across app and relay
├── supabase/              local stack config + migrations (source of truth for applied SQL)
├── docs/
└── .github/workflows/
```

**Why a workspace on day one.** The relay is a separate deploy target with its own `wrangler.toml`, and `packages/db` is consumed by both the app and CI. This is not speculative structure — it maps 1:1 to the three deploy targets in ADR-019/020.

### Migration workflow — resolving the Prisma/Supabase overlap

Two tools want to own migrations. The split:

- **Prisma owns the schema.** `packages/db/prisma/schema.prisma` is the source of truth for tables, columns, and indexes.
- **Supabase owns what actually ran.** SQL files in `supabase/migrations/` are applied by `supabase db reset` locally and by CI.
- The bridge is `prisma migrate diff --from-migrations --to-schema --script`, which emits SQL we write into a timestamped Supabase migration.
- **RLS policies are hand-written SQL** appended to that same migration. Prisma cannot express them, and they are the actual security boundary.

`prisma migrate dev` is never run against a Supabase database — it does not know about policies, roles, or extensions and will happily drop them.

---

## Week 1 — the security boundary

| #   | Task                                                   | Done when                                                                                                                                                                  |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | pnpm workspace, TS strict, ESLint, Prettier            | `pnpm typecheck` and `pnpm lint` pass on an empty repo                                                                                                                     |
| 1.2 | `apps/web` — Next.js 16, React 19, Tailwind, shadcn/ui | `pnpm build` clean; one page renders                                                                                                                                       |
| 1.3 | Local Supabase on Docker                               | `supabase start` healthy; Studio reachable                                                                                                                                 |
| 1.4 | Prisma schema — Phase 0 slice only                     | `User`, `Device`, `Organization`, `OrgMember`, `Project`, `ProjectMember`, `ProjectKey`. Includes the v6 deltas from `01-data-model.md` Appendix A that touch these tables |
| 1.5 | **Restricted role + RLS baseline**                     | `Porcupine_app` has no `BYPASSRLS`; every `public` table has `FORCE ROW LEVEL SECURITY`; `SECURITY DEFINER` helpers `is_project_member()` / `has_project_role()` exist     |
| 1.6 | **pgTAP harness + the three R-02 tests**               | `rls_denies_without_claim`, `rls_no_cross_tenant` (32-way concurrent), `rls_claim_does_not_survive_txn` — all green, suite under 90 s                                      |
| 1.7 | CI runs 1.1 + 1.6 as a **merge gate**                  | A PR that adds a table without RLS fails                                                                                                                                   |

**Gate: nothing in week 2 starts until 1.6 and 1.7 are green.**

## Week 2 — the app skeleton and the pre-flight

| #   | Task                                                                   | Done when                                                                                                                                                    |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 | `withUserContext(jwt, fn)` — the _only_ place `set_config` appears     | ESLint bans `prisma.` outside `src/server/db/**`; CI greps for `set_config` outside the helper                                                               |
| 2.2 | Supabase Auth — email OTP + Google                                     | Sign in, sign out, session in RSC and route handlers                                                                                                         |
| 2.3 | **Identity keypairs generated at signup** (R-pre-flight 7)             | X25519 + Ed25519 public halves stored; private bundle wrapped under an Argon2id KEK. _Nothing uses them yet_ — this exists so Phase 3 needs no re-enrollment |
| 2.4 | Create project · invite member · accept invite                         | Three screens, RLS-enforced, no admin bypass anywhere                                                                                                        |
| 2.5 | Design tokens + component scaffold                                     | Theme tokens, dark mode, focus-visible rings, one form pattern                                                                                               |
| 2.6 | **`axe-core` in Playwright** (G-07)                                    | CI fails on any WCAG 2.2 AA violation                                                                                                                        |
| 2.7 | `Work.language` + `simple` FTS config in the baseline migration (R-14) | Column exists before `Work` has rows — retrofitting later is an outage                                                                                       |
| 2.8 | Docs named-range marker format written down (R-08)                     | **Done** — `00-product-plan.md` §5.2 (landed there, not `02`: it is a data-format decision, not a security one)                                              |
| 2.9 | Provisional pricing numbers (R-20, forced by C-22)                     | **Done** — `00-product-plan.md` §8.1                                                                                                                         |

## Week-1 spikes — run in parallel, each can invalidate an assumption

| Spike                                                                                                   | Kills what if it fails                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **DO relay** (R-21) — 4 browsers, 20 min, p95 < 150 ms, survives forced restart, rejects forged tickets | ADR-020. Fallback: self-hosted `y-websocket` on Fly.io |
| **`docEpoch` protocol** (R-01) — the offline-Alice/PR-Bob script, before any LaTeX UI exists            | ADR-021. No fallback; this one must work               |
| **WASM TeX** — a real 80-page thesis, from R2, `CORP: cross-origin`, under COOP/COEP                    | ADR-007. Fallback: server-side compile                 |

---

## Definition of done for Phase 0

- [x] `pnpm typecheck && pnpm lint && pnpm test` green
- [x] pgTAP suite green in CI, under 90 s, blocking merges — *0.4 s*
- [x] No `public` table with `relrowsecurity = false` — asserted in CI, not by review
- [x] `axe-core` blocking merges — desktop + mobile viewports
- [x] Sign up → create project → invite member, all RLS-enforced — 20 e2e checks
- [x] Identity keypairs stored for every signup
- [x] DO relay spike (R-21) — **GO**, 13 tests green. R-01 and ADR-007 spikes still outstanding

**Not in Phase 0:** any encryption in use, any bibliographic API, any PDF, any LaTeX, any Google integration. The temptation to start Phase 1 early is the single most likely way this plan fails.

---

**Every phase ends with an entry in `BUILD-LOG.md`** — what shipped, measured verification numbers, decisions made at the keyboard, deviations from this plan, and problems hit. A phase is not done until its entry exists. Week 1 of this phase is already logged there, including the seven things that went wrong.
