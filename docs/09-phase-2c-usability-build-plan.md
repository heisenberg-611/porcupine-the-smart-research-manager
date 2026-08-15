# Phase 2c — Usability · Build Plan

**Inserted ahead of Phase 3, deliberately.** The roadmap in `00-product-plan.md`
says Phase 3 is the crypto envelope and messaging. That order was right when it
was written and is wrong now: the app has four phases of capability behind a
front end that a person who knows what it does still gets lost in. Building
messaging on top of that adds a screen nobody can find to a set of screens
nobody can find.

Everything below is grounded in the code as it stands on 2026-08-15 and in the
numbers from the measurement of the same date. File references are given so
each claim can be checked rather than taken.

---

## 1. What is actually wrong

Not the visual design. `apps/web/src/app/globals.css` is a considered
editorial palette — warm paper, a serif for display, a real type scale,
elevation from rules rather than shadow, and every pair checked against WCAG
2.2 AA before it was written down (lowest ratio 5.05:1). The a11y gate runs
axe on desktop and a phone viewport on every merge and is green.

**The problem is structure: where am I, what do I do next, and did that work.**
Six findings, each verified.

### 1.1 The project hub is a rack of nine identical buttons

`apps/web/src/app/projects/[id]/page.tsx` renders, in one flat wrapping row:

> Library · Find papers · Protocol · Evidence · Reconcile · PRISMA · Progress ·
> Screen · Import

Nine destinations, identical treatment, no grouping, and an order that is
neither the workflow's nor alphabetical. It is the first screen inside a
project and it answers no question a person arrives with.

It carries **no state**. Not how many papers are in the library, not whether a
protocol exists, not how much screening is left, not whether anything is
waiting to be reconciled. Every number the app has computed is one click away
and none of it is here.

It is also the only page in the app that hand-rolls its own header instead of
using `PageHeader`, and it hand-rolls `ButtonLink` nine times with a copied
class string. Fourteen of the eighteen routes use the shared primitives; the
most important one does not.

And its copy is stale: *"Email invitations arrive in Phase 1."*

### 1.2 Clicks that lead to a refusal

The hub offers **Reconcile** regardless of project kind. In a THESIS it is
unavailable by design (R-06), so the sequence is: click, wait for a page load,
read a paragraph explaining that this feature is for systematic reviews, go
back.

*(PRISMA looks like the same case and is not — the diagram renders for every
kind, and `prismaDiagram` only controls a note saying exclusion reasons were
optional. Week 1's first draft hid it on the strength of the flag's name and
removed a working feature from three project kinds. Read what the destination
does, not what the capability is called.)*

`capabilities()` is consulted by five pages — `projects`, `reconcile`,
`reconcile/[workId]`, `prisma`, `protocol`, `screen` — and by neither
`progress` nor the hub that links to all of them. The gate is real and it is
enforced at the destination instead of at the door.

### 1.3 Nothing happens when you click

**There are zero `loading.tsx` and zero `error.tsx` files across all eighteen
routes.**

Every page is server-rendered on demand. The measurement puts time-to-first-byte
at 240–248 ms on a laptop against a local database. For a quarter of a second —
much longer on a real network — a click produces no visible change at all. No
skeleton, no progress, nothing. The app feels broken in exactly the way a fast
app with no pending state always feels broken.

And when a server render fails, the user gets Next.js's default error page
rather than anything of ours, on a product whose stated principle is that
failures are loud and name what failed.

### 1.4 The header forgets which project you are in

`apps/web/src/components/app-header.tsx` carries two links: *Projects* and *My
queue*. Once you are inside a project, the header does not name it, does not
link to any of its screens, and has no active state — `aria-current` is
deliberately absent so the header can stay a server component.

So moving from Evidence to Screen means going back to the hub first. Every
lateral move in a nine-screen workspace costs an extra navigation.

### 1.5 There is no overlay layer

> **Corrected 2026-08-15, during week 2.** The heading below originally read
> "…so there is no feedback layer", and the inference was wrong. Every mutation
> in the app already has pending state, every failure is already announced
> through `Banner`, which carries `role="alert"`, and the one destructive
> action that matters — deleting a protocol field — already has a two-step
> inline confirmation with a written argument for why it is *not* a modal. The
> audit read "no dialog primitive" and concluded "no feedback", which is a
> different claim and an unchecked one. The paragraph below is what is
> actually true; the rest of week 2 was rescoped around it.

`apps/web/src/components/ui.tsx` has thirteen primitives: `Button`, `Field`,
`Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Hidden`, `TableScroll`,
`Card`, `EmptyState`, `PageHeader`, `ButtonLink`, `Banner`.

There is no dialog, menu, combobox, tooltip, tabs, popover or toast. Its own
header says so: *"Radix arrives when we need a real dialog, menu, or combobox."*

The consequence is that every confirmation, every transient "saved", every
overflow menu is either absent or hand-built per page. Six client components
hand-roll something dialog-shaped or `aria-live`-shaped, independently.

### 1.6 The flagship screen is a horizontal scroll

The evidence table renders **50 rows × 23 columns**. Horizontal scrolling
inside a bordered region is the primary interaction on the screen the whole
extraction pipeline exists to produce. There is no column pinning, hiding,
reordering or resizing; no way to see one paper's full row without scrolling
sideways through twenty columns; and no way to save a view you have set up.

### 1.7 The one thing that is *not* wrong

**Speed.** 276–284 ms to largest contentful paint against a 3 s budget, worst
of seven runs 352 ms. Roughly 190 ms of that is server render and framework
rather than the query.

This matters for planning: *no part of this phase has to be traded against
performance*. There is an order of magnitude of headroom. The one number to
respect is **510 KB of HTML per evidence page**, which is comfortable over
loopback and is not comfortable over mobile data.

---

## 2. What "intuitive" has to mean, in checkable terms

Vibes do not survive contact with a build plan. Each of these is a claim
something can be written against.

1. **Every screen answers "where am I" without scrolling.** Project name and
   current section are visible at all times.
2. **Every screen answers "what now" without a click.** The primary next action
   is on the page, named, and reflects actual state.
3. **No link leads to a refusal.** A destination unavailable for this project
   kind is absent or visibly disabled with the reason attached — never a live
   link to an apology.
4. **Every navigation and every mutation shows a pending state within 100 ms**,
   and its outcome is announced to assistive technology.
5. **Nothing destructive happens without confirmation, and nothing reversible
   asks for one.**
6. **Every number on a summary screen is a link to the thing it counts.**
7. **The a11y gate stays green** — axe, desktop and mobile, zero violations,
   and keyboard reachability for every new control.

---

## 3. Decisions taken up front

**Radix primitives, unstyled — not shadcn/ui.** The gap is dialog, menu,
combobox, tooltip, tabs and popover, and the reason to take a dependency for
those is focus management, escape/typeahead behaviour and ARIA wiring, which is
where hand-rolled overlays go wrong. shadcn/ui would bring its own token names,
its own `cn`, and a second visual vocabulary alongside a palette that was
designed on purpose and already passes AA — the merge cost would exceed the
benefit. Radix gives the semantics and none of the paint.

**Restructure, do not repaint.** No new palette, no new type scale, no webfont.
Anything in this phase that changes `globals.css` needs an argument in the PR.

**The header becomes a client component.** `aria-current` needs the pathname.
The cost is a small client bundle for the shell; the benefit is that every
screen knows where it is. That trade was declined once, on the reasoning that
"the project context is already stated by every page's own heading" — which the
audit shows is not enough.

**Nothing in this phase changes the database.** Usability is not an excuse to
reopen schema decisions, and a phase that touches migrations stops being
reviewable as a UI phase.

---

## Week 1 — The shell

*Goal: you always know where you are, what state the project is in, and what to
do next.*

**1.1 The hub becomes a workspace overview.** Replace the button rack with
sections in workflow order — *Collect · Screen · Extract · Synthesise* — each
carrying its own live count read from the data already available:

> **Screen** · 24 of 300 unscreened, 68 excluded → [Continue screening]

Every count links to the filtered view it counts. The primary action for the
project's current state is promoted; the rest stay secondary. Use `PageHeader`
and `ButtonLink` like every other page.

**1.2 Capability gating at the door.** The hub asks `capabilities(project.kind)`
and omits or disables what this project cannot do, with the reason on the
disabled control rather than behind it. `progress` gains the same check. No
route may be linked from a surface that has not asked.

**1.3 Project-scoped navigation.** The header, inside a project, carries the
project name and its sections with an active state. Sections the project kind
does not have never appear.

**1.4 `loading.tsx` for every route.** Skeletons that match the shape of what is
coming — a table skeleton for tables, not a spinner. This is the single highest
ratio of perceived improvement to effort in the phase.

**1.5 `error.tsx` for every route,** in the house style: name what failed to
load and offer a retry. The existing `must()` helper already produces good
messages; nothing currently renders them well.

**1.6 Fix the stale copy** on the hub, and audit every other page for text that
refers to a phase rather than to what the app does.

---

## Week 2 — Feedback

*Goal: every action visibly happens, and its outcome is announced.*

**Rescoped on contact with the code.** 2.1–2.4 below were written from the
audit's finding 1.5 and were largely already done; what survived is recorded
here rather than quietly dropped.

**2.1 ~~Add Radix~~ — deferred, deliberately.** Nothing in the app currently
needs a dialog, menu or combobox. The one confirmation that exists is a
two-step inline pair of buttons with a comment explaining that a modal needs a
focus trap and escape handling to be correct and that inline is *harder to
trigger by accident than a dialog whose default button is OK*. That reasoning
is sound. Adding a dependency because a plan written a day earlier said so
would contradict this plan's own decisions section. Radix arrives with the
first screen that genuinely needs an overlay — the evidence table's column
manager in week 3 is the likely candidate.

**2.2 ~~One announcement channel~~ — already there.** Failures go through
`Banner`, which carries `role="alert"`; the pages that report progress wrap it
in `aria-live="polite"`. Six components do this consistently through a shared
primitive rather than improvising, which is what the audit assumed.

**2.3 ~~Pending state on every mutation~~ — already there.** Every form and
every action disables its control and names what it is doing ("Sending…",
"Creating…", "Adding…", "Recording…"). Hand-rolled with `useState` rather than
`useFormStatus`, which is why the audit's grep missed it. Working code is not a
refactoring target.

**2.4 ~~Confirmation for destructive actions~~ — already there** for the one
that warrants it. `deleteAnnotation` has none and does not need one: a
highlight is small, obvious when it goes, and trivially remade.

**2.5 Optimistic screening — done.** ✅ The one item that was real. See below.

---

## Week 3 — The evidence table

*Goal: the screen the whole pipeline exists to produce becomes usable at 300 × 20.*

**3.1 Column management** — ✅ *hide and show, via `?cols=`; desktop only.*
Pinning, reordering and resizing are not built. The choice lives in the URL
rather than per person, so a narrowed table is a link you can send; the cost is
that it does not survive to the next visit, which needs a table this phase does
not touch.

**3.2 ~~Sticky header~~ — attempted and reverted.** A sticky `thead` does not
work inside `TableScroll`: `overflow-x: auto` makes the div a scroll container
on *both* axes, so `top: 4.5rem` pins the header 4.5 rem below the container's
own top, permanently over the first two rows. Doing it properly means giving
the table its own vertical scroll, which changes how the whole page scrolls and
is too large to smuggle in beside a column chooser.

**3.3 ~~A row detail panel~~ — built, then reverted.** Any client component
placed inside a table row made the cells to its right unclickable on a 390 px
viewport. Reproduced with a Radix dialog, with a bare button, in two different
columns, with and without min-height and negative margins, and with one
instance rather than fifty. See the BUILD-LOG; it is the same unexplained
narrow-layout interaction that keeps the column chooser desktop-only.

**3.4 Saved views.** A filter + sort + column set with a name. Reviews are
returned to across months; reconstructing a view by hand each time is the tax
this screen currently charges.

**3.5 Payload** — ✅ partly. The `title` attribute on every cell is gone: it
duplicated the full text of all 1,150 cells in the HTML, and a tooltip was
never reachable by keyboard anyway. Hiding columns is the larger lever and is
now user-controlled.

---

## Week 4 — The working screens

*Goal: the two screens people spend hours in stop costing a mouse.*

**4.1 ~~Keyboard-first screening~~ — done in week 2.** ✅ Moved forward because
it targets the same surface as 2.5 and shares its tests: doing them apart would
have meant two rounds of the same end-to-end setup. `i` / `e` / `s`, `1`–`9`
for exclusion reasons, `?` for the list, and a visible hint rather than a
hidden feature.

**4.2 The extraction form gets a spine.** ✅ Field progress ("12 of 20
answered"), an unsaved-changes warning, and every empty required field named at
once with a link to each. *Not* "visible autosave state" — the form does not
autosave and that is defensible, so what it needed was to say the work is only
in the browser, not to invent a background save.

**4.3 ~~Reader and extraction side by side~~ — already built.** The premise was
wrong: the extraction form has shown the paper and the questions side by side
since Phase 2, with the source sticky while the questions scroll, and the file
says why in its header. Written into this plan without checking, like several
of week 2's items.

**4.4 The queue explains itself.** ✅ — though not for the stated reason, which
was also wrong: the queue already showed the project, the status and the due
date, sorted soonest-first with overdue in red. What it had was no way to *act*
— every row named a paper and linked only to its project — and no empty state
at all.

---

## Week 5 — Arrival

*Goal: the first ten minutes stop being the hardest ten minutes.*

**5.1 The project-kind choice, explained where it is made.** It is the single
most consequential decision in the product, it is irreversible, and it is
currently a dropdown. It becomes a choice with its consequences visible.

**5.2 Empty states that teach.** `EmptyState` already exists and is used
eighteen times; the copy should carry the workflow, since an empty project is
where most people decide whether this is worth learning.

**5.3 A first-run path.** After creating a project: find papers → screen →
protocol → extract, as a visible sequence that marks itself done, dismissible
and never modal.

**5.4 A root `README.md`.** There is none. `docs/USING-PORCUPINE.md` exists and
nothing points at it from where someone lands.

---

## Definition of done

- [ ] Every route has `loading.tsx` and `error.tsx`
- [ ] No link anywhere leads to a capability refusal — asserted by a test that
      walks every hub link in a THESIS project and follows it
- [ ] The hub shows live counts, each linking to what it counts
- [ ] Project context and active section visible on every project screen
- [ ] Every mutation shows pending state and announces its outcome
- [ ] Evidence: columns can be pinned, hidden and reordered; a row can be read
      without horizontal scrolling; views can be saved
- [ ] Screening is completable end to end without a mouse
- [ ] axe green on desktop and mobile, zero violations, as now
- [ ] `pnpm --filter @porcupine/web measure` re-run and recorded; evidence-page
      HTML measurably smaller
- [ ] The BUILD-LOG entry exists, with its Problems section non-empty

## Not in this phase

Visual redesign. A component library beyond Radix primitives. Anything
requiring a migration. Real-time collaboration. The PDF pipeline — the reader
shows abstracts until R2 exists, and no amount of layout work changes that.

## The measurement this phase cannot make

None of the above proves the app is usable. It proves specific defects are
gone. **Four people and one afternoon** is still the only test that answers the
actual question, and it is still not scheduled — carried forward from Phase 1
and Phase 2b, where it was also the last open item.
