# Porcupine — Research & Thesis Management Platform
## Master Execution Plan

**Status:** v3 · **Date:** 2026-08-10 · **Owner:** Dhrubojyoti

> **v2** — E2EE narrowed to messages + documents. AI dropped. Public bibliographic APIs as the discovery layer. LaTeX studio added. Open decisions resolved in §11.
> **v3** — Hosting moved to Cloudflare Workers + R2 (ADR-011). File storage moved from Supabase Storage to R2 with Worker-mediated authorization. Job split across Cron Triggers/Queues and `pg_cron`. Cost model added (§5.1).

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

| | |
|---|---|
| **Is** | A collaborative research pipeline: discover → screen → extract → synthesize → **write** → export |
| **Is not** | A reference manager (integrate Zotero, don't replace it), a PDF library, an AI writing tool |

**Comparables and the gap:** Zotero (great library, no pipeline or collaboration depth). Covidence/Rayyan (great screening, closed, expensive, no synthesis or writing). Overleaf (great LaTeX, zero connection to your corpus). Notion/Obsidian (great docs, no research primitives).

Nobody joins *screening → extraction → provenance-linked synthesis → LaTeX writing → supervision → credit* into one loop. The single sharpest wedge: **your `.bib` file and your `\cite{}` autocomplete come from your own screened corpus, automatically.** Overleaf structurally cannot do that.

**Design principle:** never make the user re-enter what the system already knows. Evidence tables are *generated* from extractions. The PRISMA diagram is *derived* from screening decisions. The bibliography is *derived* from the library. The contribution statement is *derived* from the activity ledger.

---

## 3. Core domain concepts

- **Work** — a canonical scholarly artifact (DOI/arXiv/OpenAlex ID). Global, deduplicated, public metadata.
- **Project** — a thesis, review, or lab paper. The unit of membership, permissions, and encryption.
- **Question** — a research question or sub-question. Works and Claims link to Questions; this is the anti-drift mechanism.
- **ProjectWork** — a Work admitted to a Project: screening decision, reading status, assignee, priority, tags.
- **Protocol** — the project's extraction schema: ordered typed Fields. Versioned. This *is* "the pipeline."
- **Extraction** — one person's filled Protocol for one ProjectWork. Multiple per work expected; disagreement is a first-class state.
- **Anchor** — precise location in a document: page + quote + offsets + fuzzy fallback.
- **Annotation** — highlight or margin note bound to an Anchor.
- **Claim** — a synthesized statement linked to its supporting Extractions/Annotations. The provenance edge.
- **Document** — collaborative rich text (E2EE).
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

**Supervisor added after project creation** triggers an explicit prompt: *"Grant access to work created before they joined? (All history / From now on)."* For plaintext data this is a policy flag on the membership row; for E2EE content it determines whether prior key epochs are re-wrapped to them. Default is **All history** — the common case is a supervisor joining a thesis already in progress, and defaulting to a partial view creates confusing empty screens.

Supervisors get a **review queue** with a per-supervisor digest cadence, not a notification firehose. This is the single most important UX decision for faculty retention.

An `Organization` layer (SSO, seats, retention) sits above projects. Not in MVP, but the tables exist from day one — retrofitting a tenant column is miserable.

---

## 5. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Client — Next.js 15 App Router, React 19, TS strict              │
│  ├─ Crypto worker (libsodium WASM) → messages + documents only    │
│  ├─ PDF reader (pdf.js) + anchoring engine                        │
│  ├─ LaTeX studio: CodeMirror 6 + Yjs + WASM TeX engine            │
│  └─ IndexedDB: doc/message cache + local search index (E2EE only) │
└───┬──────────────────┬──────────────────┬───────────────────┬────┘
    │ supabase-js      │ SSR / Server     │ presigned GET/PUT │ WS
    │ (RLS) + Realtime │ Actions          │ (range requests)  │
    │                  ▼                  ▼                   │
    │      ┌────────────────────┐  ┌──────────────┐          │
    │      │ Cloudflare Workers │  │  R2 buckets  │          │
    │      │ Next.js @ OpenNext │  │ papers ·     │          │
    │      │ · auth-checked     │─▶│ tex-dist ·   │          │
    │      │   file authz       │  │ latex-assets │          │
    │      │ · API + BFF        │  │ (zero egress)│          │
    │      │ · Cron + Queues    │  └──────────────┘          │
    │      └─────────┬──────────┘                            │
    │                │ Hyperdrive (edge pooling)             │
┌───▼────────────────▼───────────────────────────────────────▼─────┐
│ Supabase — Postgres · Auth · Realtime                             │
│ RLS deny-by-default on every table · tsvector FTS on plaintext     │
└───────────────────────────────────────────────────────────────────┘
```

**Why this shape.** Compute is unusually light — crypto runs in the browser, LaTeX compiles in the browser, uploads go client→R2 directly, and Postgres does the aggregation. What the app is actually heavy on is **egress**: a ~30 MB TeX distribution per new device plus every PDF a researcher opens. Cloudflare bills no egress and R2 charges none, so the dominant cost line goes to zero. Everything else fits in free or $5/mo tiers.

### Stack

| Layer | Choice | Note |
|---|---|---|
| Framework | Next.js 15 App Router, React 19, TS `strict` | |
| DB | Supabase Postgres | |
| Schema | Prisma (migrations + trusted server writes) | RLS boundary in ADR-002 |
| Client reads | `supabase-js` with RLS + Realtime | RLS is the real authz layer |
| Auth | Supabase Auth — email OTP, Google; SAML/OIDC in Phase 7 | ORCID as a linked identity, not a login provider |
| UI | Tailwind + shadcn/ui (Radix) | Radix gives WCAG keyboard/focus semantics for free |
| Server state | TanStack Query | |
| Tables | TanStack Table + Virtual | evidence tables reach 10k+ rows |
| Rich text | Tiptap (ProseMirror) + Yjs | own comment layer; Tiptap Pro's isn't E2EE-compatible |
| LaTeX | CodeMirror 6 + Yjs + WASM engine | see `03-latex-studio.md` |
| PDF | pdf.js, JS disabled, sandboxed | |
| Files | **Cloudflare R2** (S3-compatible), private buckets, presigned URLs | zero egress; Prisma stores metadata rows only |
| Crypto | libsodium-wrappers-sumo in a Web Worker | XChaCha20-Poly1305 + X25519 sealed boxes |
| Search | Postgres `tsvector` + GIN (plaintext tiers) · Orama in IndexedDB (E2EE tiers) | |
| Jobs | Cloudflare Cron Triggers + Queues (outbound fetch) · `pg_cron` (pure SQL) | split by workload — see §5.1 |
| DB access from Workers | **Cloudflare Hyperdrive** → Supabase pooler, Prisma driver adapter | workerd is not Node — Phase 0 spike, see §12 |
| Hosting | **Cloudflare Workers** (Next.js via OpenNext) + R2 + Supabase | ADR-011; still no proprietary APIs in app code |
| Testing | Vitest, Playwright, **pgTAP for RLS** | untested RLS is not security |
| Observability | Sentry + PostHog | |

### 5.1 Cloudflare specifics (ADR-011)

**R2 buckets.** Four, all private, no public bucket exists:

| Bucket | Contents | Access |
|---|---|---|
| `papers` | per-user PDF copies | presigned GET, 5-min TTL, issued only after a membership check |
| `tex-dist` | TeX Live subset + CTAN package mirror | public-readable via Worker, immutable, cached forever |
| `latex-assets` | images and binaries inside LaTeX projects | presigned, per-project |
| `build-output` | compiled PDFs (encrypted) | presigned, per-project |

**File authorization replaces Supabase Storage RLS.** R2 has no row-level security, so the check moves into a Worker route: validate the JWT → confirm `is_project_member` → issue a short-TTL presigned URL. Uploads are presigned `PUT` straight to R2, so file bytes never pass through the Worker. Presigned URLs support HTTP range requests natively, which is what keeps pdf.js progressive rendering working.

**The COEP/CORP trap — this will cost you a day if you don't know it.** `SharedArrayBuffer` needs `Cross-Origin-Embedder-Policy: require-corp`, which in turn means *every* cross-origin resource must send `Cross-Origin-Resource-Policy: cross-origin`. The crypto worker and the WASM TeX engine both want `SharedArrayBuffer`, and the TeX packages come from R2 — a different origin. **Set `CORP: cross-origin` on all `tex-dist` objects at upload time**, or the TeX engine silently fails to load its packages under COEP.

**Job split.** Cron Triggers invoke Workers for anything doing outbound HTTP — federated API polling, OA resolution, saved-search alerts — because Workers handle fetch concurrency far better than Postgres and keep long external calls off the DB. Queues carry retry and dead-letter semantics. `pg_cron` keeps only pure-SQL maintenance (materialized view refresh, partition rotation), which also keeps that logic portable.

**Two capabilities that change with this host:**
- **Virus scanning is deferred.** ClamAV needs a long-running process and there is nowhere to put one. v1 mitigation: magic-byte type validation, size and page caps, and pdf.js with scripting disabled in a sandboxed context — the actual exploitation path is narrow. If AV becomes a requirement (an institution will eventually ask), run it as a queue consumer on a cheap VPS rather than reworking the host. Tracked in Phase 7.
- **`next/image` optimization** needs a custom loader — Vercel's built-in one doesn't exist here. Barely matters: this app has avatars and little else.

**Cost model.**

| | Free | At $5/mo Workers Paid |
|---|---|---|
| Requests | 100k/day | 10M/mo + 30M CPU-ms |
| Egress | unmetered | unmetered |
| R2 storage | 10 GB | $0.015/GB-mo beyond |
| R2 egress | **$0** | **$0** |
| Supabase | 500 MB DB, 2 GB transfer | $25/mo Pro when outgrown |

Realistic v1 pilot: **$5/mo**, and the first thing to outgrow its tier is Supabase Postgres, not Cloudflare.

### Bibliographic APIs (the discovery layer — all free)

| Source | Use | Limits |
|---|---|---|
| **OpenAlex** | Primary. Full metadata, citation graph, concepts, no API key | polite pool via `mailto=`, 100k/day |
| **Crossref** | DOI truth, publisher metadata | polite pool via `mailto=` |
| **arXiv** | Preprints + direct PDFs | 1 req / 3s — queue it |
| **Semantic Scholar** | TLDRs, influential-citation counts | free key, 1 rps |
| **Europe PMC / PubMed** | Biomedical | generous |
| **Unpaywall** | Legal OA PDF resolution | `email=` required |
| **DOAJ / CORE** | OA full text | |
| **Zotero API** | Import, later two-way sync | |

**Federated search:** one query fans out to the enabled providers, results are deduplicated (DOI → arXiv ID → normalized title+year), merged, and ranked. Cache every provider response in `Work.raw` — you should hit a provider once per work, ever.

**Saved searches with alerts** replace the AI discovery feature at zero marginal cost: a stored query runs weekly via `pg_cron`, diffs against known works, and adds new hits to a "suggested" tray in the project. This is high-value and costs nothing but a worker.

> **Legal constraint, non-negotiable:** never redistribute a paywalled PDF between users. Deduplicate *metadata and annotations* across users; never the file bytes. Server-side fetch only from Unpaywall-verified OA. Enforce in code, state in ToS.

---

## 6. Encryption scope (confirmed — detail in `02-security-and-e2ee.md`)

| Tier | Contents | Protection |
|---|---|---|
| **Public** | `Work` metadata, project/org names, member display names | None needed |
| **Server-confidential** | Membership, roles, screening/reading status, annotations, extraction values, questions, claims, tasks, activity | RLS + at-rest disk encryption. Server can read → **server-side search, sorting, filtering, and aggregation all work.** |
| **End-to-end encrypted** | Messages (channels + DMs), Documents, LaTeX sources, and comments on both | XChaCha20-Poly1305 under per-project keys wrapped to each member. Server stores ciphertext only. |

This is a much better trade than full E2EE. The two genuinely private things — private conversation and unpublished draft text — are protected, while the machinery that makes the product *work* (a 300×20 evidence table you can sort and filter server-side, full-text search across your annotations, progress dashboards) stays fast and simple.

Consequences accepted: the server can read annotations and extraction values. Say so plainly — the honest claim is *"your conversations and your drafts are end-to-end encrypted; your library and extractions are encrypted at rest and access-controlled."* Never say "fully end-to-end encrypted."

**Generate every user's identity keypair at signup starting in Phase 0**, even though nothing is encrypted until Phase 3. Public keys for early users must already exist when the crypto features land, or you'll need a painful re-enrollment.

---

## 7. Roadmap

### Phase 0 — Foundations (3 weeks)
Repo, CI, TS strict, Prisma + Supabase with `DIRECT_URL` for migrations, restricted DB role, deny-by-default RLS baseline, pgTAP harness, design tokens + component scaffold, ADRs accepted, threat model.
Ship signup that **generates and stores identity public keys** — nothing uses them yet.
**Exit:** create a project, invite a member, and nothing else — but every table has a tested RLS policy.

### Phase 1 — Discovery, corpus & reading (6 weeks) — *smallest useful slice*
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

### Phase 2 — Extraction pipeline (5 weeks) — *the differentiator*
- Protocol builder: typed fields, ordering, help text, required flags, versioning with migration prompts
- Starter templates: PICO/RCT, qualitative, ML-benchmark, engineering-systems
- Extraction form beside the PDF; quote fields capture an Anchor on highlight
- **Dual extraction + reconciliation:** two independent extractors, diff view, verifier resolves, Cohen's κ reported
- Evidence Table generated from Protocol × Extractions: group, pivot, filter, export CSV/XLSX
- Cell → source: any cell opens the PDF at its exact anchor
- **PRISMA 2020 flow diagram**, auto-derived from screening decisions

**Exit:** inconsistent evidence tables become structurally impossible.

### Phase 3 — Crypto envelope + Messaging (4 weeks)
Messages are the ideal first encrypted surface: append-only, no merge semantics, immediate user value.
- Key hierarchy: Argon2id KEK → Master Key → identity keys → per-project key, wrapped per member, epoch-based
- Recovery codes, device registration, key fingerprint (safety number) display
- Project channels, threads, DMs, mentions, read receipts, presence — all E2EE
- Member removal → key rotation; new-member provisioning flow
- Client-side search index over messages

### Phase 4 — Documents & synthesis (5 weeks)
- Collaborative rich text: Tiptap + Yjs, encrypted updates over Supabase Realtime, presence, client-elected compaction
- **Claims:** select text → link supporting extractions/annotations → renders with a provenance chip
- Provenance panel: every supporting quote; flags claims whose support was edited or whose source was later excluded
- Comments and tracked-change suggestions, anchored to blocks *and* extraction fields
- Question coverage view: which works and claims address each research question
- Export: Markdown, DOCX, PDF

### Phase 5 — LaTeX studio (5 weeks) — *see `03-latex-studio.md`*
- CodeMirror 6 multi-file editor, LaTeX syntax highlighting, folding, outline
- Non-AI completion: TeX command database, environments, packages, snippets, math palette
- **`\cite{}` autocomplete from the project corpus; `references.bib` auto-generated and kept in sync**
- `\ref{}` / `\label{}` resolution across files, undefined-reference linting
- Client-side WASM compilation → PDF preview with SyncTeX forward/inverse search
- Real-time collaborative editing (Yjs + `y-codemirror.next`), E2EE
- Journal and university thesis templates; export to PDF, source zip, Overleaf, GitHub

### Phase 6 — Supervision & credit (4 weeks)
- Supervisor onboarding, multi-project dashboard, review queue with per-supervisor digest cadence
- Milestones tied to real dates (proposal, committee, defense) with risk flags when velocity won't meet them
- Suggestion workflow with accept/reject and a visible response obligation
- **Contribution ledger** → CRediT-mapped profile per member, exportable as an author contribution statement
- Activity feed and full audit log

### Phase 7 — Hardening & scale (4 weeks)
Institutional SSO (SAML/OIDC), org admin console, WCAG 2.2 AA audit and remediation, offline mode, mobile reading/annotation polish, performance budgets, **external penetration test**, data export and account deletion, DPIA.

**Total to v1.0: ~36 weeks** for 2–3 engineers. Solo: roughly double — in which case cut Phase 5 to editor + preview only and defer collaborative LaTeX.

---

## 8. MVP cut — build exactly this

Target story: *a supervisor and three master's students run a 300-paper systematic review over one semester.*

**In:** auth, project + members + roles, federated search + import, library with screening pipeline and assignment, PDF reader with highlights and notes, Protocol builder (text/number/enum/quote), extraction form, evidence table with CSV export, comments on extraction fields, supervisor read+comment role, activity feed.

**Out of MVP:** everything encrypted, documents, LaTeX, PRISMA, offline, contribution analytics, SSO, Zotero two-way sync, citation graph.

If you build any of the "out" list before the "in" list is in a real lab's hands, this takes two years and misses what researchers actually need.

---

## 9. What replaces the AI features

Dropping AI costs less than it appears. Each intended capability has a deterministic substitute:

| Dropped AI feature | Replacement | Cost |
|---|---|---|
| AI-suggested extraction | Protocol templates + quote-capture-on-highlight + keyboard-driven form | Zero |
| Relevance ranking of the screening queue | Rank by citation count, recency, venue, and **keyword hits from the project's Questions**; plus TF-IDF similarity to already-included works (computed in Postgres) | Zero |
| Related-work discovery | OpenAlex citation graph: forward/backward snowballing from included works, scored by co-citation | Zero |
| Chat-with-your-PDF | Full-text search across the corpus with anchor-linked results | Zero |
| Duplicate/contradiction detection | Exact + trigram similarity across extraction values in Postgres | Zero |
| Writing suggestions | Deterministic LaTeX completion from command DB, project bib, and labels | Zero |

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
8. **Reading velocity → milestone risk.** *"At this pace you finish screening 3 weeks after your proposal deadline"* is the sentence that earns trust.
9. **Accessibility as a launch requirement.** Public universities in the EU, US, and India have procurement rules that disqualify you outright otherwise.
10. **Quote integrity.** Every stored quote keeps its anchor; pasting it into a document brings attribution along. Cheap, and it prevents the accidental-plagiarism failure that terrifies supervisors.

Still not recommended: a social/discovery network (different product, needs network effects you won't have), and writing your own citation-style engine (use CSL via `citeproc-js`).

---

## 11. Decisions taken

You asked me to decide the open items. These are now the plan; override any you disagree with.

| # | Decision | Reasoning |
|---|---|---|
| 1 | **E2EE covers messages, documents, and LaTeX sources only** | Protects the two genuinely private assets while keeping search, sorting, and aggregation server-side. Roughly halves crypto complexity. |
| 2 | **No AI in v1; inert schema hooks retained** | Your call on cost. Every dropped capability has a zero-cost deterministic substitute (§9). |
| 3 | **Supervisor history access is prompted at add time; default = All history** | Your call. Default chosen because supervisors usually join mid-thesis, and a partial view produces confusing empty screens. |
| 4 | **Files → Cloudflare R2, never Postgres** | Range requests, presigned URLs, and **zero egress**. Direct client→R2 uploads keep file bytes off the Worker entirely. |
| 5 | **Recovery codes mandatory at signup; org escrow off by default, opt-in per organization, disclosed to users** | Universities will demand recoverability. Silent escrow would make the E2EE claim dishonest. |
| 6 | **Self-hosting not committed for v1, but no provider-proprietary APIs in app code** | Committing now doubles ops work pre-revenue. Cloudflare bindings stay behind a thin adapter interface so the app is portable; only that adapter is rewritten to self-host. |
| 7 | **LaTeX compiles client-side in WASM; server-side compile deferred** | Preserves E2EE, costs zero server compute, and sidesteps the `\write18` shell-escape RCE class entirely. See `03-latex-studio.md` §4. |
| 8 | **Jobs on Supabase Edge Functions + `pgmq`/`pg_cron`, not a paid queue** | Matches your cost constraint; migrate to Trigger.dev only if it outgrows this. |
| 9 | **Ship Phase 1 to a real lab before building Phase 2** | The highest-leverage decision in the document. |
| 10 | **Host on Cloudflare Workers + R2, Postgres stays on Supabase** | Egress is this app's dominant cost and Cloudflare doesn't bill it. Compute is light because crypto and TeX run client-side. ~$5/mo at pilot scale. |
| 11 | **Storage access goes through a thin `StorageAdapter` interface** | R2 is S3-compatible, so MinIO, B2, or Supabase Storage are an endpoint swap. Prevents the hosting choice from becoming structural. |
| 12 | **Supabase Realtime for collaboration in v1; Durable Objects evaluated in Phase 4** | Realtime is portable and adequate. DO with WebSocket hibernation is a better CRDT relay but is hard Cloudflare lock-in — earn that trade with real load data, don't assume it. |

---

## 12. Top risks

| Risk | Severity | Mitigation |
|---|---|---|
| Scope explosion — this is four products in a trenchcoat | High | The §8 MVP cut is a commitment. Ship at week ~11. |
| Prisma bypassing RLS → silent authz bypass | High | ADR-002: restricted role + `FORCE ROW LEVEL SECURITY` + pgTAP as a merge gate |
| **Prisma doesn't work cleanly on workerd** (not Node; needs driver adapter + `nodejs_compat` + Hyperdrive) | High | **Phase 0 week-1 spike.** Fallbacks in order: Hyperdrive + `@prisma/adapter-pg`; then Prisma Accelerate; then drop Prisma at runtime and keep it for migrations only, querying via `postgres.js` + `supabase-js`. Schema and RLS work is unaffected either way. |
| Worker bundle exceeds the size limit (3 MB free / 10 MB paid, compressed) | Medium | Keep libsodium and pdf.js client-side only; audit bundle in CI; `$5/mo` paid plan raises the ceiling |
| Copyright exposure from publisher PDFs | High | Per-user file copies, OA-verified fetch only, DMCA process, explicit ToS |
| Nobody migrates off Zotero/Docs/Overleaf | High | Import day one, export everything always, never hold data hostage |
| WASM LaTeX can't compile a real thesis (package gaps) | Medium | Prototype with an actual thesis in week 1 of Phase 5; server-side fallback is the escape hatch |
| Encrypted collaborative editing is genuinely hard | Medium | Phase 4, on rich text first; LaTeX is plain text and merges more cleanly |
| External API rate limits throttle discovery | Medium | Aggressive caching in `Work.raw`, polite-pool headers, queued arXiv access |
| Supervisor churn from notification fatigue | Medium | Digest-first, supervisor-controlled cadence |
| PDF anchor drift across file versions | Medium | Quote + offsets + fuzzy fallback; mark anchors `DRIFTED`, never delete |

---

## 13. Immediate next actions

1. Accept ADR-001/002/004/005/011 (see `adr/README.md`); ADR-003 is closed as "no AI."
2. Scaffold: Next.js 15 + TS strict + Tailwind/shadcn, `@opennextjs/cloudflare`, Wrangler, Supabase project, Prisma with `DIRECT_URL`. Local dev on Node 24 (`.nvmrc`), but verify against `wrangler dev` — Node and workerd differ, and only workerd is the deploy target.
3. Land the Phase 0 RLS baseline with pgTAP in CI **before** any feature code.
4. **Spike three things in week 1**, because each can invalidate a plan assumption:
   - **Prisma on workerd via Hyperdrive** — the highest-risk unknown; fallbacks in §12
   - OpenAlex + Crossref + arXiv federated search with dedupe
   - Compile a real 80-page thesis with a WASM TeX engine, served from R2 **with `CORP: cross-origin` set**, under COOP/COEP
5. Recruit one research group as design partners *now*, before code. Build against their real review protocol.

See `01-data-model.md`, `02-security-and-e2ee.md`, `03-latex-studio.md`.
