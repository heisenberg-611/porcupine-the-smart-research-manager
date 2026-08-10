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

| Source | Behaviour |
|---|---|
| **Command database** | ~2,000 TeX/LaTeX commands with signatures and one-line docs, bundled as a static JSON (derived from CTAN package docs). Typing `\fra` → `\frac{}{}` with argument placeholders. |
| **Environments** | `\begin{` → known environments, filtered by loaded packages; auto-inserts the matching `\end{}`. |
| **`\cite{}`** | **Reads the project corpus.** Fuzzy match on author, title, year, venue. Renders as a rich list, not bare keys. Warns on excluded works. |
| **`\ref{}` / `\eqref{}` / `\autoref{}`** | Every `\label{}` across all files in the project, with the section or equation text as context. |
| **Packages** | `\usepackage{` → package names available in the bundled TeX distribution, with descriptions. |
| **Snippets** | User- and project-level, tab-stop aware: figure, table, algorithm, theorem, custom. |
| **Math palette** | Searchable symbol picker mapping "integral", "∈", "sum" → `\int`, `\in`, `\sum`. |
| **File paths** | `\input{`, `\include{`, `\includegraphics{` complete against the actual project tree. |

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

This is the feature that makes an integrated editor *feel* like Overleaf rather than like a text box next to a PDF. Don't skip it.

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

## 7. Collaboration

Yjs + `y-codemirror.next`, encrypted updates over Supabase Realtime — the same machinery as Phase 4 documents, and easier, because plain text merges far more cleanly than rich text.

- Live cursors with names and colours; per-file presence
- Comments anchored to a line range (`Thread.targetType = LATEX_LINE`), which survive edits via a Yjs relative position
- Suggestions as proposed patches a supervisor can author and an author can accept or reject
- Version history: labelled snapshots plus a side-by-side diff; restore to any snapshot
- Per-file soft locking (advisory, not enforced) for people who prefer not to co-edit a section

---

## 8. Templates and export

**Templates:** IEEE, ACM, Springer LNCS, Elsevier, plus a generic university thesis template with configurable title page, and per-organization custom templates (a real adoption driver — every university has its own mandated thesis format).

**Export:** compiled PDF; `.zip` of sources (including the generated `.bib`); push to Overleaf; push to a GitHub repo; import an existing Overleaf or `.zip` project.

**Import matters as much as export.** Nobody starts a thesis in a new tool — they arrive with one in progress. Overleaf/`.zip` import must work on day one of Phase 5.

---

## 9. Build order within Phase 5

| Week | Deliverable |
|---|---|
| 1 | **WASM engine spike against a real thesis** (go/no-go for the whole approach) + multi-file editor with stex highlighting |
| 2 | Completion engine: commands, environments, packages, snippets, `\ref` |
| 3 | Compilation pipeline, log parsing, error mapping, PDF preview |
| 4 | `\cite{}` + generated `references.bib` + hover cards + citation linting |
| 5 | Yjs collaboration, comments, version history, templates, import/export |

If the week-1 spike fails, fall back to: editor + completion + linting, with compilation deferred and a "download sources" button — still genuinely useful, and it doesn't sink the phase.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| WASM engine can't handle real theses (package gaps, memory) | Week-1 spike is the go/no-go. Server-side fallback is the escape hatch. |
| 30 MB initial TeX download feels broken | Honest progress UI; prefetch during editor idle; cache permanently |
| Log parsing is worse than it looks | Budget a full week; test against deliberately broken documents |
| SyncTeX mapping drifts on multi-file projects | Parse the full `.synctex` file tree, not just the root |
| Citation keys change and break drafts | `Work.citationKey` immutable once assigned — enforce in the DB |
| Mobile LaTeX editing is genuinely hard | Target *reading and commenting* on mobile, *editing* on tablet and desktop. Say so; don't pretend otherwise. |
