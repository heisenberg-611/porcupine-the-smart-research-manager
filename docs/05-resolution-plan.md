# Porcupine — Resolution Plan

**v1** · 2026-08-13 · Resolves `04-conflicts-and-hazards.md` · Supersedes the Cloudflare-hosting parts of `00-product-plan.md` §5.1

Every conflict in `04` gets one of three dispositions here: **Dissolved** (the Vercel move removed the conditions that created it), **Resolved** (a concrete mechanism, with an acceptance test that proves it), or **Cut** (the feature that caused it is out of scope, because it wasn't load-bearing for the vision).

Nothing is left at "we should be careful." A conflict without a falsifiable acceptance test is not resolved, it's deferred.

---

## 0. What the Vercel move actually changes

Three of the plan's hardest problems were *artifacts of the host*, not of the product.

| Was | Now | Why |
|---|---|---|
| C-03 🔴 Workers free caps CPU at 10 ms/invocation | **Dissolved** | Vercel Hobby: 300 s max duration, 2 GB / 1 vCPU, full Node.js API coverage, 250 MB bundle |
| Risk 🔴 "Prisma doesn't work cleanly on workerd" | **Dissolved** | Vercel's Node runtime is real Node. Prisma works with no driver adapter, no `nodejs_compat`, no Hyperdrive |
| Risk 🟠 Worker bundle exceeds 3 MB / 10 MB | **Dissolved** | 250 MB uncompressed, 5 GB with large functions |
| C-02 🔴 RLS claim leak across Hyperdrive-pooled connections | **Downgraded to 🟠, and made fail-closed** | Hyperdrive is gone. Supavisor transaction mode + `SET LOCAL` has a *Postgres-level* isolation guarantee — see R-02 |
| — | **New: C-21 🔴 no inbound WebSockets on Vercel** | ADR-017's Durable Object transport has no Vercel equivalent. This is the one thing the move breaks — see R-21 |
| — | **New: C-22 🟠 Vercel Hobby forbids commercial use** | The moment Porcupine charges anyone, Hobby is a ToS violation. This forces the pricing decision (C-20) to be made now rather than "before the pilot" |

**The load-bearing insight:** Cloudflare was chosen because egress is this app's dominant cost. That reasoning was correct and **it still holds — because R2 stays.** PDFs and the ~30 MB TeX distribution move client ↔ R2 directly over presigned URLs and never touch the application host. Vercel therefore serves only HTML, JS, and JSON. The egress argument was never an argument for hosting *compute* on Cloudflare; it was an argument for storing *files* on R2. Splitting those two decisions is what makes this work.

---

## 1. Revised architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ Client — Next.js 15 App Router, React 19, TS strict                │
│  ├─ Crypto worker (libsodium WASM) → messages + LaTeX only         │
│  ├─ PDF reader (pdf.js) + anchoring engine                         │
│  ├─ LaTeX studio: CodeMirror 6 + Yjs + WASM TeX + isomorphic-git   │
│  └─ IndexedDB — CACHE ONLY, never storage of record (R-12)         │
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

**Three hosts, one reason each.** Vercel runs the app because it runs Next.js better than anything else and its Node runtime removes an entire class of risk. R2 holds files because its egress is free and this app is egress-shaped. A single Cloudflare Worker holds the collaboration relay because Vercel cannot hold an open socket and Durable Objects are the correct primitive for a per-document actor. No other Cloudflare surface is used.

---

## 2. Resolutions

*R-numbers track C-numbers. **There is no R-03** — C-03 was dissolved by the hosting change and needs no mechanism (§0).*

### R-21 🔴 Collaboration transport — the one thing Vercel breaks
*Resolves the new C-21. Read this first; it is the only genuinely new problem.*

**The problem.** Vercel Functions do not accept inbound WebSocket connections. Real-time co-editing was an explicit, non-negotiable requirement ("anyone editing in latex will be shown to other ones watching it").

**Options considered.**

| Option | Verdict |
|---|---|
| Supabase Realtime broadcast | **Rejected on arithmetic.** Free tier is 2 M messages/month and *every subscribed client counts per delivered message*. Awareness at 10 Hz with two active typists and four members ≈ 45 delivered msg/s ≈ 324 k messages per two-hour session. That is six sessions per month on free, twenty on Pro. Realtime is priced for change notifications, not for cursors. |
| Liveblocks / hosted Yjs SaaS | **Rejected.** Per-MAU pricing on a product with no revenue model, and it terminates TLS on plaintext CRDT ops — which breaks the E2EE claim for LaTeX unless they support opaque payloads, which is not their product. |
| `y-websocket` on Fly.io / Railway | **Viable fallback.** ~$5/mo always-on container, needs its own ops, monitoring, and scaling story. |
| **Keep the Cloudflare Durable Object as a standalone relay** | **Chosen.** |

**Verdict: keep ADR-017's Durable Object, deployed as a standalone Worker that hosts nothing else.**

This is not a compromise; it is the correct decomposition, and the E2EE requirement is what makes it clean:

- **Because LaTeX sources are E2EE, the DO cannot decrypt Yjs ops anyway.** It was always going to be a dumb relay plus an append-only log of opaque ciphertext. It performs no CRDT merge, no parsing, no rendering.
- Therefore its CPU per message is microseconds, and **the 10 ms free-tier CPU cap that made C-03 fatal for SSR is irrelevant here.** C-03 killed server rendering on Workers. It does not touch a byte-shuffling relay.
- WebSocket Hibernation means idle documents cost nothing. Free tier is 100 k DO requests/day, and **incoming WebSocket messages bill at 20:1** — 100 k billed requests ≈ 2 M incoming messages/day. A pilot will not approach this.

**Mechanism.**
- One Worker, one `LatexDoc` Durable Object class, addressed by `idFromName(latexFileId)`.
- Client authenticates to the DO with a short-TTL (60 s) **relay ticket** — a JWT signed by Vercel after an `is_project_member()` check, containing `{ latexFileId, userId, projectId, docEpoch, exp }`. The DO verifies the signature against a public key in its env and never talks to Supabase itself. The DO has no database credentials.
- Two message classes on one socket: `awareness` (cursors/presence, never persisted, dropped on hibernate) and `update` (encrypted Yjs ops, appended to DO SQLite storage and periodically flushed to `LatexUpdate` in Postgres via a Vercel route the DO calls with a service token).
- Everything behind the existing **`CollabTransport`** interface. Swapping to self-hosted `y-websocket` is an adapter rewrite, not a product rewrite — that is exactly what the interface was for.

**Acceptance test.** Four browsers on one file, 20 minutes of continuous editing, p95 remote-echo latency < 150 ms; kill the DO mid-session and confirm all four resync from `LatexUpdate` with no content loss; confirm the DO rejects a ticket with a wrong `latexFileId`, an expired `exp`, and a forged signature.

---

### R-01 🔴 Three sources of truth for LaTeX — the epoch protocol
*Resolves C-01. This is the one that silently corrupts manuscripts if it's wrong.*

The verdict in `04` was right but under-specified. Here is the complete algebra.

**The core trick: `docEpoch`.** Yjs operations are valid **only within a single epoch**. Every reconciliation across an epoch boundary is done by Git, which has conflict markers, and never by Yjs, which does not. Yjs guarantees convergence, not correctness; Git guarantees a visible conflict. Give each engine only the job it is sound for.

**Schema additions:** `LatexFile.docEpoch Int @default(0)`, `LatexUpdate.docEpoch Int`, and the client's IndexedDB Yjs provider keyed `"<docId>:<docEpoch>"`.

**Pull is a transaction with a frozen document. There is no other path.**

1. Client sends `PULL_BEGIN`. DO transitions the document to `SYNCING` and broadcasts `FREEZE`.
2. All connected editors go **read-only** with a banner. The DO rejects any `update` message while frozen. Because clients are read-only, no ops are generated to buffer — this is why freezing beats queueing.
3. The initiating client materializes the current Yjs state to files and commits to `porcupine/live`. **This commit is the merge base anchor.**
4. `git fetch origin`.
5. Three-way merge of `origin/<branch>` into `porcupine/live` via `isomorphic-git`, base = merge-base.
6. **Clean** → merged tree. **Conflicted** → document enters `CONFLICTED`, stays frozen, conflict hunks go to the resolver UI. Only the initiating client may resolve — single-writer by construction, so there is no concurrent-resolution case to design.
7. Build a **fresh `Y.Doc`** from the merged tree. `docEpoch += 1`.
8. Client uploads the new state as a single snapshot `LatexUpdate` at the new epoch and sends `SWAP { docEpoch, snapshotRef }`.
9. DO drops its log for the old epoch, records the new one, broadcasts `SWAP`, returns to `LIVE`.
10. Clients discard their local `Y.Doc` and load the snapshot. Because the IndexedDB store is epoch-keyed, the old store is orphaned and collected. **A stale op has no reachable path back into the document.**

**The offline client — the case that actually bites.** A client that was disconnected across a swap reconnects presenting `docEpoch = N−1`. The DO refuses its updates. The client then:

- exports its local `Y.Doc` to files,
- creates branch `porcupine/offline/<userId>/<ts>` from the epoch-`N−1` anchor commit,
- commits, and enters the pull protocol from step 4 with that branch as the source.

Their work is **never lost and never silently interleaved.** It becomes a Git branch and goes through a real three-way merge with real conflict markers. This is the entire reason the anchor commit at step 3 exists.

**Invariants to assert in code, not prose:**
- `assert(update.docEpoch === file.docEpoch)` on every DO ingest and every Postgres write.
- Never call `Y.applyUpdate` with an update whose epoch differs from the doc's.
- Never auto-pull (decision #23 stands).

**Acceptance test.** Scripted: Alice edits offline; Bob merges a PR touching the same paragraph; Alice reconnects. Assert (a) no silent interleave, (b) a conflict is surfaced with markers, (c) after resolution both clients converge byte-identically, (d) Alice's offline text is present in the merge result or in an explicitly-discarded hunk she was shown. **This test is a merge gate for all of Phase 5.**

---

### R-02 🟠 RLS under a transaction pooler — fail closed, then prove it
*Resolves C-02, downgraded from 🔴.*

Hyperdrive is gone. The remaining question is Supavisor transaction mode, and it has a better answer than `04` assumed.

**`set_config('request.jwt.claims', …, true)` is `SET LOCAL`. Postgres itself reverts it at commit or rollback.** The isolation guarantee comes from the database, not from the pooler's connection handling. Transaction mode pins a connection for the life of a transaction, and the GUC cannot outlive that transaction. This is sound.

More importantly, **the failure mode is fail-closed.** If the claim is never set, `current_setting('request.jwt.claims', true)` returns NULL, every policy predicate evaluates NULL, and every row is filtered out. You get an empty result, not another user's rows. That is the difference between an outage and a breach.

**Mechanism.**
- **User-scoped reads → `supabase-js`.** PostgREST carries the JWT per request and holds no session state. This is the default path and covers most of the app.
- **Prisma runtime → Supavisor transaction pooler** (`:6543`, `?pgbouncer=true&connection_limit=1`). **Prisma migrations → `DIRECT_URL`** (port 5432); `migrate deploy` issues `SET session_replication_role` and cannot work through the transaction pooler.
- Any RLS-scoped Prisma query goes through exactly one helper:
  ```ts
  withUserContext(jwt, fn)  // $transaction: set_config(..., true) first, then fn
  ```
- `porcupine_app` role: no `BYPASSRLS`. Every table `FORCE ROW LEVEL SECURITY`. Every policy `USING (<claim-derived predicate>)` — **no permissive fallback, no `OR true`, ever.**

**Acceptance tests (pgTAP, merge gate, must stay under 90 s):**
1. `rls_denies_without_claim` — every table returns zero rows with no GUC set.
2. `rls_no_cross_tenant` — N=32 concurrent sessions through the pooler, each asserting it sees only its own rows.
3. `rls_claim_does_not_survive_txn` — set a claim in transaction A, commit; assert transaction B on the same pooled connection sees zero rows.
4. CI: ESLint bans `prisma.` outside `src/server/db/**`; grep fails the build on `set_config` outside the helper.

---

### R-22 🟠 Scheduling and queues without Cron Triggers
*New, caused by the move.*

Vercel Cron on Hobby allows 2 jobs at daily granularity — not enough for polite API polling or reconciliation. Rather than gate the architecture on a plan tier:

**All scheduling moves into Postgres: `pg_cron` for schedules, `pgmq` for queues.** This was decision #8 in the original plan, before Cloudflare displaced it; it returns unchanged. Jobs that need outbound HTTP are dispatched by `pg_cron` calling a Vercel route handler with a service token, which does the fetch with real Node and a 300 s budget.

This also fixes **B-06** more cleanly than the original answer: the cross-worker rate-limit token bucket for arXiv (1 req/3 s) lives in a Postgres table with `SELECT … FOR UPDATE`, which is genuinely atomic across all invocations, rather than in per-isolate counters that were always going to violate the limit.

---

### R-04 🟠 Storage economics
*Resolves C-04.*

`FileObject` gains `residency: R2_SHARED | R2_USER | DEVICE_ONLY`.

- **OA-verified** (Unpaywall confirms a redistributable license) → `R2_SHARED`, deduped by SHA-256 content hash across all users. Legally sound and it collapses the dominant cost.
- **Paywalled** → `DEVICE_ONLY`. Bytes stay in the fetching user's browser. Anchors, highlights, and extractions — the small, valuable, actually-yours part — sync normally. Note the interaction with R-12: IndexedDB is a cache, so a `DEVICE_ONLY` PDF may need re-fetching from the publisher. That is acceptable; the user has institutional access, which is exactly why the file was paywalled to us.
- Per-project storage quota enforced at presign time, with a paid tier above it (R-20).

**Acceptance test.** Simulate 4 users × 300 works with a realistic 45 % OA rate; assert R2 usage is under 2 GB rather than the naive 6 GB.

---

### R-05 🟠 One review queue, and only one
*Resolves C-05.*

A single `ReviewItem` table, normalized, written by every feedback surface: `source: EXTRACTION_THREAD | DRIVE_COMMENT | GITHUB_REVIEW | LATEX_COMMENT | MILESTONE`, plus `deepLink`, `resolvedAt`, `assigneeId`.

**Hard rules:** no feedback surface ships without a `ReviewItem` writer in the same PR. **Native `Thread` comments on `Document` are never built** — Google owns document comments, Porcupine owns extraction, claim, and LaTeX comments. Clean split, no overlap, no fifth inbox.

Moves to **Phase 4**, as a requirement rather than a nicety.

---

### R-06 🟠 Two personas, one schema — build THESIS first
*Resolves C-06.*

`Project.kind` stops being a label and becomes a capability function:

```ts
capabilities(kind) → {
  protocolRequired, dualExtraction, prismaDiagram,
  reconciliation, kappa, githubLinking, ...
}
```

Every screen reads it. `THESIS` gets a freeform notes protocol, optional extraction, no PRISMA, no dual extraction, GitHub off — plus a one-click "add structure" upgrade. `SYSTEMATIC_REVIEW` gets all of it.

**Sequencing is the actual decision:** the THESIS path ships in Phases 1–2. Dual extraction, reconciliation, and Cohen's κ move to **Phase 2b**, after a real thesis student has used the tool. The rigorous path is a strict superset of the loose one, so this ordering costs nothing and de-risks the larger population.

---

### R-07 🟠 Contribution tracking — **cut the surveillance, keep the credit**
*Resolves C-07 by cutting, not mitigating.*

The vision says *"everyone got their role and contribution in a paper in their own way."* **Roles satisfy that. Character counts do not.** So:

**Cut entirely:** any volume metric visible to anyone but its own author. No `ContributionScore`, no percentages, no ranking, no leaderboard, no "wrote 34 % of the characters" anywhere in the product or its exports.

**Keep:** the CRediT ledger, populated from **activity kind, not volume** — did this member commit to `.tex`, run extractions, screen papers, resolve reconciliations? Members self-declare CRediT roles; other members confirm; the system supplies evidence that a role is plausible, never a score. Output is a standard author contribution statement, which is the artifact journals actually want.

**Keep, scoped:** the blame gutter, computed from Yjs client IDs, **visible only in your own editor session**. It answers "who do I ask about this equation," which is genuinely useful, and it is never aggregated, never exported, and never shown to a supervisor.

This removes a whole conflict rather than managing it, and it shortens Phase 6.

---

### R-08 🟡 Docs → LaTeX: decide the marker now
*Resolves C-08. The decision must be made in Phase 4 or the capability is lost forever.*

**Marker format: Google Docs named ranges.** When Porcupine pushes a claim or citation into a Doc, it creates a named range `pcp.cite.<citationKey>` / `pcp.claim.<claimId>` over the inserted text. Named ranges survive user edits, are readable via the Docs API, and are invisible to the writer — strictly better than sentinel text, which users delete or mangle.

Phase 5 then ships a **one-way, explicitly lossy** Doc → LaTeX section import: headings, emphasis, and lists convert; named ranges become `\cite{}`; tables and images become placeholders. **No round-tripping** — it is a tar pit and nobody wants to edit a thesis in Docs once it is in LaTeX.

---

### R-09 → R-20 — the remainder, in brief

| # | Resolves | Resolution | Phase |
|---|---|---|---|
| R-09 | C-09 supervisor authority | `Project.ownershipModel: STUDENT_OWNED \| LAB_OWNED`. Student-owned defaults student `owner` / supervisor `reviewer`; lab-owned defaults PI `owner`. Visible and changeable, never implicit. | 1 |
| R-10 | C-10 Sheet overwrite | Sheets protected-range formatting + tint + frozen explanatory header on owned columns, **plus** an explicit diff-previewed "import changes from Sheet" for the editable-mapped fields (screening status, tags, assignee). | 2 |
| R-11 | C-11 offline caches survive revocation | Accept and **state it verbatim in the removal dialog**: "they keep any content already synced to their device." Clear cache on failed auth refresh. Never imply remote wipe. | 3 |
| R-12 | C-12 IndexedDB eviction | **Invariant: local storage is a cache, never storage of record.** Every byte reconstructible from R2/Postgres. `navigator.storage.persist()`, eviction detected on load with a visible resync. **Git objects push to R2 on commit, never lazily.** | 1 |
| R-13 | C-13 browser memory | Explicit budget: TeX engine and search index lazily instantiated and torn down on panel close; windowed PDF rendering; shallow Git working set. **Test on a 4 GB Android tablet in Phase 5 week 1**, not at launch. | 5 |
| R-14 | C-14 FTS language | `Work.language` from provider metadata; `simple` config as the default, not `english`. Per-language tsvector columns only on real demand. **Decide in Phase 1** — retrofitting a generated column later is an outage. | 1 |
| R-15 | C-15 preprint vs published | Distinct `Work` rows joined by a `versionOf` edge, one library row with a version selector, counted once in PRISMA. Take the relationship from OpenAlex; never infer it. | 1 |
| R-16 | C-16 author disambiguation | **Do not build.** Trust ORCID when present, store strings verbatim otherwise, display duplicates rather than guessing. Wrong attribution destroys credibility instantly. | — |
| R-17 | C-17 GitHub App UX | Advanced toggle, off by default, **not offered at all for `THESIS` projects** unless explicitly enabled. Plain-language pre-flight; steer hard to "only select repositories." | 5 |
| R-18 | C-18 individual vs institution | Build for the individual. Keep org tables in the schema; let no procurement checklist shape Phase 1. **SSO moves out of v1** — it ships when a named institution asks. | — |
| R-19 | C-19 permanent Zotero coexistence | Import is re-runnable and idempotent (match on DOI, update never duplicate). **Two-way sync cut from v1.** | 1 |
| R-20 | C-20 / C-22 pricing | **Now forced, not deferred** — Vercel Hobby is non-commercial-only, so the first paying user requires Pro. Shape: free for individuals within a storage quota; per-seat for labs; self-host license later. Write real numbers before the pilot. | 0 |

**Gaps G-01…G-07** keep the defaults in `04` §5, with two promotions: **G-01 notifications** becomes a Phase 4 deliverable (the supervisor loop is core to the vision and does not work without it), and **G-07 `axe-core` in Playwright** lands in Phase 0, not Phase 1 — it costs an afternoon now and a month later.

---

## 3. What gets cut, and why it doesn't hurt

You asked to keep only what the vision needs. Measured against the original brief — read papers from many sources, synthesize, track progress, structured extraction, differentiated collaboration, supervisors who track and suggest, an Overleaf-grade LaTeX editor with real-time editing and Git/GitHub — here is what is *not* load-bearing:

| Cut | Was | Why it's safe |
|---|---|---|
| **Volume-based contribution analytics** | Phase 6 | Vision asks for *roles and contribution*. CRediT roles deliver that; character counts deliver surveillance (R-07). |
| **Offline mode as a feature** | Phase 7 | IndexedDB is already a cache (R-12). "Works on a plane" is a support burden that collides with C-12 and C-13 and appears in no user story. |
| **Dual extraction, reconciliation, Cohen's κ** | Phase 2 → **2b** | Systematic-review-only. Not cut, resequenced behind real usage (R-06). |
| **Phase 4b confidential mode** | ~4 weeks | Already conditional. Now explicitly outside the v1 number. Build when an institution says the words. |
| **Zotero two-way sync** | Phase 6 | Import is the migration story. Sync is a maintenance treadmill against a moving API. |
| **Author disambiguation** | implied | It's a research problem (R-16). |
| **Native document comments** | implied by `Thread` | Google owns this surface (R-05). |
| **Institutional SSO (SAML/OIDC)** | Phase 7 | Sell to institutions after individuals adopt (R-18). Ships on demand. |
| **Virus scanning** | Phase 7 | Stated as absent. Magic-byte validation, size/page caps, sandboxed pdf.js with scripting off. Never claim scanning that doesn't exist. |
| **Self-hosting** | ADR-010 | Stays behind adapters, uncommitted. |

**Kept despite cost, because the vision names them:** Google Docs + Sheets, real-time LaTeX co-editing, client-side Git, GitHub push/pull/PR, E2EE for messages and manuscripts, the extraction protocol pipeline, supervisor review.

**Revised timeline: ~34 weeks** (from 38). **MVP is unchanged at ~11 weeks** — Phase 0 loses a week to the dissolved workerd spike, Phase 2 loses one to R-06's resequencing, Phase 6 and 7 lose one each to R-07 and the cuts above.

---

## 4. Cost model

| Line | Pilot (non-commercial) | First paying user |
|---|---|---|
| Vercel | **$0** Hobby — 300 s functions, 2 GB, full Node | **$20/mo** Pro (Hobby forbids commercial use) |
| Cloudflare Worker + DO relay | **$0** — 100 k DO req/day, WS billed 20:1, hibernation free | $0–5/mo |
| R2 storage | **$0** — 10 GB free, ~2 GB used with OA dedupe (R-04) | $0.015/GB-mo |
| R2 egress | **$0** | **$0** |
| Supabase | **$0** — 500 MB DB | **$25/mo** Pro |
| **Total** | **$0/mo** | **~$45/mo** |

Better than the Cloudflare-only plan on every axis: the floor drops from $5 to $0, the highest-severity technical risk (Prisma on workerd) disappears, and R2's zero egress — the actual reason Cloudflare was chosen — is fully retained.

---

## 5. Pre-flight — must be true before Phase 0 ends

1. ☐ **R-02** pgTAP suite green, including the 32-way concurrency test, running as a merge gate in under 90 s.
2. ☐ **R-21** DO relay spike: four browsers, 20 min, p95 < 150 ms, survives a forced DO restart, rejects forged tickets.
3. ☐ **R-14** `Work.language` column and `simple` FTS config in the baseline migration.
4. ☐ **G-07** `axe-core` in Playwright, failing CI on violations.
5. ☐ **R-20** pricing numbers written down, even if provisional.
6. ☐ **R-08** the Docs named-range marker format specified (it is unrecoverable later).
7. ☐ Identity keypairs generated at signup, unused, so Phase 3 needs no re-enrollment.

**Then, and only then, three week-one spikes:**
- OpenAlex + Crossref + arXiv federated search with dedupe and the Postgres token bucket (R-22)
- A real 80-page thesis compiled by the WASM TeX engine, served from R2 **with `CORP: cross-origin`** under COOP/COEP — this trap survives the host change unchanged
- The R-01 epoch protocol, tested with the offline-Alice/PR-Bob script, before any LaTeX UI is written

---

## 6. What still keeps me up at night

Honest residual risk, after all of the above:

1. **R-01's epoch protocol is correct but expensive to build.** It is roughly two of Phase 5's nine weeks and it has no shortcut. If Phase 5 runs late, cut GitHub *pull* before you cut the protocol — push-and-PR-only is a coherent product; a half-implemented merge is a corruption bug.
2. **The three-host split has three failure domains.** Vercel down, Cloudflare down, or Supabase down are three different incidents with three different status pages. `CollabTransport` limits the blast radius of the third-party one, but operationally this is more surface than a single host.
3. **C-22 is a deadline, not a decision.** The day someone pays you, Hobby is a ToS violation. Move to Pro *before* that day, not after.
4. **R-04's OA dedupe rate is an assumption.** 45 % is plausible for biomedical corpora and optimistic for humanities. Measure it in Phase 1 against a real project's library before trusting the cost model.
