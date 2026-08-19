<div align="center">

<img src="apps/web/src/app/logo.png" alt="" width="96" height="96">

# porcupineResearch

**Every paper you read, in one defensible pile.**

A literature review, from the first search to the finished evidence table.
For teams running a systematic review that has to be reproducible, and for
students running a thesis search on the same machinery.

[**Use it →** porcupineresearch.me](https://porcupineresearch.me) · [How it works](https://porcupineresearch.me/about) · [Security](https://porcupineresearch.me/security) · [Guides](https://porcupineresearch.me/guides)

[![Licence: Apache 2.0](https://img.shields.io/badge/licence-Apache%202.0-2f6f5e)](LICENSE)
&nbsp;[![Next.js 16](https://img.shields.io/badge/Next.js-16-1c1a17)](https://nextjs.org)
&nbsp;[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-1c1a17)](https://supabase.com)
&nbsp;[![No AI](https://img.shields.io/badge/AI-none%2C%20deliberately-9c2f26)](#what-it-does)

</div>

---

## Two ways to run it, both free

**Hosted — [porcupineresearch.me](https://porcupineresearch.me).** Sign in and you
have a project in about a minute. No install, no Docker, no database to look
after. It runs on Vercel with a managed Supabase database and is maintained by
Dhrubojyoti Saha, who wrote it. Use this unless you have a reason not to.

**Your own copy — [the install below](#running-your-own-copy).** Same code, same
features, pointed at a Postgres database you control. Worth doing when the
corpus itself is sensitive — which paper set a lab is reading can leak a
research direction before publication — or when your institution requires
research data to stay on its own infrastructure.

Nothing is held back from the second one. The only thing that does not cross
between them is a project: everyone working on a review has to be on the same
instance.

---

## What it does

Local-first about your data, and deliberately opinionated about provenance: an
answer that came from a paper is linked to the sentence it came from, and the
database refuses the ones that are not.

| Stage       | What happens                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ask**     | Write the research questions. Everything after is ranked against them.                                                                               |
| **Find**    | One query across OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar. Duplicates merged before you see them. Or paste BibTeX/RIS.             |
| **Screen**  | Include or exclude, one paper at a time, from the keyboard. A systematic review cannot exclude without a reason — enforced by a trigger, not a form. |
| **Read**    | Highlight and annotate. Quotes stay anchored to the passage even when the text around them moves.                                                    |
| **Extract** | The same protocol questions of every paper. Quote-typed questions cannot be typed into — only filled by selecting the passage.                       |
| **Report**  | Evidence table, CSV and Excel export, PRISMA diagram, dual extraction with Cohen's κ. All drawn from decisions you already recorded.                 |

**There is no AI in it, and there is not going to be.** No automatic screening,
no relevance model choosing papers, no generated summaries. A screening decision
nobody can account for is worth less than no decision at all, because it looks
like one. See [ADR-003](docs/adr) and the
[build notes](https://porcupineresearch.me/blog).

**Messages and LaTeX sources are end-to-end encrypted;** your library,
highlights and extracted answers are not, because they have to be sorted,
counted and turned into a PRISMA diagram. The
[security page](https://porcupineresearch.me/security) states which is which
rather than claiming the stronger thing.

---

## The one idea that explains the rest

**A project has a _kind_, and the kind changes which features exist.** Not
cosmetically — whole screens appear or refuse to work.

A PhD student reading forty books should not be made to run a clinical review
process, and a review team wants every guardrail. Same schema, two products.
`capabilities(kind)` in `packages/shared` is the single place that decides, and
every screen reads it rather than testing `kind` inline.

If a screen tells you a feature is for systematic reviews, your project is a
thesis. **The kind cannot be changed afterwards.**

---

## Built with

| Layer     | What                                                                             |
| --------- | -------------------------------------------------------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5.9                     |
| Styling   | Tailwind CSS v4 — design tokens in `apps/web/src/app/globals.css`, no UI library |
| Database  | PostgreSQL via Supabase, with row-level security on every table                  |
| ORM       | Prisma 7 — schema authority; RLS policies are hand-written SQL                   |
| Auth      | Supabase Auth: passwordless email OTP, plus Google OAuth                         |
| Crypto    | libsodium — XChaCha20-Poly1305, Argon2id, X25519/Ed25519                         |
| Tests     | Playwright (Chromium + a phone viewport), axe-core, pgTAP, Vitest                |
| Hosting   | Vercel, with Supabase managed Postgres                                           |
| Monorepo  | pnpm workspaces, Node 24                                                         |

---

## Running your own copy

You need **Docker Desktop running** and **Node 24**. Everything else is in the
repository.

```bash
git clone https://github.com/heisenberg-611/porcupine-the-smart-research-manager.git
cd porcupine-the-smart-research-manager

pnpm install
pnpm db:start     # Postgres + Auth in containers; the first run pulls images
pnpm db:reset     # apply the schema and the RLS policies
pnpm dev          # http://localhost:3000
```

If everything fails and nothing loads, Docker is not running. That is the cause
almost every time.

**Signing in has no password.** You type an email and the app sends a six-digit
code — which, locally, never leaves your machine. It goes to Mailpit at
**http://localhost:54324**. If you are waiting for it in a real inbox, that is
why nothing arrived. Any address works locally; nothing is verified.

Want something to look at rather than an empty database?

```bash
pnpm db:seed      # a 300-paper systematic review and a small thesis
```

Then sign in as `demo@test.dev`, code in Mailpit. The review has a 20-question
protocol, a half-screened library, papers waiting in reconciliation and 5,553
answers — which is the shape these screens are designed for, and nothing like
what four rows of test data looks like.

|                                |                        |
| ------------------------------ | ---------------------- |
| The app                        | http://localhost:3000  |
| Mailpit — every email it sends | http://localhost:54324 |
| Supabase Studio — the database | http://localhost:54323 |

### Pointing it at your own database

`pnpm db:start` runs Postgres in Docker for you, which is the right default for
development. For anything you intend to keep — a departmental server, your own
Supabase project, a managed Postgres elsewhere — copy `.env.example` to
`.env.local` and set five variables:

```bash
# The pooled connection Prisma uses at runtime (Supabase: port 6543).
DATABASE_URL="postgresql://…"

# A DIRECT connection for migrations (port 5432). `migrate deploy` issues
# SET session_replication_role, which cannot go through a transaction pooler.
DIRECT_URL="postgresql://…"

NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_…"

# SERVER ONLY. Bypasses RLS entirely. ESLint and a CI grep both fail the build
# if it ever appears in a client-reachable module.
SUPABASE_SECRET_KEY="sb_secret_…"
```

Then apply the schema to it:

```bash
pnpm exec supabase link --project-ref <your-project-ref>
pnpm exec supabase db push
```

Two things that will bite otherwise:

- **`prisma migrate dev` must never touch this database.** Prisma owns the
  schema; `supabase/migrations/` owns what actually ran, and it contains
  hand-written RLS policies Prisma does not know about and would drop.
- **Connect the app as a role RLS applies to.** The secret key bypasses every
  policy in the database. It exists for one thing — provisioning a test user in
  the e2e setup — and belongs nowhere else.

Google Docs/Drive/Sheets integration and the collaboration relay are optional;
`.env.example` documents their variables and the app works without them.

### One thing that needs a scheduler

Deleting an account waits 30 days before it is carried out, and **this app has
no background worker** — so something has to call the endpoint that does it:

```bash
curl https://your-instance/tasks/purge-accounts \
     -H "Authorization: Bearer $CRON_SECRET"
```

On the hosted service that is a daily Vercel Cron. On your own copy it is your
cron, or you, and until it runs an account that asked to be deleted is still
waiting.

Generate the secret with `openssl rand -base64 32`. It **must** be called
`CRON_SECRET`: Vercel attaches the `Authorization` header to a cron invocation
automatically, and only for a variable with that exact name — `vercel.json`
cannot set a header itself, so any other name means every scheduled run fails
with a 401 nobody sees. Leave it unset and the endpoint refuses everything,
which is the right failure but is still a failure.

Somebody who wants their account gone immediately can tick the box on the
account page, which skips the wait entirely and needs no cron at all.

---

## Working on it

```bash
pnpm verify           # everything except the browser suite
pnpm verify --e2e     # including it — run this before pushing UI changes
```

`pnpm verify` is the gate, and it is the same set of checks CI runs: typecheck,
lint, format, the grep guards, unit tests, the pgTAP RLS suite, a production
build and Playwright. CI's only unique contribution is a clean Linux checkout
with a frozen lockfile; if it fails and this passed, suspect the difference
rather than the check.

Two things that have caught real bugs here and are worth knowing about:

- **A rule is not done until it has been seen to fail.** Drop the trigger, watch
  the tests go red, put it back. Several rules in this repo were written,
  believed, and later found to be enforcing nothing.
- **Every `count(*) = 0` gets a mutation check** — the same query with RLS off,
  which must return rows. Otherwise the assertion passes against an empty table
  and proves nothing.

Run the e2e suite the way CI does before trusting it:

```bash
CI=1 pnpm --filter @Porcupine/web exec playwright test
```

Two workers and two retries, which is where cross-test interference shows up
and a single-worker run does not.

---

## Layout

| Path                  | What                                                          |
| --------------------- | ------------------------------------------------------------- |
| `apps/web`            | The Next.js app — every screen                                |
| `packages/shared`     | Capabilities, protocol types, agreement/κ — no I/O            |
| `packages/discovery`  | The five bibliographic providers, dedupe, and SSRF-safe fetch |
| `packages/anchoring`  | Turning a selected passage into something that survives edits |
| `packages/crypto`     | Key handling                                                  |
| `packages/db`         | Prisma schema, migrations bridge, and the pgTAP suite         |
| `supabase/migrations` | What actually ran, RLS included                               |
| `docs/`               | Plans, decisions, and the build log                           |

Inside `apps/web/src/app`, the `(public)` route group is everything you can read
without an account — the landing page and the twelve pages linked from its
footer. It is a route group, so it changes no URLs; it exists so those pages
share a header, a footer and a light palette regardless of the theme a
signed-in reader has chosen.

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
| `docs/06`–`10`                     | Phase build plans, including the current phase              |
| `docs/adr/`                        | Architecture decisions                                      |

---

## Licence

**Apache License 2.0** — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

Use it, fork it, run it for a department, change it, or build something else on
top of it. Apache 2.0 rather than MIT for the two things MIT leaves out: an
explicit patent grant from every contributor, and a requirement that modified
files say they were modified — which matters for a tool whose output is meant
to be defensible. If someone hands you an evidence table produced by a fork,
you should be able to find out what the fork changed.

The licence covers the software. It does not cover the bibliographic data the
app retrieves from OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar,
each of which has its own terms, and it does not cover anything you put into
your own instance. That is yours.

---

<div align="center">

Designed and built by **Dhrubojyoti Saha** ·
[dhrubojyoti.saha@g.bracu.ac.bd](mailto:dhrubojyoti.saha@g.bracu.ac.bd)

</div>
