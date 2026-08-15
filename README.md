# Porcupine

Research and thesis management for people who read a lot of papers: find them,
decide which are in, read and annotate them, extract the same questions from
every one, and get a table you can defend.

Local-first, no AI, and deliberately opinionated about provenance — an answer
that came from a paper is linked to the sentence it came from, and the database
refuses the ones that are not.

---

## Running it

You need **Docker Desktop running** and Node 24. Everything else is in the repo.

```bash
pnpm install
pnpm db:start     # first run pulls images; a few minutes
pnpm db:reset     # apply the schema
pnpm dev          # http://localhost:3000
```

**Signing in has no password.** You type an email and the app sends a six-digit
code — which, locally, never leaves your machine. It goes to Mailpit at
**http://localhost:54324**. If you are waiting for it in a real inbox, that is
why nothing arrived.

Want something to look at rather than an empty database?

```bash
pnpm db:seed      # a 300-paper review and a small thesis, both real enough to use
```

Then sign in as `demo@test.dev`, code in Mailpit.

|                                |                        |
| ------------------------------ | ---------------------- |
| The app                        | http://localhost:3000  |
| Mailpit — every email it sends | http://localhost:54324 |
| Supabase Studio — the database | http://localhost:54323 |

**`docs/USING-PORCUPINE.md` is the guide to actually using it**, including an
honest list of what is not built yet. Start there if you are lost in the app
rather than in the code.

---

## The one idea that explains the rest

**A project has a _kind_, and the kind changes which features exist.** Not
cosmetically — whole screens appear or refuse to work.

A PhD student reading forty books should not be made to run a clinical review
process, and a review team wants every guardrail. Same schema, two products.
`capabilities(kind)` in `packages/shared` is the single place that decides, and
every screen reads it rather than testing `kind` inline.

If a screen tells you a feature is for systematic reviews, your project is a
thesis. The kind cannot be changed afterwards.

---

## Working on it

```bash
pnpm verify           # everything except the browser suite
pnpm verify --e2e     # including it — run this before pushing UI changes
```

`pnpm verify` is the gate, and it is the same set of checks CI runs. CI's only
unique contribution is a clean Linux checkout with a frozen lockfile; if it
fails and this passed, suspect the difference rather than the check.

Two things that have caught real bugs here and are worth knowing about:

- **A rule is not done until it has been seen to fail.** Drop the trigger, watch
  the tests go red, put it back. Several rules in this repo were written,
  believed, and later found to be enforcing nothing.
- **Every `count(*) = 0` gets a mutation check** — the same query with RLS off,
  which must return rows. Otherwise the assertion passes against an empty table
  and proves nothing.

Run the e2e suite the way CI does before trusting it:

```bash
CI=1 pnpm --filter @porcupine/web exec playwright test
```

Two workers and two retries, which is where cross-test interference shows up
and a single-worker run does not.

---

## Layout

| Path                  | What                                                          |
| --------------------- | ------------------------------------------------------------- |
| `apps/web`            | The Next.js app — every screen                                |
| `apps/relay`          | The Durable Object that shuffles encrypted collaboration ops  |
| `packages/shared`     | Capabilities, protocol types, agreement/κ — no I/O            |
| `packages/discovery`  | The five bibliographic providers, dedupe, and SSRF-safe fetch |
| `packages/anchoring`  | Turning a selected passage into something that survives edits |
| `packages/crypto`     | Key handling                                                  |
| `packages/db`         | Prisma schema, migrations bridge, and the pgTAP suite         |
| `supabase/migrations` | What actually ran, RLS included                               |
| `docs/`               | Plans, decisions, and the build log                           |

**Prisma owns the schema; `supabase/migrations/` owns what ran.** RLS is
hand-written SQL. `prisma migrate dev` must never touch this database — it does
not know about policies and would drop them.

---

## Where the reasoning lives

`docs/BUILD-LOG.md` is the most useful document in the repository. It records
what was built, what it cost, and where reality diverged from the plan —
including the mistakes, which are the part worth reading. Where it contradicts a
numbered plan document, the plan is stale.

| Document                           | What                                                        |
| ---------------------------------- | ----------------------------------------------------------- |
| `docs/USING-PORCUPINE.md`          | How to use the app, and what is not built                   |
| `docs/BUILD-LOG.md`                | What happened, honestly                                     |
| `docs/00-product-plan.md`          | The roadmap                                                 |
| `docs/01-data-model.md`            | Every table and why it is shaped that way                   |
| `docs/02-security-and-e2ee.md`     | Threat model, encryption tiers, SSRF                        |
| `docs/04-conflicts-and-hazards.md` | The hard problems                                           |
| `docs/05-resolution-plan.md`       | The numbered risks (R-02, R-06 …) cited throughout the code |
| `docs/06`–`09`                     | Phase build plans, including the current usability phase    |
| `docs/adr/`                        | Architecture decisions                                      |
