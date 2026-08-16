# Porcupine — LaTeX Studio (Phase 5)

An integrated LaTeX environment, Overleaf-class in feel, with one thing Overleaf structurally cannot do: **your bibliography and `\cite{}` autocomplete come from your own screened corpus, automatically.**

---

## 1. Why build this rather than link to Overleaf

Overleaf is where the writing happens, and it is completely disconnected from where the reading happened. Every researcher does the same manual dance: export a `.bib` from Zotero, upload it, remember the citation keys, re-export when the library changes, discover mid-draft that a paper was later excluded from the review.

If the corpus and the manuscript live in one system, all of that disappears:

- `references.bib` is regenerated from `v_project_bib` on every change to the library
- `\cite{` autocompletes against screened works, showing title, authors, and year
- Citing a work that was later **excluded** during screening raises a lint warning
- Hovering a `\cite{}` shows the paper's extractions and your own highlights
- A `\cite{}` inserted from a Claim carries its provenance link

That loop is the reason to build this rather than deep-link out.

---

## 2. Editor

**CodeMirror 6** (not Monaco — CM6 is ~10× smaller, better on mobile/tablet, and has first-class Yjs bindings).

**Syntax highlighting.** Start with `@codemirror/legacy-modes/mode/stex` — a stream parser that gives solid, low-effort highlighting for commands, math mode, environments, and comments. Upgrade to a Lezer LaTeX grammar in a later iteration when you want structural features (reliable folding, an accurate document outline, environment-aware selection). Don't block Phase 5 on the grammar.

**Editing features:**

- Multi-file tree; open tabs; split view
- Fold sections and environments; document outline from `\section`/`\subsection`
- Bracket and `$…$` matching; auto-close `{}`, `[]`, `$$`, `\begin{}`→`\end{}`
- Search/replace with regex across all files
- Vim and Emacs keymaps (researchers care about this more than you'd expect)
- Word count excluding markup; spell check via the browser dictionary plus a user word list
- Mobile/tablet: a math and command toolbar row above the keyboard — typing `\` on a touch keyboard is miserable otherwise

---

## 3. Suggestions without AI

Every completion source below is deterministic, local, and free. Combined, they cover the great majority of what an AI assistant would have offered for LaTeX.

| Source                                   | Behaviour                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Command database**                     | ~2,000 TeX/LaTeX commands with signatures and one-line docs, bundled as a static JSON (derived from CTAN package docs). Typing `\fra` → `\frac{}{}` with argument placeholders. |
| **Environments**                         | `\begin{` → known environments, filtered by loaded packages; auto-inserts the matching `\end{}`.                                                                                |
| **`\cite{}`**                            | **Reads the project corpus.** Fuzzy match on author, title, year, venue. Renders as a rich list, not bare keys. Warns on excluded works.                                        |
| **`\ref{}` / `\eqref{}` / `\autoref{}`** | Every `\label{}` across all files in the project, with the section or equation text as context.                                                                                 |
| **Packages**                             | `\usepackage{` → package names available in the bundled TeX distribution, with descriptions.                                                                                    |
| **Snippets**                             | User- and project-level, tab-stop aware: figure, table, algorithm, theorem, custom.                                                                                             |
| **Math palette**                         | Searchable symbol picker mapping "integral", "∈", "sum" → `\int`, `\in`, `\sum`.                                                                                                |
| **File paths**                           | `\input{`, `\include{`, `\includegraphics{` complete against the actual project tree.                                                                                           |

**Linting** (client-side, no compile needed): unbalanced braces; unmatched `\begin`/`\end`; undefined `\ref`; undefined or excluded `\cite`; duplicate labels; unused labels; a curated subset of ChkTeX rules (`~` before `\cite`, `\,` in units, quote style, non-breaking spaces). Surfaced as gutter markers and a problems panel.

**Diagnostics from compilation:** parse the TeX `.log`, map errors and warnings to file and line, show them inline. Log parsing is fiddly — budget real time for it; it's the difference between "usable" and "infuriating."

---

## 4. Compilation — client-side WASM (ADR-007)

**Decision: compile in the browser.** Rationale, in order of weight:

1. **Preserves E2EE.** LaTeX sources are in the encrypted tier. Server-side compilation would require sending plaintext drafts to your server, which contradicts the entire point of encrypting them.
2. **Zero server cost.** Matches your cost constraint. A TeX build is CPU-heavy and long-running — exactly the workload that makes serverless hosting expensive.
3. **Eliminates a whole vulnerability class.** Server-side LaTeX is a well-known RCE surface (`\write18` shell escape, `\input{/etc/passwd}` file disclosure, decompression and `\loop` resource bombs). Sandboxing it properly means per-job ephemeral containers with seccomp, no network, read-only rootfs, and CPU/memory caps. Compiling in the browser means no build host exists to attack.

**Engine.** A WASM TeX engine — SwiftLaTeX (pdfTeX/XeTeX builds) is the most established option; a Tectonic WASM build is the alternative. **Spike this in week 1 of Phase 5 against a real 80-page thesis with real packages** — this is the single assumption in the plan most likely to be wrong, and the whole phase plan depends on it.

**Package distribution.** The engine needs a TeX tree. Bundle a curated TeX Live subset (~30 MB) and fetch additional packages on demand from a CTAN mirror **served from the R2 `tex-dist` bucket**, cached permanently in IndexedDB (packages are immutable, so cache them forever). First compile on a new device is slow; every subsequent one is fast. Show honest progress during the initial download — "preparing TeX environment, 24 MB" — rather than a spinner.

R2 is the right home for this: it is the single largest egress line in the product, and R2 charges nothing for egress. Two requirements on those objects:

- **`Cross-Origin-Resource-Policy: cross-origin` on every object.** The engine needs `SharedArrayBuffer`, which needs COEP `require-corp`, which blocks cross-origin resources that don't send CORP. Miss this and packages fail to load with an error that points nowhere near the cause. Set it at upload time.
- **Immutable cache headers** (`Cache-Control: public, max-age=31536000, immutable`) with content-hashed keys, so Cloudflare's edge cache absorbs repeat traffic.

**Performance.** Run in a Web Worker with `SharedArrayBuffer` (which is why COOP/COEP headers are required — see `02-security-and-e2ee.md` §7). Incremental recompile on save with debounce; cache `.aux`/`.bbl` between runs so bibliography passes don't re-run unnecessarily.

**Server-side fallback — deferred, not cancelled.** Some documents will exceed what WASM can handle (huge TikZ, exotic engines, LuaLaTeX with big fonts). If the escape hatch is ever built, it is opt-in per LaTeX project, clearly labelled as sending plaintext to the server, and must run: Tectonic in an ephemeral container, non-root, read-only rootfs, no network, seccomp, `-no-shell-escape`, 60 s CPU and 1 GB memory caps, output size limit. Do not build it in v1.

**Recording results.** `CompileJob` stores status, duration, error summary, and a reference to the encrypted output PDF in Storage, so collaborators see the last successful build without recompiling locally.

---

## 5. PDF preview & SyncTeX

Side-by-side pdf.js preview, with **SyncTeX forward and inverse search** — click a line in the source to jump to that spot in the PDF, and vice versa. The engine emits a `.synctex.gz`; parse it client-side and maintain the source ↔ page-coordinate mapping.

This is the feature that makes an integrated editor _feel_ like Overleaf rather than like a text box next to a PDF. Don't skip it.

Also: preserve scroll position across recompiles (nothing is more annoying than being thrown back to page 1 on every build), and highlight regions that changed since the last successful compile.

---

## 6. Bibliography integration — the differentiator

- `references.bib` is a **generated file**, marked read-only in the editor, rebuilt from `v_project_bib` whenever the library changes. `LatexProject.bibAutoSync` can be turned off for people who want manual control.
- `Work.citationKey` (`author_year_shorttitle`) is stable and globally unique. **Never regenerate an existing key** — it would silently break every `\cite{}` in every project.
- `\cite{}` completion queries the project corpus directly, ranked by inclusion status, then relevance to the current section's linked Question.
- Hovering a citation shows the paper's abstract, your highlights, and any extractions.
- Inserting a Claim from the synthesis layer inserts its text plus the `\cite{}` keys of its supporting evidence, with the provenance link preserved.
- Bib style selectable per project; entries generated from CSL-JSON via `citeproc-js` where a non-BibTeX format is needed.

---

## 7. Real-time collaboration

Yjs + `y-codemirror.next` over an **encrypted WebSocket carried by a Cloudflare Durable Object** — one DO instance per LaTeX file (ADR-017, as amended by ADR-020: the relay is now a standalone Worker hosting nothing else, because the app itself moved to Vercel). Plain text merges far more cleanly than rich text, so this is the easy CRDT case; the hard part is the transport, not the merge.

### 7.1 Why a Durable Object and not Supabase Realtime

ADR-013 deferred this pending load data. The requirement for smooth live cursors settles it early: **awareness traffic is high-frequency and Supabase Realtime broadcast is the wrong shape for it.** Cursor and selection updates fire on every keystroke and every mouse move; throttled to 10–30 Hz, a handful of collaborators generate tens of messages per second per file. Supabase bills **per delivered message per subscriber**, so the free tier's 2 M/month covers roughly six two-hour four-person sessions — Realtime is priced for change notifications, not for cursors.

A Durable Object is purpose-built for this: one authoritative coordination point per file, WebSocket hibernation so an idle document costs nothing, sub-50 ms fan-out from a single region, and the compactor election (§7.5) becomes trivial instead of an advisory-lock dance.

**Why this survived the move off Cloudflare.** Vercel Functions accept no inbound WebSockets, so the relay had to stay somewhere — and the E2EE requirement makes the split clean rather than awkward. The DO cannot decrypt Yjs ops, so it was always a dumb ciphertext relay with no CRDT logic; its CPU per message is microseconds, which is why the 10 ms free-tier cap that made Workers unusable for SSR is irrelevant here. It holds no database credentials and authorizes clients with a 60-second relay ticket signed by Vercel. Residual lock-in is contained by the `CollabTransport` interface; the fallback is a self-hosted `y-websocket` on Fly.io (~$5/mo). See `05-resolution-plan.md` R-21.

Supabase Realtime keeps its job: **Postgres change subscriptions** (someone screened a paper, an extraction was submitted). Ephemeral collaboration state goes to the DO. Clean split, each tool doing what it's good at.

### 7.2 What the DO does and does not do

Does: authenticate the WebSocket against project membership on connect; fan out opaque encrypted update blobs; relay awareness state; hold the compaction lock; append updates to `LatexUpdate` for durability.

Does **not**: decrypt, merge, or interpret anything. LaTeX sources are E2EE — the DO is a dumb, fast relay that happens to be in the right place. It never holds a project key.

### 7.3 Presence and awareness

- **Live cursors** with the author's name, colour, and current selection range, rendered as CodeMirror decorations
- **Remote selection highlights** so you can see what someone is about to change
- **Per-file presence avatars** in the file tree — see who is in `intro.tex` right now without opening it
- **Follow mode**: click an avatar to pin your viewport to theirs
- Awareness throttled to 30 Hz outbound, coalesced; awareness state is encrypted like everything else, though presence _identity_ is necessarily visible to the DO

Latency budget: **<100 ms** local-echo-to-remote-render on a normal connection. Above ~250 ms, co-editing a single paragraph starts to feel like fighting.

### 7.4 Offline and reconnect

Yjs merges cleanly on reconnect — the main reason for a CRDT over OT. Edits made offline are queued in IndexedDB and replayed on reconnect with no conflict dialog, ever. The UI shows a clear offline indicator and a pending-update count rather than pretending nothing happened.

### 7.5 Durability and compaction

Every update is appended to `LatexUpdate` as ciphertext. The DO holds the compaction lock and nominates one connected client to merge and write an `isSnapshot` row when the log exceeds 300 updates or 1 MB. Superseded rows are deleted only after the snapshot is confirmed present.

### 7.6 Review affordances

- Comments anchored to a line range (`Thread.targetType = LATEX_LINE`), surviving edits via Yjs relative positions
- Suggestions as proposed patches a supervisor authors and an author accepts or rejects
- Per-file soft locking (advisory, not enforced) for people who would rather not co-edit a section

---

## 8. Line-level history: attribution and Git

"Every line can be tracked down" is two features, not one, and conflating them produces a worse version of both.

### 8.1 The conflict, stated plainly

Git and CRDTs model history incompatibly. Git is **discrete**: explicit commits, one author, a message, a tree snapshot. Yjs is **continuous**: character-level operations, no commit boundary, many authors interleaved within a single line. You cannot make Yjs _be_ Git without destroying real-time editing, and you cannot make Git the live source of truth without a merge conflict on every keystroke.

**Resolution: Yjs is the source of truth. Git is a materialized projection of it.** This is the same shape as Overleaf's git bridge, and the same shape as the rest of this product — the evidence table, the bibliography, the PRISMA diagram are all derived views, never authoritative.

### 8.2 Live attribution — the feature that actually answers the question

Don't use Git for blame. Yjs already knows more than Git ever will.

Every Yjs insertion carries the originating `clientID`. Record the `clientID → userId` mapping when a client joins a document (`YjsClient` in the data model) and you get **character-level authorship that is always current, with no commits, no staleness, and finer granularity than `git blame` can express.** Git blame attributes a whole line to whoever touched it last; this attributes each character to whoever actually typed it.

What ships:

- **Blame gutter** — author colour strip beside every line; hover for name and timestamp
- **Mixed-authorship lines** rendered as a gradient rather than a single colour, because a line edited by three people is the normal case in a co-authored paper
- **"Who wrote this?"** on any selection, including a partial line
- **Contribution rollup** per file and per project, feeding the CRediT ledger — `WRITING_ORIGINAL` derived from characters authored, `WRITING_REVIEW` from suggestions accepted

This is strictly better than what the user asked for and it costs a small mapping table.

### 8.3 Git — for interoperability, not for blame

Real Git still earns its place: external tooling, offline clones, CI on the manuscript, arXiv submission history, and the fact that many researchers simply want their thesis in a repo.

**Architecture: client-side, encrypted, derived.**

- **`isomorphic-git`** running in the browser against a virtual filesystem backed by IndexedDB. All Git operations happen client-side, which is the only way to keep sources E2EE — the server never sees plaintext, so it could never build a commit.
- **Git objects are content-addressed blobs.** Encrypt each object under the project key and store it in the R2 `git-objects` bucket. The object model survives encryption intact because Git never needs to _interpret_ an object it's only storing — but note the content-addressing is over **plaintext** SHA-1/SHA-256, computed client-side, so dedupe still works.
- **Commit materialization is automatic.** After 5 minutes of inactivity on a file, or on an explicit "Save version", the client creates a commit from the current Yjs state. Multi-author commits use `Co-authored-by:` trailers, so Git's one-author model doesn't erase who actually contributed.
- **Labelled snapshots become tags.** The version history in §7.5 and the Git tag namespace are the same thing surfaced twice.
- **Branching** is supported but deliberately unglamorous: branches are for "try a different Methods section", not for parallel real-time editing. Only one branch is live-editable at a time per file; switching branches swaps the Yjs document. Merges run client-side through isomorphic-git's merge driver, with conflicts resolved in a normal three-way diff view.

### 8.4 Two modes per LaTeX project

Rather than bolting caveats onto every Git action, a LaTeX project is in exactly one of two states, visible in the header:

|             | **Private** (default)                | **GitHub-linked**                                       |
| ----------- | ------------------------------------ | ------------------------------------------------------- |
| Sources     | E2EE under the project key           | **Plaintext on GitHub**                                 |
| Git history | Encrypted objects in R2              | R2 _and_ GitHub                                         |
| Available   | commit, branch, diff, blame, restore | all of that + push, pull, fetch, PRs, merge, checks     |
| E2EE badge  | shown                                | **hidden, replaced by "Synced to github.com/org/repo"** |

Linking is a one-way door per project, requires typed confirmation, and is written to `AuditLog`. This is the honest framing: once a manuscript is on GitHub, the encryption guarantee for _that project_ is decorative, and the UI should stop claiming it. Private mode remains the default because most theses have no reason to leave.

### 8.5 The source control panel

A VS Code-shaped panel, scoped to the LaTeX project — not a general-purpose editor.

**Local operations — `isomorphic-git`, works offline, works in Private mode:**

- Changed-files list with stage / unstage / discard
- Inline and side-by-side diff against HEAD, rendered in CodeMirror with the same LaTeX highlighting
- Commit with message; amend; multi-author `Co-authored-by:` trailers preserved from §8.3
- Branch create, switch, delete; local merge with a three-way conflict resolver
- History graph, per-file log, restore to any commit

**Remote operations — GitHub API, GitHub-linked mode only:**

- Fetch / pull / push, with ahead-behind counts in the status bar
- **Pull requests:** list, create from the current branch, view diff, read and post review comments, see requested reviewers
- **Merge:** merge, squash, or rebase, honouring branch protection rules the API reports
- **Checks:** GitHub Actions status inline — genuinely useful when a workflow compiles the PDF on every push, which is a reasonable thing to set up

### 8.6 Auth — a GitHub App, not an OAuth App

Same reasoning as ADR-015 chose `drive.file` over broad Drive scopes. An OAuth App with the `repo` scope gets read-write access to **every repository the user can see**, which is wildly disproportionate and a liability if a token leaks.

A **GitHub App** is installed per-repository by the user, issues 1-hour installation tokens refreshed server-side, and can be scoped to exactly `contents: write`, `pull_requests: write`, `checks: read`, `metadata: read`. Users choose which repos Porcupine may touch, and can see and revoke that from GitHub's own settings — which is also the answer when a university asks what access the tool has.

### 8.7 Divergence — the part that will actually cause bugs

Yjs is the source of truth (§8.1), but a GitHub-linked repo has a second writer: anyone editing on GitHub, and every merged PR. When the remote moves, the two histories diverge, and this must never be resolved silently.

**The mechanism is the `docEpoch` protocol (ADR-021), specified in full in `05-resolution-plan.md` R-01.** In one line: _Yjs ops are valid only within an epoch, and every cross-epoch reconciliation is a three-way Git merge._ Yjs guarantees convergence, not correctness; Git guarantees a visible conflict. Each engine gets only the job it is sound for.

Pull is a transaction with a frozen document — `FREEZE` → materialize an anchor commit → `fetch` → three-way merge → rebuild a fresh `Y.Doc` → `docEpoch += 1` → broadcast `SWAP`. Clients key their IndexedDB Yjs store by `"<docId>:<docEpoch>"`, so after a swap **a stale op has no reachable path back into the document.** A client that was offline across a swap does not replay: its local state is exported to a `porcupine/offline/<userId>/<ts>` branch off the epoch-`N−1` anchor and merged through Git, with real conflict markers.

Rules:

- **Never auto-pull.** Divergence is surfaced as a status ("2 commits behind"), never reconciled in the background.
- **Pull is an explicit, disruptive operation.** Live editors go read-only with a banner for its duration; warn by name before proceeding.
- **Never call `Y.applyUpdate` with an update whose epoch differs from the document's.** Assert `update.docEpoch === file.docEpoch` on every DO ingest and every Postgres write.
- Conflicts open the three-way resolver, and **only the initiating client may resolve** — single-writer by construction, so there is no concurrent-resolution case to design. Never auto-resolve a `.tex` conflict; a silently mis-merged equation is worse than a visible conflict marker.
- Pulled content is attributed to the commit author, never to whoever pressed Pull.
- Pulled trees are external content: size caps, symlinks rejected, every path validated against traversal.

**Budget ~2 of Phase 5's 9 weeks for this, and treat the offline-Alice/PR-Bob script as a merge gate.** If Phase 5 runs late, cut GitHub _pull_ entirely before cutting the protocol — push-and-PR-only is a coherent product; a half-implemented merge is a silent corruption bug.

### 8.8 What this does _not_ try to be

Not github.dev. You cannot open an arbitrary repository — Git here is bound to a `LatexProject`, and that boundary is what stops this becoming "we built VS Code."

No server-side Git hosting and **no `git push` to Porcupine** from an external client: the server cannot validate refs it cannot read, and accepting them would create a second write path racing the CRDT. Push to GitHub and clone from there.

Also worth saying plainly: **for most researchers the native suggestion flow (§7.6) is a better review path than a PR.** A supervisor in medicine or the humanities will not review a chapter as a diff. The PR workflow is for the GitHub-native minority — build it, but don't make it the primary review path or design the review queue around it.

---

## 9. Templates and export

**Templates:** IEEE, ACM, Springer LNCS, Elsevier, plus a generic university thesis template with configurable title page, and per-organization custom templates (a real adoption driver — every university has its own mandated thesis format).

**Export:** compiled PDF; `.zip` of sources (including the generated `.bib`); push to Overleaf; push to a GitHub repo; import an existing Overleaf or `.zip` project.

**Import matters as much as export.** Nobody starts a thesis in a new tool — they arrive with one in progress. Overleaf/`.zip` import must work on day one of Phase 5.

---

## 10. Build order within Phase 5 (9 weeks)

| Week | Deliverable                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **WASM engine spike against a real thesis** (go/no-go for the whole approach) + multi-file editor with stex highlighting                              |
| 2    | Completion engine: commands, environments, packages, snippets, `\ref`                                                                                 |
| 3    | Compilation pipeline, log parsing, error mapping, PDF preview                                                                                         |
| 4    | `\cite{}` + generated `references.bib` + hover cards + citation linting                                                                               |
| 5    | **Real-time core:** Durable Object transport, Yjs + `y-codemirror.next`, live cursors, presence, offline reconnect, compaction                        |
| 6    | **Attribution:** `clientID → userId` mapping, blame gutter, mixed-authorship rendering, contribution rollup into CRediT                               |
| 7    | **Local Git:** isomorphic-git on IndexedDB, encrypted objects in R2, idle auto-commit, source control panel (stage/diff/commit/branch), history graph |
| 8    | **GitHub link:** GitHub App auth, push/pull/fetch, ahead-behind status, divergence handling, three-way conflict resolver                              |
| 9    | **PR workflow:** list/create/review/merge, checks status; templates and import/export                                                                 |

Four weeks longer than v3's estimate. Real-time, attribution, and the full source control experience are genuinely new scope, not a re-label.

**Fallbacks, in strict order if the schedule slips:**

1. **Drop the PR workflow (week 9).** GitHub's own UI is one click away, and §8.8 argues the native suggestion flow is the better review path for most researchers anyway. Cheapest cut by far.
2. Drop GitHub linking entirely; keep local Git — saves ~1.5 weeks, loses interop only
3. Drop Git entirely, keep §8.2 attribution — attribution is what actually answers "track every line"
4. Degrade real-time to save-and-refresh — **last resort**, explicitly a stated requirement

If the week-1 WASM spike fails: editor, completion, linting, real-time, attribution, and Git all still ship. Compilation defers to a "download sources" button. None of the collaboration work depends on the TeX engine.

---

## 11. Risks

| Risk                                                                                    | Mitigation                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WASM engine can't handle real theses (package gaps, memory)                             | Week-1 spike is the go/no-go. Server-side fallback is the escape hatch.                                                                                                               |
| **Git objects grow unboundedly in R2** — every commit of a 5 MB thesis stores new blobs | Content-addressed dedupe over plaintext hashes means unchanged files cost nothing; pack loose objects on a schedule; cap history depth per project with a documented retention window |
| **`clientID → userId` mapping is lost** → blame data is orphaned and unrecoverable      | Write the mapping row on connect, _before_ the first update is accepted; never garbage-collect it; treat it as durable data, not session state                                        |
| Durable Object becomes a single point of failure for a file                             | DO restarts are transparent to Yjs — clients re-sync from `LatexUpdate`. Test by killing the DO mid-edit.                                                                             |
| Awareness traffic saturates the DO with many collaborators                              | Throttle to 30 Hz, coalesce, and cap concurrent live editors per file (~15) with overflow demoted to read-only-live                                                                   |
| Users expect Git to be the source of truth and are confused when it lags                | UI never presents Git as live state: label it "Version history", show last-commit time explicitly, and make the auto-commit trigger visible                                           |
| **A merged PR silently diverges the repo from the live Yjs doc**                        | Never auto-pull; surface "N commits behind" persistently; pull is explicit and warns when live editors are connected (§8.7)                                                           |
| Pulling replaces the document under someone's cursor mid-edit                           | Apply as one transaction, broadcast through the DO so all clients converge, name the connected editors in the confirmation                                                            |
| Scope creep into "we built VS Code"                                                     | Git is bound to a `LatexProject`; no arbitrary repo browsing, no extensions, no terminal (§8.8)                                                                                       |
| GitHub App token handling (1-hour installation tokens) leaks or expires mid-operation   | Refresh server-side in a Worker, never expose installation tokens to the browser, proxy every GitHub API call                                                                         |
| 30 MB initial TeX download feels broken                                                 | Honest progress UI; prefetch during editor idle; cache permanently                                                                                                                    |
| Log parsing is worse than it looks                                                      | Budget a full week; test against deliberately broken documents                                                                                                                        |
| SyncTeX mapping drifts on multi-file projects                                           | Parse the full `.synctex` file tree, not just the root                                                                                                                                |
| Citation keys change and break drafts                                                   | `Work.citationKey` immutable once assigned — enforce in the DB                                                                                                                        |
| Mobile LaTeX editing is genuinely hard                                                  | Target _reading and commenting_ on mobile, _editing_ on tablet and desktop. Say so; don't pretend otherwise.                                                                          |
