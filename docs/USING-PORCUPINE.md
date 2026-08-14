# Using Porcupine

A guide to what the app actually does today, in the order you would use it —
and an honest list of what is **not built yet**, because a good deal isn't, and
not knowing which is which is the most confusing thing about the app right now.

Last checked against the code on **2026-08-14**, at `main`.

---

## 1. Getting it running

Everything runs on your machine. There is no deployed environment yet.

```bash
# 1. Docker Desktop must be RUNNING first. The database lives in containers,
#    and every failure below traces back to this when it is not up.
pnpm db:start          # first run pulls images and takes a few minutes

# 2. Apply the schema
pnpm db:reset

# 3. Start the app
pnpm dev               # http://localhost:3000
```

To stop: `pnpm db:stop`. Your data survives a stop; `pnpm db:reset` wipes it.

### Signing in — the thing that catches everyone

There is **no password**. You type your email, and the app emails you a
six-digit code.

Locally, that email never leaves your machine. It goes to **Mailpit**:

> **http://localhost:54324**

Open it, click the newest message, copy the six digits. If you sat waiting for
an email in your real inbox, this is why nothing arrived.

Any email address works locally — `me@test.dev` is fine. Nothing is verified.

### The other local URLs

| What | Where |
| --- | --- |
| The app | http://localhost:3000 |
| Mailpit — every email the app sends | http://localhost:54324 |
| Supabase Studio — browse the database directly | http://localhost:54323 |

---

## 2. The one concept that explains the whole app

**When you create a project you choose a _kind_, and that choice changes which
features exist.** Not cosmetically — whole screens appear or refuse to work.

This is deliberate (`docs/05-resolution-plan.md` R-06): a PhD student reading
40 books should not be made to run a clinical-review process, and a review team
needs every guardrail. Same database, two products.

| | THESIS · LAB_PAPER · GENERAL | SYSTEMATIC_REVIEW |
| --- | --- | --- |
| Protocol required before extracting | optional | **required** |
| Exclusion reason required to exclude a paper | no | **yes** |
| PRISMA diagram | hidden | **yes** |
| Dual extraction + reconciliation | hidden | **yes** |
| Cohen's κ (inter-rater agreement) | hidden | **yes** |

**If a screen tells you a feature is for systematic reviews, your project is a
THESIS.** You cannot change kind after creation — make a new project.

If you want to see everything the app can do, create a **SYSTEMATIC_REVIEW**.

---

## 3. The workflow, in order

Every screen below is reachable from the project page. There is no wizard; you
move between stages yourself.

### Stage 1 — Get papers in

**`Find papers`** — searches five sources at once: OpenAlex, Crossref, arXiv,
Europe PMC and Semantic Scholar. Duplicates across sources are merged into one
result. If a source is down, the others still return and the page says which
one failed.

**`Import`** — paste BibTeX or RIS straight from Zotero, Mendeley or a journal
site. Preview first, then add. Re-importing the same references adds nothing,
so you can paste the same file twice safely.

Both land papers in the **Library**.

### Stage 2 — Decide what is in

**`Library`** — everything in the project, filterable by status.

**`Screen`** — one paper at a time: include or exclude. In a systematic review
you must give a reason to exclude, from a controlled list — that list is what
the PRISMA diagram is built from later.

You can **assign** a paper to a specific person here. Assigned papers show up
in that person's **`Queue`** (top nav). If several people screen at once, each
sees the same papers in a *different order*, so you collide far less.

**`Progress`** — how much screening is done, and by whom.

**`PRISMA`** — the flow diagram journals ask for, built from real decisions
rather than typed in. Systematic reviews only.

### Stage 3 — Read and annotate

**`Read`** (click a paper title in the Library) — the text with your
highlights. Select a passage to highlight it and attach a note. Notes can be
private or shared with the project.

> **Today this shows the _abstract_, not the full PDF.** See §4.

### Stage 4 — Extract

**`Protocol`** — define the questions you ask *every* paper: "sample size",
"study design", "primary outcome". Start from a template (four are built in) or
build your own. Field types include number, text, yes/no, single-choice,
multi-choice, date and **quote** — a quote field cannot be typed into, only
selected from the paper, which forces provenance.

Two rules will stop you later, by design:
- once a field has answers, its **key cannot be renamed**
- a field with answers **cannot be deleted**

Both exist so two exports of the same review never disagree about what a column
means. Make a new protocol version instead.

**`Extract`** (from a paper in the Library) — answer the protocol for that
paper. Save drafts as you go. **Submitting freezes it**; reopen it as a draft
to edit again.

### Stage 5 — See the results

**`Evidence`** — the table this was all for. Papers as rows, protocol fields as
columns.

- click any column header to sort (it sorts numbers as numbers)
- filter and group by any field
- a cell in *italic dash* is unanswered — an incomplete row looks incomplete
- a **dotted-underlined** cell was quoted; click it to open the paper at that
  exact passage, and it will tell you if the passage no longer exists
- **Export CSV / Export Excel** — exports exactly what your filters show

Column headers in the export are the field **keys** (`sample_size`), not the
labels, so scripts that read the file keep working when someone rewords a
label.

The page also warns you when a research question has **no evidence behind it**
at all.

### Stage 6 — Reconcile (systematic reviews only)

**`Reconcile`** — when two people have each extracted the same paper
independently, this shows where they disagree, side by side. A third person —
who must not be either of them — picks the right answer for each field, or
records a different answer, or leaves it unanswered.

It also reports **Cohen's κ** per field. Where κ cannot be computed it says so
rather than printing a number; see §6.

---

## 4. What is NOT built yet

This is probably the source of most of the confusion. These are real gaps, not
things you are failing to find.

| Not built | What that means for you |
| --- | --- |
| **PDF upload and reading** | The reader shows the **abstract only**. There is no file upload anywhere in the app. Highlights work, but only over the abstract text. Blocked on Cloudflare R2 credentials. |
| **Full-text search of papers** | You can search *providers* for new papers; you cannot full-text search PDFs you already have, because there are no PDFs. |
| **Real-time collaboration** | Two people editing the same note simultaneously is Phase 5. Today, the last write wins. Screening decisions *are* protected from overwriting each other. |
| **LaTeX / Overleaf export** | Not started. CSV and Excel only. |
| **GitHub linking** | The capability flag exists; no screen does anything with it. |
| **Reference-manager sync** | Import is one-way, paste-only. No Zotero sync, no re-export to a manager. |
| **Deployment** | Local only. No hosted version, no sharing a link with a colleague. |
| **AI / auto-extraction** | Deliberately none (ADR-003). Every answer is typed by a person. |
| **Email that leaves your machine** | Everything goes to Mailpit. |
| **Assigning dual extraction** | Nothing tells two people to extract the same paper. It happens when two people both choose it. Reconciliation then notices. |

---

## 5. Roles

Set when you invite someone (project page → Add member):

| Role | Can |
| --- | --- |
| **OWNER** | everything, including the protocol and members |
| **ADMIN** | everything except deleting the project |
| **CONTRIBUTOR** | screen, read, annotate, extract — **not** edit the protocol |
| **REVIEWER** | read and annotate; **cannot** record screening decisions. This is the supervisor role |
| **OBSERVER** | read only; cannot annotate |

You can only invite someone who already has an account. Sign them up first, or
the invite is refused.

---

## 6. Things the app does that look like bugs and are not

**"κ is undefined" instead of a number.** If both extractors gave the same
answer to every paper for a field, Cohen's κ genuinely cannot be computed —
chance alone predicts complete agreement. Showing `1.00` there would be a
confident number the data does not support, so it shows the reason and the raw
agreement percentage instead.

**90% agreement but a poor κ.** Not a contradiction. It means one answer
dominates that field, so someone answering the same thing every time without
reading would score nearly as well. Both numbers are shown for that reason.

**"You already have your own extraction of this paper."** You cannot reconcile
a paper you extracted yourself — that would make you a third reader rather than
a neutral one.

**A field you cannot rename or delete.** It has answers. Create a new protocol
version.

**"This extraction has been submitted."** Reopen it as a draft first.

**An exclusion that will not save.** Systematic reviews require a reason.

---

## 7. When something goes wrong

**Everything fails, nothing loads.** Docker is not running. Start Docker
Desktop, then `pnpm db:start`.

**No sign-in code.** Look in Mailpit (http://localhost:54324), not your inbox.

**The page shows an error rather than an empty list.** That is on purpose — a
broken query and a genuinely empty table used to look identical, so failures
are now loud. The message names what failed to load.

**Search returns nothing.** The providers are real external APIs and need
internet. The page names any provider that failed.

**One provider says it failed and the rest worked.** Normal, and the design
point — four sets of results beat an error page. Semantic Scholar is the usual
one: it rate-limits unauthenticated callers hard and returns 429. Search again
in a minute.

**_Every_ provider says it failed.** Five independent APIs do not fail
together, so that one is ours — please report it. One such bug is fixed
(2026-08-15: an unreachable IPv6 address was pinned and the socket hung), and
the failover that prevents it is now tested.

**Starting over:** `pnpm db:reset` wipes all data and reapplies the schema.
You will need to sign up again.

**Checking the app is healthy:** `pnpm verify` runs every check (needs Docker
up). `pnpm verify --e2e` adds a browser run.

---

## 8. Where the detail lives

| Document | What is in it |
| --- | --- |
| `docs/BUILD-LOG.md` | What was built, what broke, and what is still open — the most honest document here |
| `docs/00-product-plan.md` | The roadmap and phases |
| `docs/01-data-model.md` | Every table and why it is shaped that way |
| `docs/02-security-and-e2ee.md` | The threat model, encryption tiers (what the server can and cannot read), key lifecycle, and SSRF controls |
| `docs/03-latex-studio.md` | The Phase 5 LaTeX environment plan and features |
| `docs/04-conflicts-and-hazards.md` | Hard technical problems, hazards, and the verdicts resolving them |
| `docs/05-resolution-plan.md` | The numbered risks (R-02, R-06, R-14 …) referenced throughout the code |
| `docs/06-phase-0-build-plan.md` | Phase 0 (Foundations) build plan and exit criteria |
| `docs/07-phase-1-build-plan.md` | Phase 1 (Discovery, corpus & reading) build plan and exit criteria |
| `docs/08-phase-2-build-plan.md` | The extraction pipeline, week by week |
| `docs/adr/` | Architecture Decision Records (ADRs) |
