# Phase 1 — Discovery, corpus & reading · Build Plan

**6 weeks.** Exit criterion: _a 4-person team runs screening on 300 papers and sees progress._ **Ship this to a real lab.**

This is the smallest slice that is useful to someone who is not us. Phase 0 proved the security boundary; this phase is the first one a stranger can judge.

---

## What "useful" means here

A literature review has a shape: find papers, decide which count, read them, track how far you got. Phase 1 delivers exactly that loop and nothing beyond it. Extraction (Phase 2) is the differentiator, but a differentiator on top of a corpus nobody can assemble is worth nothing.

The exit number is deliberate. **300 papers × 4 people** is a real systematic review's screening load, and it is the point where hand-rolled spreadsheets start failing — which is the moment this product has to be better than a spreadsheet, not merely different.

---

## Week 1 — corpus schema, RLS, and FTS

The same ordering rule as Phase 0: **the security boundary lands before anything that writes through it.**

| #   | Task                                                                                                    | Done when                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1.1 | Schema slice: `Work`, `ProjectWork`, `ProjectWorkQuestion`, `Question`, `SavedSearch`, `FileObject`, `Anchor`, `Annotation` | `prisma validate` clean; migration generated via `db:diff`, never `migrate dev`         |
| 1.2 | Enums: `ScreenStatus`, `ReadStatus`, `AnchorStatus`, `AnnotationKind`, `AnnotationVisibility`, `Residency`, `UploadState`, `TextStatus`, `ScanStatus` | All referenced by 1.1                                          |
| 1.3 | **RLS for every new table**, including the two that are not project-scoped                              | `Work` readable by any authenticated user, writable by none directly; `FileObject` owner-or-member    |
| 1.4 | **FTS generated column on `Work`** using `build_tsvector(language, …)` (R-14)                          | GIN index present; **no `to_tsvector('english', …)` anywhere** — CI greps for it                     |
| 1.5 | `pg_trgm` on `Work.title` + `Anchor.quote`                                                              | Dedupe and quote search have their indexes before there is data to need them                          |
| 1.6 | pgTAP extension for all 8 tables, **with mutation checks**                                              | Each negative assertion is proven able to fail — see below                                            |

### The mutation rule (new, and non-negotiable)

Phase 0 shipped a negative test that could never fail: it asserted the relay rejected a forged ticket, but the "forgery" decoded to a valid signature, so for a quarter of all runs the assertion was never made. It passed for months of wall-clock time proving nothing.

**Most of the RLS suite is negative assertions of exactly that shape** — "this user sees zero rows" passes just as happily when the query is broken as when the policy works.

So every negative RLS assertion in this phase gets a paired mutation check: with the policy temporarily dropped inside a rolled-back transaction, the same assertion must go **red**. A test that cannot fail is not evidence, and we now have a concrete reason to believe that rather than a general principle.

**Gate: nothing in week 2 starts until 1.6 is green and the mutation checks are in place.**

---

## Week 2 — providers, normalization, dedupe

| #   | Task                                                                          | Done when                                                                                     |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 2.1 | Provider adapters: OpenAlex, Crossref, arXiv, Europe PMC, Semantic Scholar    | One interface, five implementations, each behind its own rate limiter                             |
| 2.2 | **Postgres token bucket** (R-22) — no Cron Triggers on Vercel                 | Concurrent requests across Lambda instances share one budget; proven with a concurrency test      |
| 2.3 | **SSRF controls** (`02` §7) — resolve-then-check-IP, revalidate on every hop  | Load-bearing on Lambda, not defence-in-depth: the metadata endpoint exists there                  |
| 2.4 | Normalization to `Work` + `titleNorm`                                         | Same paper from five providers → one row                                                          |
| 2.5 | Dedupe: DOI → arXiv → OpenAlex → PMID → `titleNorm` + year                    | Ordered by confidence; trigram fallback never auto-merges, it only proposes                       |
| 2.6 | **R-15 preprint/published** via `versionOf`, taken from OpenAlex, never inferred | A preprint and its published version are two rows, one library entry, counted once            |
| 2.7 | Measure the **R-04 OA dedupe rate** against a real corpus                     | The cost model assumes 45%. It is an assumption. Write the measured number into `BUILD-LOG.md`    |

---

## Week 3 — federated search

Search UI, provider fan-out with partial failure (four results beat an error page), relevance ranking seeded by `Question.keywords`, one-click add to project.

**Partial failure is the design point.** Five providers means five chances to be down. A provider that times out is a degraded result set with a note, never a failed search.

---

## Week 4 — import and library

DOI / BibTeX / RIS paste-or-upload, PDF upload via **presigned PUT direct to R2** (bytes never touch Vercel), the virtualized library table, saved views, bulk actions.

`FileObject.uploadState` exists because a presigned PUT can succeed without us hearing about it. The reconciliation job is written **this week**, not when the orphans are discovered.

---

## Week 5 — screening and assignment

The pipeline `identified → screening → included | excluded → reading → extracted → synthesized`, exclusion reasons from a controlled vocabulary, assignment with due dates, the per-person queue.

Exclusion reasons are controlled vocabulary because PRISMA requires reporting them by category. Free text here means the Phase 2 PRISMA diagram cannot be auto-derived, and hand-drawing it is exactly the pain this product exists to remove.

---

## Week 6 — reading, anchoring, progress

PDF reader with highlights and margin notes; the **anchoring engine** (page + quote + prefix/suffix + offsets, with fuzzy fallback); burndown against milestones; reading velocity; Postgres FTS across works and annotations.

**The anchoring engine is the riskiest thing in the phase.** Every extraction in Phase 2 resolves through it, and a highlight that drifts silently is worse than one that breaks loudly — hence `AnchorStatus.DRIFTED` as a first-class state rather than a boolean.

---

## Definition of done

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green, CI green on a clean runner
- [ ] pgTAP covers all 8 new tables, every negative assertion mutation-checked
- [ ] No `to_tsvector('english'` anywhere in the repo — asserted in CI
- [ ] 300 works imported, deduped, and screened by 4 accounts in one project
- [ ] `axe-core` still green on every new route
- [ ] The measured OA dedupe rate is written down, whatever it turns out to be

**Not in Phase 1:** extraction protocols, evidence tables, Google anything, LaTeX, messaging, encryption in use.

---

**This phase ends with a `BUILD-LOG.md` entry like every other** — and with the honest version of the exit criterion: not "the code supports 300 papers" but "300 papers went through it".
