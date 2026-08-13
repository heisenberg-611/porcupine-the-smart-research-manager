# Porcupine — Conflicts, Hazards & Verdicts

**v2** · 2026-08-13 · Companion to `00-product-plan.md`

Where two decisions in this plan fight each other, what breaks during the build, and what to do about it. Every entry ends in a **verdict**, because an unresolved conflict written down is just a nicer form of not deciding.

**How to use this:** re-read §1 before starting each phase. Re-read §3 before writing the code it describes. Anything marked 🔴 must be resolved before the phase it belongs to starts — those are the ones that cause rewrites, not bugs.

---

> ## ⚠️ Read this with `05-resolution-plan.md`
>
> **This document states problems. `05-resolution-plan.md` states what we're doing about each one, with acceptance tests.** The v6 hosting change (Cloudflare Workers → Vercel) dissolved several entries below and created two new ones. The prose in §1–§5 is preserved as written so the reasoning stays auditable — **but the dispositions in this table win.**
>
> | ID | Status | Where |
> |---|---|---|
> | C-01 Three writers for LaTeX | **Resolved** — the `docEpoch` protocol (ADR-021) | R-01 |
> | C-02 RLS + pooled connections | **Downgraded 🔴→🟠** — `SET LOCAL` is reverted by Postgres itself, so the failure mode is *fail-closed*. Hyperdrive is gone | R-02 |
> | C-03 Workers free tier 10 ms CPU | **Dissolved** — Vercel Hobby gives 300 s duration, 2 GB, full Node | §0 |
> | C-04 Storage economics | **Resolved** — `FileObject.residency`, OA dedupe, device-only paywalled | R-04 |
> | C-05 Four feedback inboxes | **Resolved** — one `ReviewItem` table; no surface ships without a writer | R-05 |
> | C-06 Two personas | **Resolved** — `capabilities(kind)`; THESIS first, dual extraction → Phase 2b | R-06 |
> | C-07 Contribution surveillance | **Cut, not mitigated** — role-shaped only, no volume anywhere (ADR-022) | R-07 |
> | C-08 Docs → LaTeX | **Resolved** — Google Docs named ranges as the marker; decide in Phase 4 | R-08 |
> | C-09 … C-20 | **Resolved** — see the summary table | R-09…R-20 |
> | **C-21 🔴 No inbound WebSockets on Vercel** | **New.** Resolved — standalone Cloudflare Worker + DO relay (ADR-020) | R-21 |
> | **C-22 🟠 Vercel Hobby forbids commercial use** | **New.** Forces the pricing decision into Phase 0 | R-20 |
> | B-06 Rate-limit coordination | **Better answer now** — Postgres token bucket with `FOR UPDATE`, not per-isolate counters | R-22 |
> | B-08 DO cold start | **Still applies** — the relay survives the host change, so this hazard does too | R-21 |
> | G-01 Notifications · G-07 a11y in CI | **Promoted** — G-01 to a Phase 4 deliverable, G-07 to Phase 0 | R-09…R-20 |
>
> Entries below marked 🔴 that now read as dissolved (**C-03**) or downgraded (**C-02**) are left in place deliberately: the reasoning that produced them was sound for the architecture in force at the time, and the record of *why* a risk went away is worth as much as the record of the risk.

---

## 1. Structural conflicts — idea vs. idea

### C-01 🔴 Three sources of truth for LaTeX content
**Conflict.** Yjs is authoritative (ADR-016). Git is a projection of Yjs. But a GitHub-linked repo has a *second independent writer* — anyone editing on github.com, and every merged PR. Add offline Yjs edits queued in IndexedDB and you have three writers with no common merge algebra. Yjs cannot resolve a conflict that didn't originate in Yjs.

**Why it's real.** The failure case is concrete and will happen in month one: Alice edits `intro.tex` offline on a plane. Bob merges a PR that rewrites the same section. Alice reconnects. Yjs replays her ops onto a document that no longer matches what she branched from — and because CRDTs guarantee convergence, *not* correctness, both edits "succeed" and the result is silent textual garbage. No conflict marker, no error.

**Options.**
1. Block linked-mode editing while behind the remote — safe, infuriating
2. Treat pull as a hard document replacement, discarding un-pushed Yjs state — data loss
3. Materialize a Git commit from Yjs *before* every pull, then do a real three-way merge in Git, then load the result back into a fresh Yjs doc

**Verdict: option 3, and make it the only path.** Pull is: (a) auto-commit current Yjs state, (b) fetch, (c) `isomorphic-git` three-way merge, (d) conflicts to the resolver, (e) rebuild the Yjs doc from the merged tree and broadcast a document swap through the DO. Never replay Yjs ops across a pull boundary. Offline clients that reconnect *after* a pull get the swap, not a merge. Expensive but correct; anything cheaper corrupts manuscripts silently.

---

### C-02 🔴 Prisma + RLS + Hyperdrive want incompatible connection semantics
**Conflict.** ADR-002's RLS-under-Prisma pattern uses `set_config('request.jwt.claims', …, true)` inside a transaction. That is **session-scoped state** and requires the same physical connection for the whole transaction. Hyperdrive pools connections at the edge and does not contract to give you session affinity outside an explicit transaction.

**Why it's real.** If a pooled connection is reused across requests without the claim being reset, one user's queries can execute under **another user's RLS context**. That is not a bug that throws — it silently returns the wrong rows. It is the single most dangerous line item in this document.

**Options.**
1. Wrap every claim-scoped query in an explicit transaction and trust transaction pinning
2. Drop `set_config` and pass `auth.uid()` explicitly as a query parameter to policy-friendly functions
3. Do all user-scoped reads via `supabase-js` (which carries the JWT per request) and reserve Prisma for service-context writes where authorization is enforced in application code

**Verdict: option 3 as the rule, option 1 only where unavoidable, and never option 2.** This is already the shape of ADR-002 — but the Hyperdrive layer makes the "only where unavoidable" part non-negotiable rather than stylistic. **Write a pgTAP test that proves claim leakage cannot occur across pooled connections, and run it under concurrency.** If that test cannot be made to pass, drop Hyperdrive and eat the connection latency.

---

### C-03 🔴 Cloudflare's free tier cannot run this app
**Conflict.** The plan's cost model implies the free tier is a viable starting point. Workers free allows **10 ms CPU per invocation**. Server-rendering a Next.js route, generating a bibliography, or syncing 3,000 sheet rows all exceed that by one to three orders of magnitude.

**Why it's real.** You will deploy, see `Error 1102: Worker exceeded CPU limit` on the first real page render, and lose a day assuming your code is slow. It isn't.

**Verdict: budget the $5/mo Workers Paid plan from day one and stop treating free as an option.** Paid gives 30 s CPU per invocation (5 min max) and 30 M CPU-ms/month. Update the §5.1 cost table to show $5 as the floor, not a growth step. The genuinely free part of this stack is R2 egress, and that remains the win.

---

### C-04 🟠 Copyright rules and storage economics pull opposite ways
**Conflict.** ADR-005 mandates **per-user PDF copies** — no byte-level dedupe across users, for sound legal reasons. R2's free tier is 10 GB.

**Why it's real.** Four collaborators × 300 papers × ~5 MB ≈ **6 GB for a single project**. Two projects exhaust the free tier. Ten labs is ~150 GB (~$2.25/mo — cheap in absolute terms, but it grows linearly with users while revenue does not, because there is no pricing model yet (see G-03)).

**Options.**
1. Dedupe bytes across users — legally hazardous, defeats ADR-005
2. Store only OA-verified PDFs server-side; paywalled files stay in the user's browser cache and are re-fetched from the publisher on demand
3. Per-user storage quota with a paid upgrade

**Verdict: option 2 for paywalled content, option 3 as the commercial answer.** OA PDFs (Unpaywall-verified) are freely redistributable and can be shared across users legitimately — dedupe *those* aggressively, which covers a large share of most corpora. Everything paywalled stays in IndexedDB on the device that fetched it, with the anchor and annotation data (which is yours, small, and the actually valuable part) synced normally. This is legally cleaner *and* cheaper.

---

### C-05 🟠 Feedback lives in four places — the exact problem this product exists to solve
**Conflict.** Supervisor feedback can arrive as: a native `Thread` on an extraction, a Google Drive comment on a Doc, an E2EE `Message`, or a GitHub PR review. Four inboxes.

**Why it's real.** §1 of the plan indicts fragmentation across "Google Docs, WhatsApp, email." Shipping four comment systems recreates it inside one product, and it is the failure most likely to make a supervisor say "just email me."

**Verdict: the review queue is the single mandatory aggregation point, and it is a Phase 4 requirement, not a Phase 6 nicety.** Every feedback surface must write a normalized row into one queue with a source badge and a deep link back. Do not add a fifth surface without deleting one. Specifically: **do not build native `Thread` comments on Documents** — Google owns document comments; Porcupine owns extraction, claim, and LaTeX comments. Clean split, no overlap.

---

### C-06 🟠 Two personas want opposite amounts of rigor
**Conflict.** The Protocol machinery — versioned typed fields, dual extraction, reconciliation, Cohen's κ, PRISMA — is systematic-review shaped. A humanities PhD student reading 40 books wants none of it. Both are named users in §1.

**Why it's real.** Force protocol rigor on a thesis student and they bounce in the first session. Make it optional and the systematic-review team gets a tool with no guardrails, which is the whole reason they'd pay.

**Verdict: `Project.kind` already exists — make it actually branch the UI, not just label it.** `SYSTEMATIC_REVIEW` gets protocol-required, dual-extraction-default, PRISMA visible. `THESIS` gets a single freeform "notes" protocol by default, extraction optional, PRISMA hidden, and a one-click "add structure" upgrade path. Same schema, two products. **Design the THESIS path first** — it is the larger population and the harder UX problem, and the review path is a strict superset of it.

---

### C-07 🟠 Contribution tracking is surveillance in an unequal power relationship
**Conflict.** §8.2 records who typed each character and rolls it into a CRediT score visible to a supervisor who controls the student's degree.

**Why it's real.** This is not a hypothetical discomfort. Character-level authorship plus a supervisory hierarchy is a monitoring system, and students will read it that way whether or not it was intended that way. It also creates perverse incentives — padding character counts, avoiding editing others' text, disputes over who "owns" a paragraph.

**Options.**
1. Ship as designed
2. Attribution visible only to the author; only aggregate CRediT roles visible to others
3. Per-project opt-in

**Verdict: option 2, with option 3 for the raw data.** Blame gutter is always available *to the person reading their own document* — it is genuinely useful for "who do I ask about this equation." But **the CRediT rollup a supervisor sees must be role-shaped, not volume-shaped**: "contributed to Writing — Original Draft," never "wrote 34% of the characters." Never rank members by contribution volume, and never expose a leaderboard. If a project wants raw volume data it opts in, with every member notified. Write this into the product before it ships, not after someone complains.

---

### C-08 🟡 Google Docs prose has no path into the LaTeX manuscript
**Conflict.** Prose is written in Google Docs (ADR-014). Manuscripts are written in LaTeX (Phase 5). A literature review drafted in Docs must eventually become a thesis chapter. Nothing in the plan connects them.

**Verdict: build a one-way "Doc → LaTeX section" import in Phase 5, and be explicit that it is lossy.** Pull the Doc via the API, convert headings/emphasis/lists to LaTeX, convert any Porcupine-inserted citation markers back to `\cite{}` keys (which is why claims pushed to a Doc must carry a machine-readable marker — decide that format in Phase 4, or this becomes impossible later). Tables and images become placeholders. Do **not** attempt round-tripping; it is a tar pit and nobody actually wants to edit a thesis in Docs after it's in LaTeX.

---

### C-09 🟡 Supervisors are modelled as `reviewer` but often hold real authority
**Conflict.** §4 gives supervisors read + comment, no delete, no protocol changes, and immunity from removal by their student. A PI who funds the lab and owns the grant will not accept being unable to manage the project.

**Verdict: separate "my supervisor" from "who runs this project."** Keep `reviewer` as the default for supervisors, but allow a supervisor to *also* hold `admin` when the project is lab-owned rather than student-owned. Drive it off `Project.kind` and org membership: a `THESIS` project defaults the student to `owner` and the supervisor to `reviewer`; a `LAB_PAPER` defaults the PI to `owner`. Make it visible and changeable, never implicit.

---

### C-10 🟡 The exported Sheet will be edited, and the next sync will overwrite it
**Conflict.** "Never make the user re-enter what the system knows" says the Sheet is a derived view. Every human instinct says a spreadsheet is for editing. `ownedColumns` protects columns to the right — it does nothing for someone editing a cell *inside* the synced range.

**Verdict: make the owned range visibly and physically un-editable, and offer a real path back.** Apply Sheets protected-range formatting to owned columns with a warning message, tint them, and freeze the header explaining why. Then add **"import changes from Sheet"** as an explicit, diff-previewed action for the columns that map to editable fields (screening status, tags, assignee). Silent one-way overwrite of someone's afternoon of edits will cost you that user permanently.

---

## 2. Latent contradictions — quieter, slower, still real

### C-11 🟠 Offline caches survive revocation
Removing a member revokes tokens and rotates keys, but their browser still holds a decrypted IndexedDB cache of everything they had. You cannot remotely wipe it. **Verdict:** accept it, state it in the removal dialog verbatim ("they keep any content already synced to their device"), and do not imply otherwise anywhere in the UI. Best-effort mitigation: the app clears its cache on a failed auth refresh, which handles the honest case and none of the dishonest ones.

### C-12 🟠 Safari evicts IndexedDB after 7 days of no interaction
Offline mode, the client-side search index, and the entire Git object store live in IndexedDB. Safari's storage policy clears it for sites without recent engagement. **Verdict:** treat local storage as a *cache, never as storage of record* — every byte must be reconstructible from R2/Postgres. Request persistent storage via `navigator.storage.persist()`, detect eviction on load and re-sync with a visible progress state rather than an empty screen. **Never let un-pushed Git commits exist only in IndexedDB** — push encrypted objects to R2 immediately on commit, not lazily.

### C-13 🟠 Everything wants browser memory at once
libsodium + a 30 MB TeX distribution + the WASM engine + Yjs docs + Git objects + pdf.js render + the Orama search index. On a mid-range tablet this exhausts memory and the tab is killed. **Verdict:** enforce a budget. TeX engine and search index are lazily instantiated and explicitly torn down when their panel closes; PDF pages render windowed; Git operates on a shallow working set, not full history. **Test on a 4 GB Android tablet in Phase 5, not at launch.**

### C-14 🟡 Postgres FTS is configured for English; research is not
`to_tsvector('english', …)` stems incorrectly for every other language and mangles CJK entirely. **Verdict:** store a `language` column on `Work` from provider metadata, use `simple` config as the fallback rather than `english`, and add per-language tsvector columns only if a real user population needs them. Decide in Phase 1 — retrofitting a generated column across a large table is an outage.

### C-15 🟡 Preprint and published version are the same paper and different Works
An arXiv preprint later appears in a journal with a different DOI, different title casing, sometimes different results. Deduping them merges distinct artifacts; not deduping them double-counts the corpus and breaks PRISMA numbers. **Verdict:** model them as **distinct `Work` rows linked by a `versionOf` edge**, surface as one row in the library with a version selector, and count once in PRISMA. OpenAlex already exposes this relationship — use it rather than inferring.

### C-16 🟡 Author name disambiguation is a research problem, not a task
"J. Smith", "John Smith", "Smith, J.A." — cheap heuristics produce embarrassing merges. **Verdict:** do not attempt it. Trust ORCID when present, otherwise store author strings verbatim and never merge. Display duplicates rather than guessing wrong; researchers notice wrong attribution instantly and it destroys credibility.

### C-17 🟡 The GitHub App installation flow will confuse non-developers
A biology PhD student clicking "connect GitHub" lands in an org-permissions screen they cannot parse, and half will grant access to all repositories because it's the default-looking option. **Verdict:** gate the entire feature behind an "Advanced" toggle, pre-flight with a plain-language explanation, and strongly steer toward "only select repositories." Consider not exposing GitHub linking at all for `THESIS` projects unless the user opts in.

---

## 3. Build-time hazards — where implementation actually hurts

| # | Hazard | Bites in | Mitigation |
|---|---|---|---|
| B-01 | **TeX log parsing** is unstructured, engine-specific, and multi-line. Error → file:line mapping is the difference between usable and infuriating | Phase 5 wk 3 | Budget a full week, not two days. Build a corpus of deliberately broken documents as fixtures before writing the parser. |
| B-02 | **PDF anchor drift** when a file is replaced by a different version of the same paper | Phase 1 | Offsets → exact quote → fuzzy match, in that order. Mark `DRIFTED`, never delete. Show the user rather than silently relocating. |
| B-03 | **pgTAP RLS suite gets slow**, people start skipping it | Phase 2+ | Keep it under 90 s. Parallelize by table. It is a merge gate — the moment it's skippable it's worthless. |
| B-04 | **`ProtocolField` migration** when extractions already reference it | Phase 2 | Key immutability is enforced in the DB, not by convention. New version + explicit UI migration. Write the migration path *before* shipping the builder. |
| B-05 | **Yjs document growth** in a long thesis; snapshot/compaction bugs corrupt state | Phase 5 | Never delete superseded updates until the snapshot row is confirmed readable. Test compaction under concurrent edits, and under a client that dies mid-compaction. |
| B-06 | **Rate-limit coordination** across five bibliographic APIs from many Workers | Phase 1 | Central token bucket in Postgres or Durable Object, not per-isolate counters. arXiv's 1-req/3s will be violated by naive concurrency on day one. |
| B-07 | **Timezones** on milestones across international collaborations | Phase 6 | Store UTC, render in the viewer's zone, and make deadline semantics explicit ("due 23:59 in the project's timezone"). Never do date math in local time. |
| B-08 | **Durable Object cold start / restart** mid-edit | Phase 5 | Transparent to Yjs if clients re-sync from `LatexUpdate`. Explicitly test by killing the DO during an active session. |
| B-09 | **SyncTeX mapping** across multi-file projects | Phase 5 | Parse the full file tree in the `.synctex`, not just the root. Test with `\input` three levels deep. |
| B-10 | **Presigned URL leakage** via `Referer`, logs, or analytics | Phase 1 | 5-min TTL, never log the query string, `Referrer-Policy: no-referrer` on pages that hold them. |
| B-11 | **Orphaned R2 objects** from presigned PUTs the client never confirms | Phase 1 | Nightly reconciliation against `FileObject.uploadState`. Without it, storage grows outside every quota. |
| B-12 | **Google/GitHub token refresh** failing silently in background jobs | Phase 4/5 | Surface a "reconnect required" banner in-app. A silently broken sync is worse than a visibly broken one. |

---

## 4. Product & people conflicts

### C-18 🟠 Institutional buyer and individual user are different products
A solo PhD student wants instant signup and no configuration. A university procurement office wants SSO, DPIA, retention policy, self-hosting, and a security questionnaire. Building for one first shapes the product against the other.

**Verdict: build for the individual, sell to the institution later.** Bottom-up adoption is how every successful research tool (Zotero, Overleaf, Notion) actually spread — a lab adopts it, then the department, then procurement follows demand. Keep the org tables in the schema so the enterprise path stays open (already done), but do not let a procurement checklist shape Phase 1.

### C-19 🟠 Migration is half-finished by definition
Nobody moves their whole library at once. Users will run Zotero *and* Porcupine for months, and the two will drift.

**Verdict: assume permanent coexistence rather than migration.** Import must be re-runnable and idempotent (match on DOI, update rather than duplicate). Ship Zotero two-way sync earlier than Phase 6 if early users ask — it is the difference between "another tool" and "my tool."

### C-20 🟡 A tool for "the world's researchers" has no funding model
Nothing in the plan says who pays. Storage and Supabase costs scale linearly with users; nothing scales with revenue.

**Verdict: decide before the pilot, not after.** The defensible shape for this audience: free for individuals within a storage quota, paid per-seat for labs and institutions, self-host license for universities that require it. Academic tools that never decided this either died or got acquired and shut down. Write it into the plan as a section, even if the numbers are placeholders.

---

## 5. Gaps — decisions the plan hasn't made at all

| # | Gap | Why it matters | Suggested default |
|---|---|---|---|
| G-01 | **No notification system design** beyond "digest" | Mentions, assignments, PR reviews, and comments all need routing; email deliverability is its own project | Postgres-backed notification table + one daily digest email via a transactional provider. In-app first, email second. Decide in Phase 4. |
| G-02 | **No data retention or deletion semantics** for project content | GDPR requires it; universities will ask | Soft-delete 30 days → hard delete. Project deletion cascades to R2 objects via a queued job. Deleting a key makes E2EE content unrecoverable — that is a *feature* for deletion compliance. |
| G-03 | **No pricing model** (C-20) | Determines quotas, which determine architecture | Free individual tier with quota; per-seat for labs |
| G-04 | **No onboarding/empty-state design** | A research tool with an empty library is useless on day one; this is where most users quit | First-run: import from Zotero/BibTeX, or run a federated search, or paste 5 DOIs. Never show an empty table with no next action. |
| G-05 | **No conflict story for two people editing the same `Extraction`** | Dual extraction is per-extractor so it's mostly avoided, but reconciliation UI is concurrent | Last-write-wins per field with a visible "changed by X" indicator; reconciliation is single-editor by lock |
| G-06 | **No i18n/l10n plan** | "The world's researchers" implies non-English UI eventually | Externalize strings from Phase 0 (cheap now, expensive later). Do not translate until there is demand. |
| G-07 | **No accessibility testing in CI** | WCAG 2.2 AA is a launch requirement and a procurement gate | `axe-core` in Playwright from Phase 1. Retrofitting a11y at Phase 7 is the classic way to miss it. |

---

## 6. Resolution principles

When a new conflict appears, these are the tie-breakers this plan has already committed to. Apply them rather than re-litigating from scratch.

1. **Correctness over convenience where data is concerned.** A slow correct merge beats a fast silent corruption (C-01).
2. **Derived views are never authoritative.** Evidence tables, bibliographies, PRISMA diagrams, Git history, Sheets. If two things can disagree, one of them is a projection — say which.
3. **Encryption boundaries are stated, never implied.** If content leaves the boundary, the UI says so at that moment and the badge changes (ADR-018's two modes).
4. **Prefer deleting a surface over adding one.** Four comment systems is the failure mode (C-05).
5. **Portability lives behind an interface, not in the choice.** `StorageAdapter`, `CollabTransport`. The vendor decision is then reversible in days.
6. **Every automated inference is visible and reversible.** Dedupe, anchor relocation, relevance ranking. Show the user what was inferred and let them undo it.
7. **Build the harder persona's path first** (C-06). The rigorous workflow is a superset of the loose one; the reverse is not true.

---

## 7. Triage

**Resolve before Phase 0 ends:** C-02 (RLS/Hyperdrive leakage), C-03 (paid tier), G-07 (a11y in CI), C-14 (FTS language).

**Resolve before Phase 1 ends:** C-04 (storage economics), C-06 (persona split — it shapes every screen), C-15/C-16 (dedupe semantics), G-04 (onboarding).

**Resolve before Phase 4:** C-05 (review queue as sole aggregation), C-07 (attribution ethics), C-08 (Doc→LaTeX marker format — decide the marker *now* or lose the ability later), G-01 (notifications), G-02 (retention).

**Resolve before Phase 5:** C-01 (pull/merge algebra — this one is a rewrite if wrong), C-12/C-13 (storage and memory budgets), C-17 (GitHub UX gating).

**Ongoing:** C-11, C-18, C-19, C-20.

---

### The three that will actually hurt — *restated for v6*

The v6 architecture reordered this list. C-02 dropped off it, because `SET LOCAL` gives a Postgres-level guarantee with a fail-closed failure mode; it is now a testable invariant rather than a lurking breach. What replaced it is the one thing the Vercel move broke.

1. **C-01 / R-01** — the Yjs/Git/GitHub merge algebra, now specified as the `docEpoch` protocol (ADR-021). Get it wrong and manuscripts corrupt silently, which is unrecoverable trust damage in an academic tool. **Build and test it before any LaTeX UI exists.**
2. **C-21 / R-21** — the collaboration relay. Real-time editing was a stated requirement and Vercel cannot host it. The standalone Durable Object is the answer, but it is unproven in this codebase and it is now the stack's highest-risk unknown. **Spike it in week 1.**
3. **C-06 / R-06** — if the thesis-student path feels like a systematic-review tool, the larger half of your market never reaches week two, and no amount of later polish recovers that. **Design THESIS first; dual extraction waits for Phase 2b.**

Everything else in this document now has a mechanism and an acceptance test in `05-resolution-plan.md`. These three are the ones where the mechanism is expensive, the test is hard, and being wrong is not recoverable by iteration.
