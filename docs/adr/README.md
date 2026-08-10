# Architecture Decision Records

Decisions that are expensive to reverse. Each gets: context, options considered, decision, consequences accepted.

| ID | Decision | Status | Detail |
|---|---|---|---|
| ADR-001 | Tiered encryption — E2EE covers **messages, documents, LaTeX sources** only; library, annotations, and extractions are server-confidential | **Accepted** | `../02-security-and-e2ee.md` §2 |
| ADR-002 | Prisma for migrations + trusted writes; `supabase-js` + RLS for client reads; restricted DB role with `FORCE ROW LEVEL SECURITY` | **Accepted** | `../02-security-and-e2ee.md` §6 |
| ADR-003 | ~~AI-assisted extraction~~ — **no AI in v1**; deterministic substitutes for each dropped capability; inert schema hooks retained | **Closed (rejected)** | `../00-product-plan.md` §9 |
| ADR-004 | Yjs CRDT with client-side encryption and client-elected compaction | **Accepted** | `../02-security-and-e2ee.md` §5 |
| ADR-005 | Per-user PDF copies in Supabase Storage; never redistribute publisher files between users; file bytes never in Postgres | **Accepted** | `../00-product-plan.md` §5, `../01-data-model.md` §1 |
| ADR-006 | Supervisor `historyAccess` prompted at add time; default `ALL_HISTORY` | **Accepted** | `../00-product-plan.md` §4 |
| ADR-007 | LaTeX compiles **client-side in WASM**; server-side compile deferred | **Accepted** | `../03-latex-studio.md` §4 |
| ADR-008 | Discovery via free public APIs (OpenAlex, Crossref, arXiv, S2, Europe PMC, Unpaywall) with aggressive caching; saved-search alerts via `pg_cron` | **Accepted** | `../00-product-plan.md` §5 |
| ADR-009 | Recovery codes mandatory; org escrow off by default, opt-in, disclosed at signup | **Accepted** | `../02-security-and-e2ee.md` §4 |
| ADR-010 | Self-hosting not committed for v1; no provider-proprietary APIs, so it stays a 2-week project later | **Accepted** | `../00-product-plan.md` §11 |

Promote any ADR to its own file when it needs fuller argument. ADR-007 is the one most likely to be revisited — it is conditional on the week-1 WASM spike in Phase 5.
