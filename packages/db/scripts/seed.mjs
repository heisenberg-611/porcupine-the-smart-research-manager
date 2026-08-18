#!/usr/bin/env node
/**
 * A realistic project you can actually sign into and look at.
 *
 * Two reasons this exists, and the second is the one that matters.
 *
 *   1. Phase 2's exit criteria left "page-level render for 300 papers × 20
 *      fields" unmeasured. The DATABASE was measured (51–56 ms against a 3 s
 *      budget); nothing measured the page. That gap cannot be closed without a
 *      300-paper project to load, and there was no way to make one.
 *
 *   2. You cannot judge a user interface against an empty database. Every
 *      screen in this app looks calm with four rows in it. The evidence table
 *      with 300 rows and 20 columns, the reconciliation queue with a real
 *      backlog, a library where screening is half-finished — those are the
 *      screens people actually use, and until now nobody had seen them.
 *
 * Deliberately NOT wired into `db:reset` or the test suite. Tests build their
 * own fixtures, precisely so a test never depends on seed data that someone
 * later edits. This is for looking at the app with your eyes.
 *
 *   pnpm db:seed                     demo@test.dev, 300 papers
 *   pnpm db:seed --email me@x.dev    attach it to your own account
 *   pnpm db:seed --papers 40         smaller, for a quick look
 *
 * Re-running replaces the seeded projects and leaves everything else alone.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const envPath = join(root, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const CONN =
  process.env.DIRECT_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const OWNER_EMAIL = arg("email", "demo@test.dev");
const PAPERS = Number(arg("papers", 300));
const FIELDS = Number(arg("fields", 20));

/**
 * By default the corpus is spread across every screening status, because that
 * is what a review in progress looks like and it is the only way to see
 * whether the library's status column is legible.
 *
 * `--all-extracted` puts every paper in EXTRACTED instead, which is the shape
 * the Phase 2 budget is stated in — "300 papers × 20 fields" means 300 ROWS in
 * the evidence table, and a realistic spread gives it 126. A measurement has
 * to be taken against the thing that was promised.
 */
const ALL_EXTRACTED = process.argv.includes("--all-extracted");

// Slugs are the handle for idempotency: re-running deletes exactly these two
// projects and nothing else, so the script is safe against a database you have
// been using.
const SR_SLUG = "demo-systematic-review";
const THESIS_SLUG = "demo-thesis";

// ── Deterministic pseudo-randomness ─────────────────────────────────────────
//
// Seeded, so two runs produce the same corpus. A measurement taken against
// data that changes between runs is not a measurement, and "the evidence table
// felt slower today" is not a thing anyone should have to debug.
let rngState = 0x2f6e2b1;
function rnd() {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return ((rngState >>> 0) % 1_000_000) / 1_000_000;
}
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

// ── Enough vocabulary for titles that read like papers ──────────────────────
const ADJ = [
  "Randomised",
  "Prospective",
  "Retrospective",
  "Multicentre",
  "Double-blind",
  "Cluster-randomised",
  "Population-based",
  "Longitudinal",
];
const TOPIC = [
  "sleep restriction",
  "circadian misalignment",
  "shift work",
  "melatonin supplementation",
  "cognitive behavioural therapy for insomnia",
  "napping",
  "blue-light exposure",
  "sleep-disordered breathing",
];
const OUTCOME = [
  "working memory",
  "sustained attention",
  "episodic recall",
  "executive function",
  "processing speed",
  "reaction time",
  "verbal fluency",
];
const VENUE = [
  "Sleep",
  "Journal of Sleep Research",
  "SLEEP Medicine",
  "Chronobiology International",
  "Nature and Science of Sleep",
  "Behavioral Sleep Medicine",
];
const SURNAME = [
  "Okonkwo",
  "Nakamura",
  "Ferreira",
  "Lindqvist",
  "Achterberg",
  "Ramaswamy",
  "Bergström",
  "Delacroix",
  "Halvorsen",
  "Mwangi",
  "Ivanova",
  "Papadopoulos",
];

/**
 * Twenty extraction fields spanning every type the protocol builder offers.
 *
 * Not padding: the point of a 20-column table is that the column types are
 * mixed, because that is what makes the evidence table hard to lay out. A
 * table of twenty numbers is a spreadsheet; a table with quotes, multi-selects
 * and long text in it is the actual design problem.
 */
const FIELD_SPECS = [
  ["sample_size", "Sample size", "NUMBER", null],
  [
    "design",
    "Study design",
    "ENUM",
    ["RCT", "cohort", "case-control", "cross-sectional"],
  ],
  ["population", "Population", "TEXT", null],
  ["mean_age", "Mean age (years)", "NUMBER", null],
  ["female_pct", "Female (%)", "NUMBER", null],
  ["country", "Country", "TEXT", null],
  ["intervention", "Intervention", "TEXT", null],
  ["comparator", "Comparator", "TEXT", null],
  ["duration_weeks", "Duration (weeks)", "NUMBER", null],
  ["primary_outcome", "Primary outcome", "QUOTE", null],
  [
    "outcome_measures",
    "Outcome measures",
    "MULTI_ENUM",
    ["PVT", "n-back", "MMSE", "TMT-B", "RAVLT"],
  ],
  [
    "effect_direction",
    "Effect direction",
    "ENUM",
    ["favours intervention", "favours control", "no difference"],
  ],
  ["effect_size", "Effect size", "TEXT", null],
  ["blinded", "Outcome assessment blinded", "BOOLEAN", null],
  ["preregistered", "Pre-registered", "BOOLEAN", null],
  ["attrition_pct", "Attrition (%)", "NUMBER", null],
  ["funding", "Funding source", "TEXT", null],
  ["conflicts", "Declared conflicts", "LONG_TEXT", null],
  ["risk_of_bias", "Risk of bias", "ENUM", ["low", "some concerns", "high"]],
  ["notes", "Reviewer notes", "LONG_TEXT", null],
];

// ── Auth ────────────────────────────────────────────────────────────────────

/**
 * The owner has to be a real auth user, not just a `public.users` row: the
 * whole point is that you can sign in as them and look at the result. The
 * profile row appears via the `on_auth_user_created` trigger.
 */
async function ensureAuthUser(email) {
  if (!SERVICE_KEY) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set, so no account can be created.\n" +
        "  It is in .env; if that file is missing, run `supabase status` and copy it.",
    );
  }

  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  const found = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers },
  );
  if (found.ok) {
    const body = await found.json();
    const hit = body.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
  }

  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!created.ok) {
    throw new Error(`could not create ${email}: ${await created.text()}`);
  }
  return (await created.json()).id;
}

/**
 * A second and third member, so the collaborative screens have something in
 * them. These need no auth rows — nobody signs in as them — but they do need
 * profiles, because the UI shows who extracted what.
 */
async function ensureProfile(client, email, displayName) {
  const { rows } = await client.query(
    `insert into users (id, email, display_name, created_at, updated_at)
     values (gen_random_uuid(), $1, $2, now(), now())
     on conflict (email) do update set display_name = excluded.display_name
     returning id`,
    [email, displayName],
  );
  return rows[0].id;
}

// ── The corpus ──────────────────────────────────────────────────────────────

function makeWorks(n) {
  const works = [];
  for (let i = 0; i < n; i++) {
    const title = `${pick(ADJ)} trial of ${pick(TOPIC)} and ${pick(OUTCOME)}`;
    const authors = Array.from({ length: 2 + Math.floor(rnd() * 4) }, () => ({
      name: `${pick(SURNAME)}, ${String.fromCharCode(65 + Math.floor(rnd() * 26))}.`,
    }));
    works.push({
      id: randomUUID(),
      // Matches upsert_work()'s normalisation closely enough to be realistic;
      // uniqueness comes from the index suffix, since a random generator will
      // otherwise produce collisions in a 300-title corpus drawn from 8 topics.
      titleNorm: `${title.toLowerCase().replace(/[^a-z0-9 ]/g, "")} ${i}`,
      title,
      abstract:
        `We examined whether ${pick(TOPIC)} affects ${pick(OUTCOME)}. ` +
        `Participants completed a battery of tasks under controlled conditions ` +
        `over ${2 + Math.floor(rnd() * 10)} weeks. Effects were assessed against ` +
        `a matched comparator, and the primary outcome was specified in advance. ` +
        `Findings are discussed with reference to the wider literature.`,
      authors: JSON.stringify(authors),
      venue: pick(VENUE),
      year: 2012 + Math.floor(rnd() * 14),
      doi: `10.1000/Porcupine.demo.${i}`,
    });
  }
  return works;
}

/**
 * A realistic answer for a field, or null for a hole.
 *
 * Holes are the point of the `coverage` parameter: a fully-populated evidence
 * table is not what a review in progress looks like, and "an incomplete row
 * looks incomplete" is a claim about the UI that needs incomplete rows to be
 * visible at all.
 */
function answerFor(spec, coverage) {
  const [key, , type, options] = spec;
  if (rnd() > coverage) return null;

  switch (type) {
    case "NUMBER": {
      if (key === "female_pct" || key === "attrition_pct")
        return Math.floor(rnd() * 60) + 10;
      if (key === "mean_age") return Math.floor(rnd() * 45) + 20;
      if (key === "duration_weeks") return Math.floor(rnd() * 24) + 1;
      // Deliberately wide: a sort that treats these as strings puts 1000 next
      // to 100, which is the bug the evidence table's numeric sort exists for.
      return Math.floor(rnd() * 2000) + 8;
    }
    case "BOOLEAN":
      return rnd() > 0.45;
    case "ENUM":
      return pick(options);
    case "MULTI_ENUM": {
      const n = 1 + Math.floor(rnd() * 2);
      return [...new Set(Array.from({ length: n }, () => pick(options)))];
    }
    case "QUOTE":
      return `the primary outcome was ${pick(OUTCOME)}`;
    case "LONG_TEXT":
      return rnd() > 0.5
        ? "None declared."
        : `The authors report funding from a commercial sponsor with no role in analysis. ${pick(OUTCOME)} was assessed independently.`;
    default: {
      if (key === "country")
        return pick(["Norway", "Japan", "Brazil", "Kenya", "Germany", "Canada"]);
      if (key === "funding")
        return pick(["National grant", "University", "Industry", "Not reported"]);
      if (key === "effect_size") return `d = ${(rnd() * 1.4).toFixed(2)}`;
      if (key === "population") return `adults with ${pick(TOPIC)}`;
      if (key === "intervention") return pick(TOPIC);
      if (key === "comparator") return pick(["placebo", "usual care", "waitlist"]);
      return pick(OUTCOME);
    }
  }
}

// ── Bulk insert helper ──────────────────────────────────────────────────────
//
// 5,000+ values one INSERT at a time is a minute of round-trips. Multi-row
// VALUES in chunks keeps the whole seed under a couple of seconds.
async function insertMany(client, sql, rows, columns, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const tuples = slice.map((row) => {
      const placeholders = columns.map((col) => {
        params.push(typeof col === "function" ? col(row) : row[col]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(`${sql} values ${tuples.join(", ")}`, params);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const ownerId = await ensureAuthUser(OWNER_EMAIL);

  const client = new pg.Client({ connectionString: CONN });
  await client.connect();

  try {
    await client.query("begin");

    // Wait for the profile trigger. It is synchronous, but the auth API call
    // is not, and a missing profile here produces an FK error that names a
    // constraint rather than the cause.
    const { rows: profile } = await client.query("select id from users where id = $1", [
      ownerId,
    ]);
    if (profile.length === 0) {
      throw new Error(`auth user ${OWNER_EMAIL} exists but has no profile row`);
    }

    const bobId = await ensureProfile(client, "bob.demo@test.dev", "Bob Ferreira");
    const carolId = await ensureProfile(client, "carol.demo@test.dev", "Carol Nakamura");

    // Idempotency, in two parts, because the corpus is not owned by the
    // project. Deleting the projects takes their extractions, values, anchors
    // and project_works — but `works` is a SHARED table by design (the same
    // paper in two projects is one row), so the seeded works survive and the
    // second run collides on `works_doi_key`. The DOI prefix is the handle:
    // every seeded work carries `10.1000/Porcupine.demo.N`, which is inside
    // the 10.1000 test range and cannot collide with a real record.
    await client.query("delete from projects where slug = any($1)", [
      [SR_SLUG, THESIS_SLUG],
    ]);
    await client.query("delete from works where doi like '10.1000/Porcupine.demo.%'");

    const srId = randomUUID();
    const thesisId = randomUUID();

    await insertMany(
      client,
      `insert into projects (id, slug, title, description, kind, created_by, created_at, updated_at)`,
      [
        {
          id: srId,
          slug: SR_SLUG,
          title: "Sleep restriction and cognitive performance",
          description:
            "A systematic review of controlled studies, 2012–2025. Seeded demonstration data.",
          kind: "SYSTEMATIC_REVIEW",
        },
        {
          id: thesisId,
          slug: THESIS_SLUG,
          title: "Chapter 2 — reading list",
          description:
            "A thesis project, where the review machinery is deliberately out of the way.",
          kind: "THESIS",
        },
      ],
      [
        "id",
        "slug",
        "title",
        "description",
        "kind",
        () => ownerId,
        () => new Date(),
        () => new Date(),
      ],
    );

    const memberships = [
      { p: srId, u: ownerId, r: "OWNER" },
      { p: srId, u: bobId, r: "CONTRIBUTOR" },
      { p: srId, u: carolId, r: "ADMIN" },
      { p: thesisId, u: ownerId, r: "OWNER" },
    ];
    await insertMany(
      client,
      `insert into project_members (id, project_id, user_id, access_role, joined_at, created_at, updated_at)`,
      memberships,
      [
        () => randomUUID(),
        "p",
        "u",
        "r",
        () => new Date(),
        () => new Date(),
        () => new Date(),
      ],
    );

    // ── Corpus ──────────────────────────────────────────────────────────────
    const works = makeWorks(PAPERS + 25);
    await insertMany(
      client,
      `insert into works (id, title_norm, title, abstract, authors, venue, published_year, doi, updated_at)`,
      works,
      [
        "id",
        "titleNorm",
        "title",
        "abstract",
        "authors",
        "venue",
        "year",
        "doi",
        () => new Date(),
      ],
    );

    const srWorks = works.slice(0, PAPERS);
    const thesisWorks = works.slice(PAPERS);

    /**
     * Screening spread across the real statuses, in the proportions a review
     * in progress actually has: most included papers already extracted, a
     * meaningful exclusion pile with reasons, and a tail still unscreened.
     * A library where every row says INCLUDED tells you nothing about whether
     * the status column is legible.
     */
    // `exclude_reason` is text constrained to this controlled list, not an
    // enum — the codes live in `@Porcupine/shared` (EXCLUSION_REASONS) because
    // PRISMA renders them. Weighted rather than uniform: real reviews exclude
    // overwhelmingly on population and design, and a flat distribution would
    // make the PRISMA breakdown look like noise.
    const EXCLUDE_REASONS = [
      "WRONG_POPULATION",
      "WRONG_POPULATION",
      "WRONG_POPULATION",
      "WRONG_STUDY_DESIGN",
      "WRONG_STUDY_DESIGN",
      "WRONG_OUTCOME",
      "WRONG_INTERVENTION",
      "NOT_PEER_REVIEWED",
      "LANGUAGE",
      "DUPLICATE",
      "FULL_TEXT_UNAVAILABLE",
    ];
    const excludeReason = () => pick(EXCLUDE_REASONS);

    const projectWorks = srWorks.map((w, i) => {
      const roll = ALL_EXTRACTED ? 0 : i / srWorks.length;
      let status;
      if (roll < 0.42) status = "EXTRACTED";
      else if (roll < 0.55) status = "INCLUDED";
      else if (roll < 0.62) status = "READING";
      else if (roll < 0.85) status = "EXCLUDED";
      else if (roll < 0.92) status = "SCREENING";
      else status = "IDENTIFIED";

      return {
        id: randomUUID(),
        work: w.id,
        status,
        reason: status === "EXCLUDED" ? excludeReason() : null,
        // A third of the unscreened tail is assigned, so /queue is not empty
        // and the assignment feature is visible at all.
        assignee: status === "IDENTIFIED" && rnd() > 0.66 ? ownerId : null,
      };
    });

    await insertMany(
      client,
      `insert into project_works (id, project_id, work_id, added_by, source, screen_status, exclude_reason, assignee_id, created_at, updated_at)`,
      projectWorks,
      [
        "id",
        () => srId,
        "work",
        () => ownerId,
        () => "search",
        "status",
        "reason",
        "assignee",
        () => new Date(),
        () => new Date(),
      ],
    );

    await insertMany(
      client,
      `insert into project_works (id, project_id, work_id, added_by, source, screen_status, created_at, updated_at)`,
      thesisWorks,
      [
        () => randomUUID(),
        () => thesisId,
        "id",
        () => ownerId,
        () => "import",
        () => "INCLUDED",
        () => new Date(),
        () => new Date(),
      ],
    );

    // ── Questions and protocol ──────────────────────────────────────────────
    const questions = [
      "How large were the studies, and in whom?",
      "What was done, and compared against what?",
      "What effect on cognition was found?",
      "How much should we trust each study?",
    ].map((text, i) => ({ id: randomUUID(), order: i, text }));

    await insertMany(
      client,
      `insert into questions (id, project_id, "order", text, created_at, updated_at)`,
      questions,
      ["id", () => srId, "order", "text", () => new Date(), () => new Date()],
    );

    const protocolId = randomUUID();
    await client.query(
      `insert into protocols (id, project_id, name, version, is_active, created_at, updated_at)
       values ($1, $2, 'Data extraction form', 1, true, now(), now())`,
      [protocolId, srId],
    );

    const specs = FIELD_SPECS.slice(0, FIELDS);
    const fields = specs.map((spec, i) => ({
      id: randomUUID(),
      key: spec[0],
      label: spec[1],
      type: spec[2],
      options: spec[3] ? JSON.stringify(spec[3]) : null,
      order: i,
      // Spread across the four questions, so the evidence page's "no evidence
      // for this question" warning has real grouping behind it.
      question: questions[Math.min(3, Math.floor(i / (specs.length / 4)))].id,
      requiresAnchor: spec[2] === "QUOTE",
    }));

    await insertMany(
      client,
      `insert into protocol_fields (id, protocol_id, key, label, type, options, required, requires_anchor, "order", question_id)`,
      fields,
      [
        "id",
        () => protocolId,
        "key",
        "label",
        "type",
        "options",
        (r) => r.key === "sample_size",
        "requiresAnchor",
        "order",
        "question",
      ],
    );

    // ── Extractions ─────────────────────────────────────────────────────────
    const extractable = projectWorks.filter((pw) => pw.status === "EXTRACTED");

    const extractions = [];
    const values = [];
    const anchors = [];

    for (const [i, pw] of extractable.entries()) {
      // Every twelfth paper gets a SECOND, independent extraction by Bob, so
      // the reconciliation queue has a genuine backlog rather than one row.
      const extractors = i % 12 === 0 ? [ownerId, bobId] : [ownerId];

      for (const extractor of extractors) {
        const extractionId = randomUUID();
        extractions.push({
          id: extractionId,
          pw: pw.id,
          extractor,
          status: "SUBMITTED",
        });

        for (const field of fields) {
          const spec = specs[field.order];
          const answer = answerFor(spec, 0.86);
          if (answer === null) continue;

          let anchorId = null;
          if (field.type === "QUOTE") {
            anchorId = randomUUID();
            anchors.push({ id: anchorId, quote: String(answer) });
          }

          values.push({
            id: randomUUID(),
            extraction: extractionId,
            field: field.id,
            value: JSON.stringify(answer),
            text: Array.isArray(answer) ? answer.join(", ") : String(answer),
            anchor: anchorId,
          });
        }
      }
    }

    await insertMany(
      client,
      `insert into anchors (id, project_id, quote, status, created_at, updated_at)`,
      anchors,
      ["id", () => srId, "quote", () => "OK", () => new Date(), () => new Date()],
    );

    // DRAFT first, then values, then submit. The week-1 freeze trigger refuses
    // a value written against a SUBMITTED extraction — it caught two pgTAP
    // fixtures doing exactly this, and it catches this script too.
    await insertMany(
      client,
      `insert into extractions (id, project_id, project_work_id, protocol_id, extractor_id, status, created_at, updated_at)`,
      extractions,
      [
        "id",
        () => srId,
        "pw",
        () => protocolId,
        "extractor",
        () => "DRAFT",
        () => new Date(),
        () => new Date(),
      ],
    );

    await insertMany(
      client,
      `insert into extraction_values (id, project_id, extraction_id, field_id, value, value_text, anchor_id, created_at, updated_at)`,
      values,
      [
        "id",
        () => srId,
        "extraction",
        "field",
        "value",
        "text",
        "anchor",
        () => new Date(),
        () => new Date(),
      ],
      400,
    );

    await client.query(
      `update extractions set status = 'SUBMITTED', submitted_at = now()
       where project_id = $1`,
      [srId],
    );

    await client.query("commit");

    const dualCount = extractable.filter((_, i) => i % 12 === 0).length;

    console.log(`
  Seeded.

  Sign in as   ${OWNER_EMAIL}
  Code         http://localhost:54324   (Mailpit — the email never leaves this machine)

  Systematic review    /projects/${srId}
    ${PAPERS} papers · ${extractions.length} extractions · ${values.length} answers
    ${fields.length} protocol fields across ${questions.length} questions
    ${dualCount} papers extracted twice, waiting in Reconcile
    ${projectWorks.filter((p) => p.status === "IDENTIFIED").length} still unscreened

  Thesis               /projects/${thesisId}
    ${thesisWorks.length} papers, and none of the review machinery

  Re-run to reset both. Nothing else in the database is touched.
`);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`\n\x1b[31m✗ seed failed:\x1b[0m ${err.message}\n`);
  process.exit(1);
});
