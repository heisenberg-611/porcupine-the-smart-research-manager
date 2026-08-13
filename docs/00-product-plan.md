# Porcupine — Research & Thesis Management Platform

## Master Execution Plan

**Status:** v6 · **Date:** 2026-08-13 · **Owner:** Dhrubojyoti

> **v2** — E2EE narrowed to messages + documents. AI dropped. Public bibliographic APIs as the discovery layer. LaTeX studio added. Open decisions resolved in §11.
> **v3** — Hosting moved to Cloudflare Workers + R2 (ADR-011). File storage moved from Supabase Storage to R2 with Worker-mediated authorization. Job split across Cron Triggers/Queues and `pg_cron`. Cost model added (§5.1).
> **v4** — Google Workspace enters the loop (§5.2, ADR-014). Google Docs becomes the default prose surface, replacing the native Tiptap/Yjs editor; Google Sheets becomes a first-class export target. **Documents leave the E2EE tier** — encrypted content is now messages + LaTeX only. Provenance moves from inside documents into a native Claims panel. Phase 4 shrinks from 5 weeks to 3.
> **v5** — Real-time LaTeX co-editing specified properly and moved onto **Cloudflare Durable Objects** (ADR-017, superseding decision #12). **Character-level attribution** from Yjs client IDs and **client-side Git as a materialized projection** added (ADR-016). Full **source control panel with GitHub PR/merge** via a GitHub App (ADR-018). Phase 5 grows 5 → 9 weeks; total 34 → 38.
> **v6** — **Hosting moved to Vercel** (ADR-019, superseding ADR-011); R2 keeps the files, and one standalone Cloudflare Worker keeps the collab relay (ADR-020). Every conflict in `04-conflicts-and-hazards.md` now has a mechanism and an acceptance test in **`05-resolution-plan.md`** — including the `docEpoch` merge protocol (ADR-021) and role-shaped-only contribution (ADR-022). Scope cut to what the vision needs: total 38 → **34 weeks**; **MVP unchanged at ~11**. Pilot cost $5/mo → **$0**.

---

## 1. The problem, stated precisely

A researcher's workflow today is spread across Google Scholar/arXiv (discovery), Zotero or a Downloads folder (storage), a PDF reader (reading), Google Docs (synthesis), Sheets (evidence tables), WhatsApp (coordination), Overleaf (writing), and email (supervisor feedback). Nothing links to anything else.

Four failures follow:

1. **Progress is invisible.** Nobody can answer "how far through the literature are we?" without counting by hand.
2. **Extraction is inconsistent.** Four people reading the same corpus record different fields in different formats, so synthesis becomes re-reading.
3. **Provenance is lost.** A claim in the draft can't be traced to the sentence that supports it — this is where citation errors come from.
4. **Contribution is unattributable.** The person who kept docs organised and the person who checked the math both "worked on the paper"; only one is visible in the output.

Porcupine's thesis: **the unit of work is not the paper, it is the extracted claim.** Reading progress, task assignment, synthesis, writing, and credit all hang off a structured extraction anchored to a specific location in a specific document.

---

## 2. Positioning

|            |                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------ |
| **Is**     | A collaborative research pipeline: discover → screen → extract → synthesize → **write** → export |
| **Is not** | A reference manager (integrate Zotero, don't replace it), a PDF library, an AI writing tool      |

**Comparables and the gap:** Zotero (great library, no pipeline or collaboration depth). Covidence/Rayyan (great screening, closed, expensive, no synthesis or writing). Overleaf (great LaTeX, zero connection to your corpus). Notion/Obsidian (great docs, no research primitives).

Nobody joins _screening → extraction → provenance-linked synthesis → LaTeX writing → supervision → credit_ into one loop. The single sharpest wedge: **your `.bib` file and your `\cite{}` autocomplete come from your own screened corpus, automatically.** Overleaf structurally cannot do that.

**Design principle:** never make the user re-enter what the system already knows. Evidence tables are _generated_ from extractions. The PRISMA diagram is _derived_ from screening decisions. The bibliography is _derived_ from the library. The contribution statement is _derived_ from the activity ledger.

---

## 3. Core domain concepts

- **Work** — a canonical scholarly artifact (DOI/arXiv/OpenAlex ID). Global, deduplicated, public metadata.
- **Project** — a thesis, review, or lab paper. The unit of membership, permissions, and encryption.
- **Question** — a research question or sub-question. Works and Claims link to Questions; this is the anti-drift mechanism.
- **ProjectWork** — a Work admitted to a Project: screening decision, reading status, assignee, priority, tags.
- **Protocol** — the project's extraction schema: ordered typed Fields. Versioned. This _is_ "the pipeline."
- **Extraction** — one person's filled Protocol for one ProjectWork. Multiple per work expected; disagreement is a first-class state.
- **Anchor** — precise location in a document: page + quote + offsets + fuzzy fallback.
- **Annotation** — highlight or margin note bound to an Anchor.
- **Claim** — a synthesized statement linked to its supporting Extractions/Annotations. The provenance edge. Lives in Porcupine's Claims panel, _exports_ into prose.
- **LinkedDoc** — a Google Doc bound to a Project. Porcupine creates it, pushes content into it, and reads its comments back into the review queue. Content lives at Google, not in Porcupine.
- **SheetExport** — a Google Sheets spreadsheet Porcupine writes and re-syncs: a Corpus tab and an Evidence tab.
- **LatexProject** — a compilable multi-file LaTeX source tree (E2EE).
- **Channel / Message** — project chat and DMs (E2EE).
- **TableView** — a saved view over Extractions: the "sheet." Derived, never authoritative.
- **Contribution** — append-only ledger event mapped to the CRediT taxonomy.

---

## 4. Roles and permissions

Two orthogonal axes — keep them separate.

**Access role:** `owner`, `admin`, `contributor`, `reviewer`, `observer`
**Function role** (multi-valued, informational, drives assignment defaults and credit): `supervisor`, `co_supervisor`, `lead`, `extractor`, `verifier`, `curator`, `methodologist`, `coordinator`

Supervisors map to `reviewer`: full read, comment and suggest everywhere, cannot delete, cannot change the Protocol, cannot be removed by the student they supervise.

**Supervisor added after project creation** triggers an explicit prompt: _"Grant access to work created before they joined? (All history / From now on)."_ For plaintext data this is a policy flag on the membership row; for E2EE content it determines whether prior key epochs are re-wrapped to them. Default is **All history** — the common case is a supervisor joining a thesis already in progress, and defaulting to a partial view creates confusing empty screens.

Supervisors get a **review queue** with a per-supervisor digest cadence, not a notification firehose. This is the single most important UX decision for faculty retention.

An `Organization` layer (SSO, seats, retention) sits above projects. Not in MVP, but the tables exist from day one — retrofitting a tenant column is miserable.

---

## 5. Architecture

> **v6 — hosting moved to Vercel.** ADR-011 (Cloudflare Workers via OpenNext) is superseded by **ADR-019**. Files stay on R2 and a single Cloudflare Worker stays as the collaboration relay. Full reasoning and the resolution of every conflict this creates or removes: **`05-resolution-plan.md`**.

```
┌────────────────────────────────────────────────────────────────────┐
│ Client — Next.js 16 App Router, React 19, TS strict                │
│  ├─ Crypto worker (libsodium WASM) → messages + LaTeX only         │
│  ├─ PDF reader (pdf.js) + anchoring engine                         │
│  ├─ LaTeX studio: CodeMirror 6 + Yjs + WASM TeX + isomorphic-git   │
│  └─ IndexedDB — CACHE ONLY, never storage of record                │
└──┬──────────────┬───────────────────┬──────────────────────┬───────┘
   │ supabase-js  │ SSR / Route       │ presigned GET/PUT    │ WSS
   │ (RLS, JWT    │ Handlers          │ (HTTP range)         │ (opaque
   │  per request)│                   │                      │  ciphertext)
   │              ▼                   ▼                      ▼
   │   ┌────────────────────┐  ┌──────────────┐  ┌──────────────────────┐
   │   │ VERCEL             │  │  R2 buckets  │  │ CLOUDFLARE (relay    │
   │   │ Next.js · Node 24  │  │ papers ·     │  │ only — no SSR)       │
   │   │ · file-authz route │─▶│ tex-dist ·   │  │ Worker + Durable     │
   │   │ · BFF / API        │  │ latex-assets │  │ Object per file      │
   │   │ · Google + GitHub  │  │ build-output │  │ WebSocket Hibernation│
   │   │   token proxy      │  │ (zero egress)│  │ ~300 LOC, free tier  │
   │   └─────────┬──────────┘  └──────────────┘  └──────────┬───────────┘
   │             │ Prisma (Supavisor txn pooler :6543)      │ append
┌──▼─────────────▼─────────────────────────────────────────▼──────────┐
│ SUPABASE — Postgres · Auth · Realtime (change subs) · pg_cron · pgmq │
│ RLS deny-by-default + FORCE on every table · tsvector FTS            │
└──────────────────────────────────────────────────────────────────────┘
```

**Why this shape.** Compute is unusually light — crypto runs in the browser, LaTeX compiles in the browser, uploads go client→R2 directly, and Postgres does the aggregation. What the app is heavy on is **egress**: a ~30 MB TeX distribution per new device plus every PDF a researcher opens.

That egress argument was always an argument for storing _files_ on R2, not for hosting _compute_ on Cloudflare — and separating those two decisions is what this architecture does. PDFs and the TeX distribution move client ↔ R2 over presigned URLs and never touch the application host, so Vercel serves only HTML, JS, and JSON. R2 keeps charging zero egress; Vercel's Node runtime removes the entire "Prisma on workerd" risk class; and a single Cloudflare Worker survives to hold the one thing Vercel cannot, an open WebSocket.

### Stack

| Layer            | Choice                                                                                                  | Note                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Framework        | Next.js 16 App Router, React 19, TS `strict`                                                            |                                                                                                    |
| DB               | Supabase Postgres                                                                                       |                                                                                                    |
| Schema           | Prisma (migrations + trusted server writes)                                                             | RLS boundary in ADR-002                                                                            |
| Client reads     | `supabase-js` with RLS + Realtime                                                                       | RLS is the real authz layer                                                                        |
| Auth             | Supabase Auth — email OTP, Google; SAML/OIDC in Phase 7                                                 | ORCID as a linked identity, not a login provider                                                   |
| UI               | Tailwind + shadcn/ui (Radix)                                                                            | Radix gives WCAG keyboard/focus semantics for free                                                 |
| Server state     | TanStack Query                                                                                          |                                                                                                    |
| Tables           | TanStack Table + Virtual                                                                                | evidence tables reach 10k+ rows                                                                    |
| Prose documents  | **Google Docs** via Drive + Docs API                                                                    | ADR-014; native Tiptap/Yjs editor deferred to "confidential mode"                                  |
| Tabular export   | **Google Sheets** via Sheets API v4                                                                     | Corpus + Evidence tabs, re-syncable                                                                |
| Google auth      | OAuth 2.0, **`drive.file` scope only** + Picker API                                                     | see §5.2 — this choice avoids a five-figure annual security assessment                             |
| LaTeX            | CodeMirror 6 + Yjs + WASM engine                                                                        | see `03-latex-studio.md`                                                                           |
| PDF              | pdf.js, JS disabled, sandboxed                                                                          |                                                                                                    |
| Files            | **Cloudflare R2** (S3-compatible), private buckets, presigned URLs                                      | zero egress; Prisma stores metadata rows only                                                      |
| Crypto           | libsodium-wrappers-sumo in a Web Worker                                                                 | XChaCha20-Poly1305 + X25519 sealed boxes                                                           |
| Search           | Postgres `tsvector` + GIN (plaintext tiers) · Orama in IndexedDB (E2EE tiers)                           |                                                                                                    |
| Jobs             | **`pg_cron` (schedules) + `pgmq` (queues)**; outbound HTTP dispatched to a Vercel route handler         | Vercel Cron on Hobby is 2 jobs at daily granularity — too coarse. See `05-resolution-plan.md` R-22 |
| DB access        | Prisma via **Supavisor transaction pooler** (`:6543`) at runtime; `DIRECT_URL` (`:5432`) for migrations | `migrate deploy` cannot run through the transaction pooler                                         |
| Real-time collab | **Cloudflare Worker + Durable Object per file**, standalone                                             | ADR-020 — Vercel has no inbound WebSockets. Behind `CollabTransport`                               |
| Hosting          | **Vercel** (Next.js, Node runtime) + **R2** (files) + **Supabase** (data)                               | ADR-019; no proprietary APIs in app code                                                           |
| Testing          | Vitest, Playwright, **pgTAP for RLS**                                                                   | untested RLS is not security                                                                       |
| Observability    | Sentry + PostHog                                                                                        |                                                                                                    |

### 5.1 Hosting specifics (ADR-019 / ADR-020)

**What Vercel gives back.** The Node runtime is real Node — Prisma works with no driver adapter, no `nodejs_compat` flag, and no Hyperdrive. Hobby allows **300 s max duration, 2 GB / 1 vCPU, 250 MB bundles, full Node API coverage**. Three of this plan's highest-severity risks were artifacts of `workerd` and are simply gone.

**What Vercel takes away, and the one thing it costs.** Vercel Functions do not accept inbound WebSocket connections, so the real-time transport cannot live there. A **standalone Cloudflare Worker with one Durable Object per LaTeX file** keeps that job — and this is a clean decomposition rather than a compromise, because LaTeX sources are E2EE: the relay cannot decrypt Yjs ops, so it was always a dumb ciphertext-shuffler with no CRDT logic. Its CPU per message is microseconds, so the 10 ms free-tier cap that made Workers unusable for SSR is irrelevant here. WebSocket Hibernation means idle documents cost nothing. Details and the rejected alternatives (Supabase Realtime, Liveblocks, self-hosted `y-websocket`) are in `05-resolution-plan.md` R-21.

**Two constraints to plan around, not discover:**

- **Vercel Hobby forbids commercial use.** The day Porcupine charges anyone — including a lab paying a seat fee — Hobby is a ToS violation. This converts the pricing question from "decide before the pilot" into a hard prerequisite. See R-20.
- **Request/response bodies cap at 4.5 MB.** Irrelevant here only because uploads are presigned `PUT` straight to R2. Never add a route that proxies file bytes.

**R2 buckets.** Four, all private, no public bucket exists:

| Bucket         | Contents                                  | Access                                                         |
| -------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `papers`       | per-user PDF copies                       | presigned GET, 5-min TTL, issued only after a membership check |
| `tex-dist`     | TeX Live subset + CTAN package mirror     | public-readable via Worker, immutable, cached forever          |
| `latex-assets` | images and binaries inside LaTeX projects | presigned, per-project                                         |
| `build-output` | compiled PDFs (encrypted)                 | presigned, per-project                                         |

**File authorization replaces Supabase Storage RLS.** R2 has no row-level security, so the check moves into a Vercel route handler: validate the JWT → confirm `is_project_member` → issue a short-TTL presigned URL. Uploads are presigned `PUT` straight to R2, so file bytes never pass through Vercel. Presigned URLs support HTTP range requests natively, which is what keeps pdf.js progressive rendering working. Presigning is host-agnostic SigV4, so this survived the hosting change unchanged.

**The COEP/CORP trap — this will cost you a day if you don't know it.** `SharedArrayBuffer` needs `Cross-Origin-Embedder-Policy: require-corp`, which in turn means _every_ cross-origin resource must send `Cross-Origin-Resource-Policy: cross-origin`. The crypto worker and the WASM TeX engine both want `SharedArrayBuffer`, and the TeX packages come from R2 — a different origin. **Set `CORP: cross-origin` on all `tex-dist` objects at upload time**, or the TeX engine silently fails to load its packages under COEP.

**Job split.** All scheduling lives in Postgres: **`pg_cron` for schedules, `pgmq` for queues** with retry and dead-letter semantics. Jobs needing outbound HTTP — federated API polling, OA resolution, saved-search alerts, Drive permission reconciliation — are dispatched by `pg_cron` to a Vercel route handler with a service token, which does the fetch in real Node with a 300 s budget. This also gives the arXiv rate limiter (1 req/3 s) a genuinely atomic cross-invocation token bucket via `SELECT … FOR UPDATE`, which per-isolate counters could never provide. See `05-resolution-plan.md` R-22.

**Virus scanning is deferred, and stated as absent.** ClamAV needs a long-running process and there is nowhere cheap to put one. v1 mitigation: magic-byte type validation, size and page caps, and pdf.js with scripting disabled in a sandboxed context — the exploitation path is narrow. If an institution requires AV, run it as a `pgmq` consumer on a cheap VPS rather than reworking the host. **Never claim scanning that doesn't exist.**

**Cost model.**

| Line                 | Pilot (non-commercial)                                     | First paying user                             |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| Vercel               | **$0** Hobby — 300 s duration, 2 GB, full Node             | **$20/mo** Pro (Hobby forbids commercial use) |
| CF Worker + DO relay | **$0** — 100k DO req/day, WS billed 20:1, hibernation free | $0–5/mo                                       |
| R2 storage           | **$0** — 10 GB free; ~2 GB used with OA dedupe (R-04)      | $0.015/GB-mo                                  |
| R2 egress            | **$0**                                                     | **$0**                                        |
| Supabase             | **$0** — 500 MB DB                                         | **$25/mo** Pro                                |
| **Total**            | **$0/mo**                                                  | **~$45/mo**                                   |

Better than the Cloudflare-only plan on every axis: the floor drops from $5 to **$0**, the highest-severity technical risk vanishes with `workerd`, and R2's zero egress — the actual reason Cloudflare was chosen — is fully retained. The line that scales with users is R2 storage; see `04-conflicts-and-hazards.md` C-04 and its resolution in R-04 for why naive per-user PDF copies grow faster than you'd expect.

### 5.2 Google Workspace integration (ADR-014)

**The division of labour.** Porcupine owns structure, provenance, and the pipeline. Google owns prose editing and spreadsheet viewing. Neither tries to be the other.

| Surface                                                       | Owner                        | Why                                                                                                               |
| ------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Corpus, screening, extractions, claims, provenance            | **Porcupine**                | Structured, queryable, the actual product                                                                         |
| Prose: literature reviews, protocols, meeting notes, chapters | **Google Docs**              | Real-time editing, comments, and suggestion mode already exist and are already familiar to every supervisor alive |
| Tabular deliverables and ad-hoc pivots                        | **Google Sheets**            | Supervisors and committees ask for spreadsheets; give them one that stays current                                 |
| LaTeX manuscripts                                             | **Porcupine** (native, E2EE) | Google Docs cannot host LaTeX; this is where the `\cite{}`-from-corpus differentiator lives                       |

**OAuth scope — get this right or it costs real money.** Use **`drive.file` only**, never `drive` or `drive.readonly`. `drive.file` grants access solely to files your app created or the user explicitly picked via the **Google Picker API**, and it is _not_ a restricted scope. Broad Drive scopes are restricted and trigger Google's CASA security assessment — a recurring third-party audit that costs five figures annually. Structuring the integration so Porcupine always **creates** the Doc or Sheet (or receives it through the Picker) sidesteps that entirely, and gives users a better privacy story: you cannot see the rest of their Drive.

**Sheets export — two tabs, re-syncable.** One spreadsheet per project, written by the Sheets API, updated in place rather than duplicated:

- **Corpus tab** — one row per included work: title, authors, year, venue, DOI, URL, OA status, citation count, source impact, screening status, exclusion reason, assignee, tags.
- **Evidence tab** — one row per work × the active Protocol's fields; the same data as the in-app evidence table.

Re-sync is idempotent: match on `Work.citationKey`, update changed cells, append new rows, and never clobber a column the user added to the right of your range. Add a frozen header row, a "generated by Porcupine — edits outside column X will be preserved" note, and a last-synced timestamp.

> **On "impact":** journal impact factor is Clarivate's proprietary JCR metric and **cannot be legally redistributed**. Use OpenAlex's `2yr_mean_citedness` on the source (an impact-factor-shaped metric, freely licensed) or Scimago SJR, and label the column accurately. Shipping a column called "Impact Factor" populated from a scraped source is a licensing problem, not a shortcut.

**Docs integration — what Porcupine does and does not do.**

Does: create a Doc from a project template; push a formatted claim or evidence summary into it with citations; insert a generated bibliography; read comments back via the Drive comments API and surface them in the supervisor review queue; track last-modified for milestone signals.

Does not: render live provenance chips inside the Doc (Google has no custom block type), programmatically accept or reject suggestions (Google's suggestion mode isn't exposed for that), or search Doc content in your local index.

**The provenance marker format (R-08) — decided now, because it cannot be decided later.**

Anything Porcupine writes into a Doc is wrapped in a **Google Docs named range**:

| Content pushed | Named range |
|---|---|
| A citation | `pcp.cite.<citationKey>` |
| A claim with its supporting evidence | `pcp.claim.<claimId>` |
| A generated bibliography block | `pcp.bib.<protocolVersion>` |

Named ranges are invisible to the writer, survive ordinary editing, and are readable through the Docs API. Sentinel text — `[[pcp:cite:smith2020]]` and the like — was the obvious alternative and is worse in every way: users delete it, reformat it, or paste it into their own prose, and it is ugly in a document a supervisor reads.

**Why this is a Phase 0 decision about a Phase 4 feature.** The Doc → LaTeX import in Phase 5 (C-08) converts markers back into `\cite{}`. Documents written before the marker format exists have no markers, and there is no way to reconstruct them — the information was never captured. Every Doc written between shipping the integration and settling this format would be permanently un-importable. Ranges are cheap to write and cost nothing if unused, so they go in from the first Doc.

**The authorization seam — the part most likely to cause a security incident.** Removing someone from a Porcupine project does **not** remove their Google Drive access. You now have two sources of truth for who can read what. Mitigation: Porcupine owns the Doc, mirrors membership changes to Drive permissions via the API on every membership write, runs a nightly reconciliation that reports drift, and shows the _actual_ Drive permission list in the project UI rather than assuming it matches. Treat any drift as a security finding.

### Bibliographic APIs (the discovery layer — all free)

| Source                  | Use                                                          | Limits                              |
| ----------------------- | ------------------------------------------------------------ | ----------------------------------- |
| **OpenAlex**            | Primary. Full metadata, citation graph, concepts, no API key | polite pool via `mailto=`, 100k/day |
| **Crossref**            | DOI truth, publisher metadata                                | polite pool via `mailto=`           |
| **arXiv**               | Preprints + direct PDFs                                      | 1 req / 3s — queue it               |
| **Semantic Scholar**    | TLDRs, influential-citation counts                           | free key, 1 rps                     |
| **Europe PMC / PubMed** | Biomedical                                                   | generous                            |
| **Unpaywall**           | Legal OA PDF resolution                                      | `email=` required                   |
| **DOAJ / CORE**         | OA full text                                                 |                                     |
| **Zotero API**          | Import, later two-way sync                                   |                                     |

**Federated search:** one query fans out to the enabled providers, results are deduplicated (DOI → arXiv ID → normalized title+year), merged, and ranked. Cache every provider response in `Work.raw` — you should hit a provider once per work, ever.

**Saved searches with alerts** replace the AI discovery feature at zero marginal cost: a stored query runs weekly via `pg_cron`, diffs against known works, and adds new hits to a "suggested" tray in the project. This is high-value and costs nothing but a worker.

> **Legal constraint, non-negotiable:** never redistribute a paywalled PDF between users. Deduplicate _metadata and annotations_ across users; never the file bytes. Server-side fetch only from Unpaywall-verified OA. Enforce in code, state in ToS.

---

## 6. Encryption scope (confirmed — detail in `02-security-and-e2ee.md`)

| Tier                     | Contents                                                                                                        | Protection                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Public**               | `Work` metadata, project/org names, member display names                                                        | None needed                                                                                                            |
| **Server-confidential**  | Membership, roles, screening/reading status, annotations, extraction values, questions, claims, tasks, activity | RLS + at-rest disk encryption. Server can read → **server-side search, sorting, filtering, and aggregation all work.** |
| **Third-party (Google)** | Prose documents and exported spreadsheets                                                                       | Google's encryption at rest and their ACLs. **Porcupine cannot protect this content, and neither can you.**            |
| **End-to-end encrypted** | Messages (channels + DMs), LaTeX sources, and comments on them                                                  | XChaCha20-Poly1305 under per-project keys wrapped to each member. Server stores ciphertext only.                       |

This is a much better trade than full E2EE. The two genuinely private things — private conversation and unpublished draft text — are protected, while the machinery that makes the product _work_ (a 300×20 evidence table you can sort and filter server-side, full-text search across your annotations, progress dashboards) stays fast and simple.

Consequences accepted: the server can read annotations and extraction values, and **Google can read anything written in a Google Doc**. The honest claim is now:

> _"Your messages and LaTeX manuscripts are end-to-end encrypted — we cannot read them. Your library, highlights, and extracted data are encrypted at rest and access-controlled. Prose documents live in your own Google Drive under Google's terms."_

Never say "fully end-to-end encrypted." For labs that cannot put unpublished work in Google Drive — and some institutions genuinely cannot — **confidential mode** (native E2EE documents, the deferred Tiptap/Yjs build) is the answer, not a caveat in the marketing copy.

**Generate every user's identity keypair at signup starting in Phase 0**, even though nothing is encrypted until Phase 3. Public keys for early users must already exist when the crypto features land, or you'll need a painful re-enrollment.

---

## 7. Roadmap

### Phase 0 — Foundations (2 weeks) — _was 3; the workerd spike is gone_

Repo, CI, TS strict, Prisma + Supabase with `DIRECT_URL` for migrations, restricted DB role, deny-by-default RLS baseline, pgTAP harness, design tokens + component scaffold, ADRs accepted, threat model.
Ship signup that **generates and stores identity public keys** — nothing uses them yet.
Plus the `05-resolution-plan.md` §5 pre-flight: `axe-core` in CI (G-07), `Work.language` + `simple` FTS config in the baseline migration (R-14), the Docs named-range marker format specified (R-08), and provisional pricing written down (R-20).
**Exit:** create a project, invite a member, and nothing else — but every table has a tested RLS policy and the pre-flight checklist is green.

### Phase 1 — Discovery, corpus & reading (6 weeks) — _smallest useful slice_

- Federated search across OpenAlex/Crossref/arXiv/S2/Europe PMC, deduped, one-click add
- Saved searches + weekly alerts
- Import: DOI, BibTeX, RIS, Zotero, PDF upload (direct-to-Storage signed URL)
- Library: virtualized table, filters, saved views, bulk actions
- Screening pipeline `identified → screening → included|excluded → reading → extracted → synthesized`, exclusion reasons
- Assignment, due dates, per-person queue
- PDF reader: highlights, margin notes, **anchoring engine** (page + quote + offsets + fuzzy fallback)
- Progress: burndown against milestones, reading velocity
- Postgres FTS across works and annotations

**Exit:** a 4-person team runs screening on 300 papers and sees progress. **Ship this to a real lab.**

### Phase 2 — Extraction pipeline (4 weeks) — _the differentiator_

_Was 5. Dual extraction moves to 2b per R-06 — build the THESIS path first._

- Protocol builder: typed fields, ordering, help text, required flags, versioning with migration prompts
- `capabilities(Project.kind)` gates every screen (R-06); `THESIS` gets a freeform notes protocol and optional extraction
- Starter templates: PICO/RCT, qualitative, ML-benchmark, engineering-systems
- Extraction form beside the PDF; quote fields capture an Anchor on highlight
- Evidence Table generated from Protocol × Extractions: group, pivot, filter, export CSV/XLSX
- Cell → source: any cell opens the PDF at its exact anchor
- **Google Sheets export** (§5.2): one spreadsheet per project, Corpus + Evidence tabs, idempotent re-sync. Ships here rather than in Phase 4 because the data exists now and supervisors will ask for it the moment they see the evidence table.
- **PRISMA 2020 flow diagram**, auto-derived from screening decisions

**Exit:** inconsistent evidence tables become structurally impossible.

### Phase 2b — Systematic-review rigor (2 weeks, after real THESIS usage)

**Dual extraction + reconciliation:** two independent extractors, diff view, verifier resolves, Cohen's κ reported. Gated to `SYSTEMATIC_REVIEW`. Deliberately sequenced behind a real thesis student using the tool (R-06) — the rigorous path is a strict superset of the loose one, so this ordering costs nothing.

### Phase 3 — Crypto envelope + Messaging (4 weeks)

Messages are the ideal first encrypted surface: append-only, no merge semantics, immediate user value.

- Key hierarchy: Argon2id KEK → Master Key → identity keys → per-project key, wrapped per member, epoch-based
- Recovery codes, device registration, key fingerprint (safety number) display
- Project channels, threads, DMs, mentions, read receipts, presence — all E2EE
- Member removal → key rotation; new-member provisioning flow
- Client-side search index over messages

### Phase 4 — Synthesis & Google Docs (3 weeks)

_Was 5 weeks and a custom editor. ADR-014 removes the editor build._

- Google OAuth (`drive.file`) + Picker; connect account, per-project Doc creation from templates
- **Claims panel — native, and the differentiator:** build a claim, attach supporting extractions/annotations, see every supporting quote, get flagged when support is edited or its source is later excluded
- Push to Doc: insert a claim or an evidence summary as formatted text with citations; insert a generated bibliography
- Pull from Doc: read Drive comments into the supervisor review queue; surface last-modified for milestone signals
- Drive permission mirroring on every membership change + nightly drift reconciliation
- Question coverage view: which works and claims address each research question
- Export: Markdown, DOCX, PDF (native), plus the Doc itself

### Phase 4b — Confidential mode (deferred, ~4 weeks, build on demand)

Native E2EE documents (Tiptap + Yjs, encrypted updates, client-elected compaction) for institutions that cannot put unpublished research in Google Drive. **Do not build speculatively** — build it when a specific institution says the words. The Claims panel is already editor-agnostic, so this slots in without rework.

### Phase 5 — LaTeX studio (9 weeks) — _see `03-latex-studio.md`_

- CodeMirror 6 multi-file editor, LaTeX syntax highlighting, folding, outline
- Non-AI completion: TeX command database, environments, packages, snippets, math palette
- **`\cite{}` autocomplete from the project corpus; `references.bib` auto-generated and kept in sync**
- `\ref{}` / `\label{}` resolution across files, undefined-reference linting
- Client-side WASM compilation → PDF preview with SyncTeX forward/inverse search
- **Real-time co-editing over a standalone Durable Object relay** (ADR-020): live cursors, remote selections, per-file presence, follow mode, offline reconnect. p95 < 150 ms budget.
- **The `docEpoch` pull protocol** (R-01): freeze → materialize → fetch → three-way Git merge → rebuild the Yjs doc → broadcast a swap. Offline reconnects across an epoch become a Git branch, never a Yjs replay. Budget ~2 of these 9 weeks; it has no shortcut.
- **Blame gutter** from Yjs client IDs — **author-visible only, never aggregated, never exported** (R-07)
- **Git as a materialized projection** (ADR-016): client-side `isomorphic-git`, encrypted objects pushed to R2 **on commit, never lazily** (R-12), idle auto-commit with `Co-authored-by:` trailers
- **Full source control panel** (ADR-018): stage/diff/commit/branch/merge locally; push, pull, PRs, review, merge, and Actions status against GitHub via a **GitHub App**. Projects are Private (E2EE) or GitHub-linked (plaintext) — explicit, one-way, badge suppressed.
- Journal and university thesis templates; export to PDF, source zip, Overleaf

### Phase 6 — Supervision & credit (3 weeks) — _was 4; R-07 removes the analytics build_

- Supervisor onboarding, multi-project dashboard, review queue with per-supervisor digest cadence
- Milestones tied to real dates (proposal, committee, defense) with risk flags when velocity won't meet them
- Suggestion workflow with accept/reject and a visible response obligation
- **CRediT ledger** → roles self-declared, member-confirmed, evidenced by _activity kind not volume_; exportable as an author contribution statement. **No scores, no percentages, no ranking, no leaderboard** (R-07)
- Activity feed and full audit log

### Phase 7 — Hardening & scale (3 weeks) — _was 4; SSO and offline mode cut_

Org admin console, WCAG 2.2 AA audit and remediation, mobile reading/annotation polish, performance budgets, **external penetration test**, data export and account deletion, DPIA.
Institutional SSO (SAML/OIDC) ships **on demand**, when a named institution asks (R-18). Offline mode is cut as a feature — IndexedDB is a cache, never storage of record (R-12).

**Total to v1.0: ~34 weeks** for 2–3 engineers (from 38). Solo: roughly double — in which case take the Phase 5 fallback ladder in `03-latex-studio.md` §10 rather than cutting real-time, which is a stated requirement. If Phase 5 runs late, **cut GitHub _pull_ before you cut the epoch protocol** — push-and-PR-only is a coherent product; a half-implemented merge is a corruption bug.

> **Scope note, stated once.** This plan grew 31 → 38 weeks across five revisions and came back to **~34** in v6 by cutting what wasn't load-bearing (`05-resolution-plan.md` §3). **The MVP in §8 has not changed and is still ~11 weeks.** That is the number that matters — everything past it is sequencing, and sequencing can be renegotiated after a real lab has used the thing. If any single revision starts pushing the _MVP_ boundary, that is the signal to stop adding.

---

## 8. MVP cut — build exactly this

Target story: _a supervisor and three master's students run a 300-paper systematic review over one semester._

**In:** auth, project + members + roles, federated search + import, library with screening pipeline and assignment, PDF reader with highlights and notes, Protocol builder (text/number/enum/quote), extraction form, evidence table with CSV export, comments on extraction fields, supervisor read+comment role, activity feed.

**Out of MVP:** everything encrypted, documents, LaTeX, PRISMA, offline, contribution analytics, SSO, Zotero two-way sync, citation graph.

If you build any of the "out" list before the "in" list is in a real lab's hands, this takes two years and misses what researchers actually need.

---

## 8.1 Pricing (R-20 — provisional, but decided)

C-20 said "decide before the pilot." C-22 made it sooner: **Vercel Hobby forbids commercial use**, so the day anyone pays, the deploy must already be on Pro. The numbers below are provisional; the *shape* is not.

| Tier | Price | Who | Limits |
|---|---|---|---|
| **Free** | $0 | Individual students and researchers | 1 project · 2 GB storage · unlimited collaborators on that project |
| **Researcher** | $6/mo | A PhD student who wants their whole thesis in here | Unlimited projects · 20 GB · LaTeX studio · GitHub linking |
| **Lab** | $5/seat/mo, 3 seats min | A PI with a group | Everything above · shared corpus · supervisor dashboard · 50 GB pooled |
| **Institution** | Quoted | Procurement got involved | SSO, DPIA, retention policy, self-host option, invoicing |

**Why this shape.**

- **Free must be genuinely useful, not a trial.** Research tools spread bottom-up (C-18) — a student adopts it, then their lab, then the department. A crippled free tier kills the only distribution channel this product has. One real project, fully featured, is the right free tier.
- **Collaborators on a free project are free.** Charging per collaborator would tax exactly the behaviour the product exists to encourage, and it is how a four-person team decides to keep using a shared Google Doc instead.
- **Storage is the metered axis** because storage is the cost that scales with users (R-04). Everything else on the stack is near-flat.
- **Supervisors are never billed.** A supervisor with eight students would face the largest bill and gets the least value per project. Free reviewer seats are a customer-acquisition channel, not a loss.

**Unit economics at pilot scale.** Infrastructure is ~$45/mo fixed (§5.1) plus ~$0.015/GB-mo of R2. One paying Researcher covers the fixed cost at roughly eight subscribers. That is not a business yet, but it means the product does not lose money per user, which is the property that matters before there is a business.

**Revisit when** the first real corpus tells us the OA dedupe rate (R-04 assumes 45%, optimistic outside biomedicine). If it is much lower, storage tiers move, not prices.

---

## 9. What replaces the AI features

Dropping AI costs less than it appears. Each intended capability has a deterministic substitute:

| Dropped AI feature                       | Replacement                                                                                                                                                        | Cost |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| AI-suggested extraction                  | Protocol templates + quote-capture-on-highlight + keyboard-driven form                                                                                             | Zero |
| Relevance ranking of the screening queue | Rank by citation count, recency, venue, and **keyword hits from the project's Questions**; plus TF-IDF similarity to already-included works (computed in Postgres) | Zero |
| Related-work discovery                   | OpenAlex citation graph: forward/backward snowballing from included works, scored by co-citation                                                                   | Zero |
| Chat-with-your-PDF                       | Full-text search across the corpus with anchor-linked results                                                                                                      | Zero |
| Duplicate/contradiction detection        | Exact + trigram similarity across extraction values in Postgres                                                                                                    | Zero |
| Writing suggestions                      | Deterministic LaTeX completion from command DB, project bib, and labels                                                                                            | Zero |

The schema keeps `Extraction.origin` and a `Project.assistEnabled` flag as inert columns, so AI is addable later without a migration. Don't build against them now.

---

## 10. Suggestions worth fighting for

1. **`.bib` generated from your corpus, with `\cite{}` autocomplete.** The strongest single feature in the product. Overleaf cannot do it; Zotero's plugin is a poor substitute.
2. **PRISMA auto-diagram.** Mandatory publication artifact currently drawn by hand in PowerPoint. ~3 days once Phase 1 exists.
3. **Provenance-linked claims.** Nobody else has it; makes the tool feel like it's protecting your integrity.
4. **CRediT contribution statements.** Standards-based, exportable, directly answers "everyone contributes differently."
5. **Digest-first supervisors.** Decides whether faculty adopt or ignore the tool.
6. **Zotero import on day one.** Migration friction is the #1 killer of research tools.
7. **Saved-search alerts.** Replaces AI discovery at zero cost and creates a weekly reason to return.
8. **Reading velocity → milestone risk.** _"At this pace you finish screening 3 weeks after your proposal deadline"_ is the sentence that earns trust.
9. **Accessibility as a launch requirement.** Public universities in the EU, US, and India have procurement rules that disqualify you outright otherwise.
10. **Quote integrity.** Every stored quote keeps its anchor; pasting it into a document brings attribution along. Cheap, and it prevents the accidental-plagiarism failure that terrifies supervisors.

Still not recommended: a social/discovery network (different product, needs network effects you won't have), and writing your own citation-style engine (use CSL via `citeproc-js`).

---

## 11. Decisions taken

You asked me to decide the open items. These are now the plan; override any you disagree with.

| #   | Decision                                                                                                                                | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **E2EE covers messages and LaTeX sources** (documents moved out in v4 — see #13)                                                        | Protects private conversation and unpublished manuscripts while keeping search, sorting, and aggregation server-side. Roughly halves crypto complexity.                                                                                                                                                                                                                                                       |
| 2   | **No AI in v1; inert schema hooks retained**                                                                                            | Your call on cost. Every dropped capability has a zero-cost deterministic substitute (§9).                                                                                                                                                                                                                                                                                                                    |
| 3   | **Supervisor history access is prompted at add time; default = All history**                                                            | Your call. Default chosen because supervisors usually join mid-thesis, and a partial view produces confusing empty screens.                                                                                                                                                                                                                                                                                   |
| 4   | **Files → Cloudflare R2, never Postgres**                                                                                               | Range requests, presigned URLs, and **zero egress**. Direct client→R2 uploads keep file bytes off the Worker entirely.                                                                                                                                                                                                                                                                                        |
| 5   | **Recovery codes mandatory at signup; org escrow off by default, opt-in per organization, disclosed to users**                          | Universities will demand recoverability. Silent escrow would make the E2EE claim dishonest.                                                                                                                                                                                                                                                                                                                   |
| 6   | **Self-hosting not committed for v1, but no provider-proprietary APIs in app code**                                                     | Committing now doubles ops work pre-revenue. Cloudflare bindings stay behind a thin adapter interface so the app is portable; only that adapter is rewritten to self-host.                                                                                                                                                                                                                                    |
| 7   | **LaTeX compiles client-side in WASM; server-side compile deferred**                                                                    | Preserves E2EE, costs zero server compute, and sidesteps the `\write18` shell-escape RCE class entirely. See `03-latex-studio.md` §4.                                                                                                                                                                                                                                                                         |
| 8   | **Jobs on `pg_cron` + `pgmq`, dispatched to Vercel routes for outbound HTTP**                                                           | Matches your cost constraint, and gives cross-invocation rate limiting a real atomic primitive. _Reaffirmed in v6_ — Cloudflare Cron Triggers displaced this briefly and are now gone.                                                                                                                                                                                                                        |
| 9   | **Ship Phase 1 to a real lab before building Phase 2**                                                                                  | The highest-leverage decision in the document.                                                                                                                                                                                                                                                                                                                                                                |
| 10  | ~~Host on Cloudflare Workers~~ → **Host on Vercel; files stay on R2; one Cloudflare Worker survives as the collab relay**               | _Superseded in v6 (ADR-019)._ The egress argument was an argument for R2, not for Cloudflare compute — separating them keeps zero-egress files while Vercel's real Node runtime deletes the workerd/Hyperdrive/bundle-size risk class entirely. Pilot cost drops $5 → $0.                                                                                                                                     |
| 11  | **Storage access goes through a thin `StorageAdapter` interface**                                                                       | R2 is S3-compatible, so MinIO, B2, or Supabase Storage are an endpoint swap. Prevents the hosting choice from becoming structural.                                                                                                                                                                                                                                                                            |
| 12  | ~~Supabase Realtime for collaboration~~ → **Durable Objects for CRDT transport; Supabase Realtime keeps Postgres change subscriptions** | _Superseded in v5, reaffirmed and made standalone in v6 (ADR-020)._ Supabase Realtime bills per delivered message per subscriber — awareness traffic burns the 2M free quota in ~6 two-hour sessions. Vercel has no inbound WebSockets, so the DO now deploys as its own Worker hosting nothing else. Because LaTeX is E2EE the relay can only shuffle ciphertext, so it needs no CPU and fits the free tier. |
| 24  | **Contribution tracking is role-shaped, never volume-shaped** _(v6)_                                                                    | Character-level authorship rolled up into a score visible to the person who controls a student's degree is a monitoring system regardless of intent. CRediT roles satisfy the vision's "everyone contributes differently"; percentages don't. Blame gutter stays, author-visible only. See `05-resolution-plan.md` R-07.                                                                                      |
| 25  | **Yjs ops are valid only within a `docEpoch`; all cross-epoch reconciliation is Git's job** _(v6)_                                      | The complete answer to three-writer LaTeX. Yjs guarantees convergence, not correctness; Git guarantees a _visible_ conflict. Give each engine only the job it is sound for. See R-01.                                                                                                                                                                                                                         |
| 13  | **Google Docs replaces the native prose editor; documents leave the E2EE tier**                                                         | Deletes a 5-week build of something Google already does better, and every supervisor already knows the UI. Cost is stated openly in §6 rather than buried. LaTeX stays native and encrypted because Docs cannot host it.                                                                                                                                                                                      |
| 14  | **Provenance lives in a native Claims panel, not inside documents**                                                                     | This is what makes #13 safe. Google Docs has no custom block types, so in-document provenance chips were never possible — moving the claim→evidence graph into Porcupine keeps the differentiator and makes the editor swappable.                                                                                                                                                                             |
| 15  | **`drive.file` scope only, plus the Picker API**                                                                                        | Broad Drive scopes are restricted and trigger Google's CASA security assessment — a recurring five-figure annual audit. Creating files ourselves avoids it and means we cannot see the rest of a user's Drive.                                                                                                                                                                                                |
| 16  | **Source impact from OpenAlex `2yr_mean_citedness` or Scimago SJR, never JIF**                                                          | Journal Impact Factor is Clarivate's proprietary metric and cannot be redistributed. Label the column for what it actually is.                                                                                                                                                                                                                                                                                |
| 17  | **Yjs is the source of truth; Git is a materialized projection of it**                                                                  | Git is discrete and single-author; CRDTs are continuous and interleaved. Making Git authoritative means a merge conflict per keystroke. Same "derived view" pattern as the evidence table and bibliography.                                                                                                                                                                                                   |
| 18  | **Line attribution comes from Yjs client IDs, not `git blame`**                                                                         | Blame attributes a whole line to whoever touched it last. Yjs knows who typed each _character_, always current, no commit needed. Strictly better, and it costs one mapping table.                                                                                                                                                                                                                            |
| 19  | **Git runs client-side (`isomorphic-git`); no server-side repo, no push _to_ Porcupine**                                                | LaTeX sources are E2EE, so the server can never build a commit. Accepting pushes would also create a second write path racing the CRDT. Push to GitHub and clone from there.                                                                                                                                                                                                                                  |
| 20  | **PRs and remote ops go through the GitHub API; only local Git uses `isomorphic-git`**                                                  | A pull request is a GitHub concept, not a Git one — no Git client can create or merge one. Two layers is not redundancy, it's the only way this works.                                                                                                                                                                                                                                                        |
| 21  | **GitHub App, never an OAuth App**                                                                                                      | `repo` scope grants read-write on every repository the user can see. A GitHub App is per-repository, issues 1-hour tokens, and is revocable from GitHub's own settings — the same reasoning that chose `drive.file`.                                                                                                                                                                                          |
| 22  | **A LaTeX project is Private (E2EE) or GitHub-linked (plaintext) — never ambiguous**                                                    | Cleaner than per-action warnings, and it stops the UI making an encryption claim that linking has already voided.                                                                                                                                                                                                                                                                                             |
| 23  | **Never auto-pull; never auto-resolve a `.tex` conflict**                                                                               | A merged PR diverges the repo from the live Yjs doc. Silent reconciliation of a mis-merged equation is worse than a visible conflict marker.                                                                                                                                                                                                                                                                  |

---

## 12. Top risks

| Risk                                                                                         | Severity             | Mitigation                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope explosion — this is four products in a trenchcoat                                      | High                 | The §8 MVP cut is a commitment. Ship at week ~11.                                                                                                                                                                                                                                         |
| Prisma bypassing RLS → silent authz bypass                                                   | Medium _(was High)_  | ADR-002 + R-02: `supabase-js` for user reads; Prisma RLS queries only via `withUserContext()` using `SET LOCAL`, which **Postgres itself reverts at commit**. Unset claim ⇒ NULL predicate ⇒ zero rows, so the failure mode is _fail-closed_. 32-way concurrent pgTAP test as merge gate. |
| ~~Prisma doesn't work cleanly on workerd~~                                                   | **Eliminated (v6)**  | Vercel's Node runtime is real Node. No driver adapter, no `nodejs_compat`, no Hyperdrive.                                                                                                                                                                                                 |
| ~~Worker bundle exceeds 3 MB / 10 MB~~                                                       | **Eliminated (v6)**  | Vercel allows 250 MB uncompressed (5 GB with large functions).                                                                                                                                                                                                                            |
| **Three hosts means three failure domains**                                                  | Medium _(new in v6)_ | Vercel, Cloudflare, and Supabase are three status pages. `CollabTransport` bounds the blast radius of a relay outage to "editing is read-only"; the app degrades rather than dies. Accepted deliberately — see `05-resolution-plan.md` §6.                                                |
| **Vercel Hobby forbids commercial use**                                                      | Medium _(new in v6)_ | Move to Pro _before_ the first paying user, not after. Forces the pricing decision into Phase 0 (R-20).                                                                                                                                                                                   |
| Copyright exposure from publisher PDFs                                                       | High                 | Per-user file copies, OA-verified fetch only, DMCA process, explicit ToS                                                                                                                                                                                                                  |
| **Drive permissions drift from project membership** — a removed member keeps reading the Doc | High                 | Mirror membership → Drive ACLs on every write; nightly reconciliation job; show real Drive permissions in the UI instead of assuming; treat drift as a security finding                                                                                                                   |
| Institution forbids unpublished research in Google Drive                                     | Medium               | Phase 4b confidential mode exists precisely for this. Don't build it until someone asks, but don't pretend the objection won't come.                                                                                                                                                      |
| Google API quotas or a scope policy change breaks the loop                                   | Medium               | Sheets export degrades to CSV/XLSX download; Docs degrades to native Markdown export. Both fallbacks already exist, so the failure is annoying, not fatal.                                                                                                                                |
| Nobody migrates off Zotero/Docs/Overleaf                                                     | High                 | Import day one, export everything always, never hold data hostage                                                                                                                                                                                                                         |
| WASM LaTeX can't compile a real thesis (package gaps)                                        | Medium               | Prototype with an actual thesis in week 1 of Phase 5; server-side fallback is the escape hatch                                                                                                                                                                                            |
| Encrypted collaborative editing is genuinely hard                                            | Medium               | Phase 4, on rich text first; LaTeX is plain text and merges more cleanly                                                                                                                                                                                                                  |
| External API rate limits throttle discovery                                                  | Medium               | Aggressive caching in `Work.raw`, polite-pool headers, queued arXiv access                                                                                                                                                                                                                |
| Supervisor churn from notification fatigue                                                   | Medium               | Digest-first, supervisor-controlled cadence                                                                                                                                                                                                                                               |
| PDF anchor drift across file versions                                                        | Medium               | Quote + offsets + fuzzy fallback; mark anchors `DRIFTED`, never delete                                                                                                                                                                                                                    |

---

## 13. Immediate next actions

1. Accept ADR-001/002/004/005/**019**/**020** (see `adr/README.md`); ADR-003 is closed as "no AI"; ADR-011 and ADR-017 are superseded.
2. Scaffold: Next.js 16 + TS strict + Tailwind/shadcn on **Vercel**, Supabase project, Prisma with `DIRECT_URL` for migrations and the Supavisor transaction pooler for runtime. Node 24 (`.nvmrc`) locally _and_ in production — same runtime both sides, which is the point.
3. Work the **`05-resolution-plan.md` §5 pre-flight checklist**. All seven items land before feature code.
4. **Spike three things in week 1**, because each can invalidate a plan assumption:
   - **The DO relay** (R-21): four browsers, 20 min, p95 < 150 ms, survives a forced restart, rejects forged tickets — this is now the highest-risk unknown, having replaced the workerd spike
   - **The R-01 epoch protocol**, tested with the offline-Alice/PR-Bob script, _before_ any LaTeX UI exists
   - Compile a real 80-page thesis with a WASM TeX engine, served from R2 **with `CORP: cross-origin` set**, under COOP/COEP — this trap survives the host change unchanged
5. Recruit one research group as design partners _now_, before code. Build against their real review protocol.

See `01-data-model.md`, `02-security-and-e2ee.md`, `03-latex-studio.md`, `04-conflicts-and-hazards.md` (what can go wrong), and **`05-resolution-plan.md`** (what we're doing about each one, with acceptance tests). Read `05` first — it supersedes this section's hosting decisions and carries the pre-flight checklist. `06-phase-0-build-plan.md` is the current phase's task list.

**`BUILD-LOG.md` is the record of what actually happened.** One entry per phase, appended when the phase ends: what shipped, measured verification numbers, decisions made at the keyboard, deviations from these plans, and problems hit. Where it contradicts a numbered doc, the numbered doc is stale — fix it and note the fix. A phase is not done until its entry exists.
