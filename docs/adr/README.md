# Architecture Decision Records

Decisions that are expensive to reverse. Each gets: context, options considered, decision, consequences accepted.

| ID | Decision | Status | Detail |
|---|---|---|---|
| ADR-001 | Tiered encryption — E2EE covers **messages and LaTeX sources**; library, annotations, and extractions are server-confidential; prose lives at Google (amended by ADR-014) | **Accepted** | `../02-security-and-e2ee.md` §2 |
| ADR-002 | Prisma for migrations + trusted writes; `supabase-js` + RLS for client reads; restricted DB role with `FORCE ROW LEVEL SECURITY` | **Accepted** | `../02-security-and-e2ee.md` §6 |
| ADR-003 | ~~AI-assisted extraction~~ — **no AI in v1**; deterministic substitutes for each dropped capability; inert schema hooks retained | **Closed (rejected)** | `../00-product-plan.md` §9 |
| ADR-004 | Yjs CRDT with client-side encryption and client-elected compaction | **Accepted** | `../02-security-and-e2ee.md` §5 |
| ADR-005 | Per-user PDF copies in object storage; never redistribute publisher files between users; file bytes never in Postgres | **Accepted** | `../00-product-plan.md` §5, `../01-data-model.md` §1 |
| ADR-006 | Supervisor `historyAccess` prompted at add time; default `ALL_HISTORY` | **Accepted** | `../00-product-plan.md` §4 |
| ADR-007 | LaTeX compiles **client-side in WASM**; server-side compile deferred | **Accepted** | `../03-latex-studio.md` §4 |
| ADR-008 | Discovery via free public APIs (OpenAlex, Crossref, arXiv, S2, Europe PMC, Unpaywall) with aggressive caching; saved-search alerts via `pg_cron` | **Accepted** | `../00-product-plan.md` §5 |
| ADR-009 | Recovery codes mandatory; org escrow off by default, opt-in, disclosed at signup | **Accepted** | `../02-security-and-e2ee.md` §4 |
| ADR-010 | Self-hosting not committed for v1; provider bindings confined to thin adapters, so it stays a 2-week project later | **Accepted** | `../00-product-plan.md` §11 |
| ADR-011 | **Host on Cloudflare Workers (Next.js via OpenNext) + R2**; Postgres/Auth/Realtime stay on Supabase, reached via Hyperdrive | **Accepted** | `../00-product-plan.md` §5.1 |
| ADR-012 | Storage behind a `StorageAdapter` interface; no R2 binding or `@aws-sdk` calls outside it | **Accepted** | `../01-data-model.md` §1 |
| ADR-013 | ~~Supabase Realtime for CRDT transport~~ | **Superseded by ADR-017** | — |
| ADR-014 | **Google Docs is the default prose surface; Google Sheets a first-class export.** Documents leave the E2EE tier; provenance moves to a native Claims panel; native encrypted docs deferred to Phase 4b confidential mode | **Accepted** | `../00-product-plan.md` §5.2 |
| ADR-015 | Google OAuth uses `drive.file` scope + Picker API exclusively — never broad Drive scopes | **Accepted** | `../02-security-and-e2ee.md` §7 |
| ADR-016 | **Yjs is the source of truth; Git is a materialized projection.** Line attribution comes from Yjs client IDs, not `git blame`. Git runs client-side via `isomorphic-git` with encrypted objects in R2; no server-side repo and no push *to* Porcupine | **Accepted** | `../03-latex-studio.md` §8 |
| ADR-017 | **Cloudflare Durable Object per file as the CRDT transport** (supersedes ADR-013). Supabase Realtime retained for Postgres change subscriptions | **Accepted** | `../03-latex-studio.md` §7.1 |
| ADR-018 | **Full source control panel**: local Git via `isomorphic-git`, remote operations and PRs via the GitHub API. Auth is a **GitHub App**, never an OAuth App. A LaTeX project is either Private (E2EE) or GitHub-linked (plaintext) — one-way, explicit, badge suppressed | **Accepted** | `../03-latex-studio.md` §8.4–8.8 |

Promote any ADR to its own file when it needs fuller argument.

**Most likely to be revisited:**
- **ADR-007** (client-side WASM LaTeX) — conditional on the week-1 spike in Phase 5.
- **ADR-011** — conditional on the Phase 0 spike proving Prisma works on workerd via Hyperdrive. If it doesn't, the fallback ladder is in `../00-product-plan.md` §12; note that only the *runtime query layer* is at risk, not the schema or RLS work.
- **ADR-013** — a deliberate deferral, not a conclusion.
- **ADR-014** — reversible by design. The Claims panel is editor-agnostic and `Document`/`DocUpdate` stay in the schema, so building Phase 4b confidential mode is additive rather than a rewrite. Expect the first institution that refuses Google Drive to trigger it.
