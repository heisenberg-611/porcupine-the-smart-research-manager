# Phase 4 — Comprehension · Build Plan

Phase 2c fixed **navigation**: where am I, what do I do next, did that work. It
worked — you can now get anywhere. This phase is about the next question, which
2c never asked: **once I am there, do I understand what this screen is for, and
can I do the thing it exists for?**

Six complaints, all from use rather than review, all reproduced in the code
below. Every claim carries a file reference so it can be checked rather than
taken. Grounded in the tree as of 2026-08-15, after `ui-theme-and-navigation`.

---

## 1. What is actually wrong

### 1.1 Research questions have no user interface. At all.

This is the worst finding in this document, and it is not a usability problem —
it is a missing feature that three shipped features quietly depend on.

The `questions` table is **read** in two places:

- `apps/web/src/app/projects/[id]/search/actions.ts:70` — `tx.question.findMany()`,
  which supplies the keywords the relevance ranking scores against.
- `apps/web/src/app/projects/[id]/search/page.tsx:38` — the suggestion chips
  added this week.

It is **written** in zero places. There is no form, no action, no route.
`grep -rn 'from("questions")' apps/web/src` returns reads only.

The consequences run further than an empty box:

- Search results are ranked against nothing. `matched` is always `[]`, so the
  "why did this paper surface" affordance — the one described in
  `relevance.ts:36` as existing so a search strategy can be defended in a
  methods section — renders empty on every result, for every project, always.
- `search-client.tsx` tells the user *"Add research questions to this project
  and results will be ranked against them."* There is nowhere to go. The app
  instructs the user to do something the app does not let them do.
- The suggestion chips I added on 2026-08-15 can never appear.

This is the fourth instance of the same class of defect found in this codebase
— a documented capability with no producer — after `structureUpgradePath`,
`workInputSchema`, and the Master Key. It is worth naming as a pattern: the
plans describe the finished thing, and the piece that was skipped is the piece
nobody's screen shows.

### 1.2 Screening shows one paper and hides the pile

`screen-client.tsx:267` renders exactly one `<article>`: the current paper.
There is no list. You cannot see what is coming, cannot see how the queue is
ordered, cannot pick the one you are ready to judge, and cannot tell whether
the 300 remaining are all from one search or spread across five.

`p:268` prints `"{n} left"` and that is the entire model of scope. For a task
people do three hundred times in an afternoon, the interface offers no way to
see the afternoon.

**Skip does not skip.** `screen-client.tsx:326` and the `s` shortcut both do
only `setIndex((i) => i + 1)`. Nothing is written. Reload and every skipped
paper is back in place, in the same order, with no record that anyone looked at
it — and no way for a colleague sharing the queue to know either.

That is also the whole reason the Pipeline's SCREENING bar is always empty:
`recordDecision` accepts the status (`screen/actions.ts:20`), the transition
`IDENTIFIED → SCREENING` is permitted (`shared/src/screening.ts:40`), the queue
query selects it (`screen/page.tsx:64`), and the PRISMA view counts it
(`20260814100000_prisma_flow.sql:108`). Only the write is missing. The single
control whose meaning **is** that status doesn't write it.

### 1.3 PRISMA does not say what it is or who it is for

`prisma/page.tsx:76` heads the page "PRISMA 2020 flow" and describes it as
*"Derived from recorded screening decisions. Nothing here is estimated."*

Both sentences are true and neither helps anyone who does not already know what
PRISMA is. The page never says it is the flow diagram journals require in a
systematic review's methods section, never says what to do with it, and offers
no way to get it into a manuscript.

It is also shown to **every** project kind — `project-sections.ts` deliberately
does not gate it — so a thesis student meets a section named after a reporting
standard for clinical reviews with no explanation of why it is in their sidebar.
The only accommodation is a dashed note saying the diagram "may be incomplete."

### 1.4 Papers do not carry links to themselves

Search results link out: title → `doi.org`, plus an Open access chip
(`search-client.tsx`, added 2026-08-15). Nowhere else does.

- `library/page.tsx:74` selects `doi` and `oa_pdf_url`, then at `:184` renders
  the open-access status as the plain text `" · open access"`. The URL is
  fetched and thrown away.
- `screen-client.tsx` renders title, authors, venue, year, abstract — and no
  link. When there is no abstract it says *"decide from the title, or open the
  paper first"* (`:292`), advising an action the screen provides no means to
  take.
- `evidence/page.tsx`, `read/[workId]/page.tsx` and `queue/page.tsx` have no
  outbound link either.

The moment someone needs the actual paper is the moment they are deciding about
it, and that is the one place we make them go and find it themselves.

### 1.5 The protocol is the feature the user asked for, wearing a name that hides it

Stated goal: *"there should be a specific pipeline we all will be extracting
information from the papers, so that we can extract relevant information for our
chosen topic."*

That is precisely what `protocol/` does. It is built, versioned, template-seeded
(`PROTOCOL_TEMPLATES`, `shared/src/protocol.ts:115` — PICO and others), it locks
answered fields, and it copies forward on a new version. The feature is not
missing. It is **unrecognisable**:

- It is called "Protocol", a term from systematic-review methodology, not from
  the sentence above.
- It sits in the **Extract** group, so you meet it after screening — but it must
  exist before any extraction happens, and it should shape what you collect.
- Its own copy calls fields "questions" (`protocol-client.tsx:46,68,102`), which
  collides with research questions (§1.1) — two different things, one word.
- Nothing connects it to the topic. The protocol says what to record; the
  questions say what the review is about; neither knows the other exists.

### 1.6 Encrypted messaging asks for three concepts before the first sentence

The gates are individually well written. The journey through them is not:

1. Messages → *"Unlock your keys"* (`messages-client.tsx:224`)
2. `/unlock` → recovery passphrase — *"the 30-character phrase shown once when
   you created your keys"* (`unlock-form.tsx:95`)
3. back to Messages → *"This project has no content key yet"* (`:241`)
4. `/projects/[id]/keys` → "Create the project key"
5. back to Messages → create a channel
6. type

Five screens and three concepts — recovery passphrase, project key with an
epoch, channel — before anyone says anything. Each step is a full navigation
away from the thing being attempted, and step 2 requires a secret shown once at
enrolment. The section is named "Encryption", after the mechanism.

### 1.7 The front door describes a third of the product

`apps/web/src/app/page.tsx` is not empty — it has a headline, a sentence, a
sign-in button and three columns: **Find · Screen · Read** (`:50–72`).

It stops there, and the gap is large:

- Three of the six things the app does are missing from it. Extraction,
  synthesis and the evidence table — the reason the screening exists — are never
  mentioned. Nor are encrypted messages, nor the reconciliation flow that
  distinguishes a real systematic review.
- It never says **who it is for**. A visitor cannot tell whether this is for a
  clinical review team, a PhD student, or a lab.
- It never explains the vocabulary the app then uses everywhere — systematic
  review, protocol, PRISMA, screening — so §1.3 and §1.5 begin on the landing
  page.
- The one line about teams (`:76`) leads with billing, which is not the
  question anyone arrives with.

There is no route to any explanation. A visitor's only way to find out what this
is, is to make an account.

### 1.8 What is *not* wrong

The cryptography, the RLS boundary, the design tokens, and the navigation
delivered in 2c and extended this week. Nothing below touches the security
model: no key material moves, no policy changes, no server learns anything new.

---

## 2. What "easy to use" has to mean here, checkably

1. Every screen states its purpose in one sentence a second-year student
   understands, without a methodology glossary.
2. No screen instructs an action the app cannot perform (§1.1 is the live
   violation).
3. Every paper, everywhere it appears, is one click from the source.
4. Every list of work shows the work, not a counter.
5. Every control writes what its label says it writes (§1.2).
6. The first message in a project takes one screen, not five.

Each is a Playwright assertion, not a matter of taste. That is the point of
writing them this way.

---

## 3. Decisions taken up front

**Research questions get their own section, in Collect, before Find papers.**
Not folded into Protocol. They answer different questions — "what is this review
about" versus "what do we record about each paper" — and merging them would put
the topic behind a methodology term.

**"Protocol" is renamed "Extraction form" in the UI.** The database, the API and
the docs keep `protocol`; this is a label, not a migration. The word "protocol"
survives in the description for people who expect it.

**Screening becomes list-plus-detail, and keeps the keyboard path.** The one-at-
a-time flow is genuinely good for volume, and `i`/`e`/`s` stay exactly as they
are. The list is added beside it, not instead of it.

**Skip starts writing SCREENING**, and skipped papers sort to the end of the
queue rather than being removed from it. Deferring is not dismissing.

**PRISMA stays visible for every project kind**, and starts explaining itself.
Hiding it would trade one confusion for a worse one — a systematic review whose
diagram is missing at submission.

---

## Week 1 — Research questions become a thing you can create

- New section `questions`, group **Collect**, ordered before Find papers.
- Server actions: add, edit, reorder, delete. Zod-validated, RLS-scoped, owner
  or admin to write, any member to read.
- Keywords per question, since that is what the ranking consumes
  (`search/actions.ts:70`).
- `search-client.tsx`'s hint becomes a link to the new section instead of an
  instruction with no destination.
- The overview's next-action gains a step: no questions → "Say what this review
  is about", ahead of "Find your first papers".

**Done when:** a project with two questions ranks a search against them, the
`Matched:` chip renders real keywords, and the suggestion chips appear.

## Week 2 — The paper is always one click away

- One `<SourceLinks>` component: DOI → `doi.org`, arXiv → `arxiv.org/abs`,
  open-access PDF, in that order of preference, each with an accessible name
  naming the paper rather than repeating "link".
- Used in: screening (beside the title), library (replacing the dead
  `" · open access"` text at `:184`), the reader, the evidence table, and the
  queue.
- When there is no identifier at all, say so once rather than rendering nothing.

**Done when:** a Playwright test asserts every rendered paper title in those
five surfaces is accompanied by a resolvable outbound link or an explicit "no
link on record".

## Week 3 — Screening you can see

- Split view: a scrollable queue list beside the current paper. Title, year,
  status, and whether someone else has already decided it.
- Clicking a row screens that paper. The keyboard path is untouched.
- Sort: newest, oldest, most cited, unscreened-first. Filter by assignee.
- Skip writes `SCREENING` through the existing `recordDecision`, with the same
  optimistic path as Include and Exclude, and moves the paper to the end.
- The list collapses below `lg`, where the one-at-a-time flow is correct.

**Done when:** the Pipeline's SCREENING bar is non-zero after skipping, a
skipped paper survives a reload, and the queue list shows 300 rows without the
page becoming a horizontal scroll.

## Week 4 — Screens that say what they are for

- Protocol → **"Extraction form"** in nav and headings; one-line purpose:
  *"The set of things you record about every paper, so twenty papers can be
  compared instead of read twice."* Moves to the **Collect** group, after
  Questions, because it shapes what you collect.
- Its internal copy stops calling fields "questions" (`protocol-client.tsx:46,
  68,102`).
- The extraction form is offered from the Questions screen: each research
  question can suggest fields.
- PRISMA gains a plain-language header — what the diagram is, who asks for it,
  what to do with it — and a **Copy the numbers** action producing the counts as
  text for a methods section.
- For non-systematic-review kinds, the existing dashed note explains *why* it is
  there rather than only that it may be incomplete.

**Done when:** every project section's purpose sentence is asserted present, and
PRISMA's numbers can be copied without a screenshot.

## Week 5 — One path into an encrypted conversation

- Messages absorbs the whole setup. Locked → the passphrase field renders **in
  place**, not on `/unlock`. No project key → a "Set up encryption for this
  project" button provisions the epoch **in place**, using the same action the
  keys page calls.
- On first key, a `general` channel is created automatically, so the end of
  setup is a place to type rather than another empty form.
- "Encryption" → **"Keys & members"**, and it becomes the page for the rare
  administrative jobs — rotation, removal, safety numbers — rather than a stop
  on the way to a conversation.
- The recovery passphrase gets a re-download at enrolment and a plain statement
  of what is lost without it.

**Done when:** a member with an account and no unlocked identity sends their
first message in a project without leaving `/projects/[id]/messages`.

## Week 6 — A front door that explains the building

- The landing page covers the **whole** workflow, in the order it happens:
  find → screen → read → extract → reconcile → synthesise → write. Six steps,
  not the current three.
- It says who it is for, in the first screen of text: research teams running
  systematic reviews, and students running a thesis on the same machinery.
- It defines the four words the app then uses everywhere — systematic review,
  protocol, screening, PRISMA — in a sentence each, at the point a visitor first
  meets them rather than in a sidebar six screens later.
- The encryption claim is stated plainly and honestly: messages and extractions
  are sealed in the browser, we cannot read them, and the recovery passphrase
  cannot be reset by us because of it.
- A `/about` route carries the longer version, so the landing page can stay
  short and a curious visitor still has somewhere to go without an account.
- The teams line stops leading with billing.

**Done when:** a visitor who has never seen the app can say, from the landing
page alone, what it does, who it is for, and what happens to their data — and
an axe pass is clean at both viewports.

---

## Definition of done

- The six checkable meanings in §2 each have a passing Playwright assertion.
- `questions` has a writer, and `matched` is non-empty in a project that has
  questions.
- No control writes a status different from the one its label names.
- `pnpm verify --e2e` green; axe clean at both viewports; CI-parity run with no
  flakes.

## Not in this phase

- **The end-user guide.** Deferred deliberately, at the user's instruction, to
  after the product is finished. Writing it now would document six screens that
  weeks 1–6 are about to change, and a guide that contradicts the app is worse
  than none. (`docs/USING-PORCUPINE.md` is a local-setup document for running
  the thing, not the guide meant here.) What this phase owes it is the §2
  requirement that every screen states its own purpose — a product that
  explains itself needs a shorter guide.
- Bulk screening (select many, exclude with one reason). Wanted, and it needs
  the list from week 3 to exist first.
- Full-text PDF ingestion. The reader takes what the import gave it.
- Live message delivery. Still deferred on Realtime per-subscriber cost.
- A visual redesign of the remaining screens. This phase is comprehension; the
  editorial palette and the primitives are not the problem.

## The thing this plan cannot verify

Whether a person who has never seen the app can run a screening session without
being told anything. Every check above is written by the person who built the
thing being checked, which is the one bias no test suite removes. The four-
person afternoon trial owed since Phase 2c is still owed, and this phase adds
five more screens' worth of assumptions to it.
