#!/usr/bin/env node
/**
 * pgTAP runner + the concurrency half of R-02.
 *
 * The .sql suites prove policy logic inside one session. They cannot prove
 * the thing that actually worries us: that a transaction-local claim never
 * survives onto a pooled connection and leaks into someone else's request.
 * That needs many real connections hammering one pool, which is what
 * `concurrencyTest` below does.
 *
 * Merge gate. Must stay under 90s (docs/05-resolution-plan.md R-02, B-03).
 */
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";

import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

const envPath = join(root, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const CONN =
  process.env.TEST_DATABASE_URL ??
  process.env.DIRECT_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CONCURRENCY = Number(process.env.RLS_TEST_CONCURRENCY ?? 32);
const ROUNDS = Number(process.env.RLS_TEST_ROUNDS ?? 25);

let failed = false;
const started = Date.now();

function heading(text) {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

// ── Ensure pgTAP is installed ───────────────────────────────────────────────
async function ensurePgTap() {
  const client = new pg.Client({ connectionString: CONN });
  await client.connect();
  try {
    await client.query("create extension if not exists pgtap");
  } finally {
    await client.end();
  }
}

// ── Run each .sql suite through psql ────────────────────────────────────────
function runSqlSuites() {
  const dir = join(here, "..", "test");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    heading(`▸ ${file}`);
    try {
      const out = execFileSync(
        "psql",
        [
          "--no-psqlrc",
          "--quiet",
          "--no-align",
          "--tuples-only",
          "-v",
          "ON_ERROR_STOP=1",
          CONN,
          "-f",
          join(dir, file),
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      process.stdout.write(out);

      // A failing assertion is the obvious case. The rest of these are the
      // ways a suite can report success while proving nothing:
      //
      //   * a plan mismatch means assertions did not run — the file may have
      //     stopped early, or been edited without updating plan(N);
      //   * "Looks like you failed" is pgTAP's own summary line;
      //   * no `ok` lines at all means the file produced no assertions.
      //
      // Grepping only for `not ok` misses every one of them, which is how a
      // suite ends up green while silently testing nothing.
      const problems = [];
      if (/^not ok/m.test(out)) problems.push("failing assertions");

      const planMismatch = /# Looks like you planned (\d+) tests? but ran (\d+)/.exec(
        out,
      );
      if (planMismatch) {
        problems.push(
          `plan mismatch — planned ${planMismatch[1]}, ran ${planMismatch[2]} ` +
            `(assertions did not run; a passing count here would be meaningless)`,
        );
      }

      if (/# Looks like you failed/.test(out)) problems.push("pgTAP reported failures");
      if (!/^ok \d+/m.test(out)) problems.push("no assertions produced any output");

      if (problems.length > 0) {
        failed = true;
        console.error(`\x1b[31m✗ ${file}: ${problems.join("; ")}\x1b[0m`);
      }
    } catch (err) {
      failed = true;
      console.error(`\x1b[31m✗ ${file} errored\x1b[0m`);
      if (err.stdout) process.stdout.write(err.stdout);
      if (err.stderr) process.stderr.write(err.stderr);
    }
  }
}

// ── The concurrency test the .sql suites structurally cannot do ─────────────
//
// Many clients share one pool. Each opens a transaction, sets its own claim,
// reads, and commits — in a loop, interleaved. If a claim ever survives a
// commit onto a connection another client then picks up, some client reads
// rows belonging to a different tenant. That is the exact failure C-02
// described, and it is silent: no error, just wrong data.
async function concurrencyTest() {
  heading("▸ rls_no_cross_tenant (concurrent, pooled)");

  const setup = new pg.Client({ connectionString: CONN });
  await setup.connect();

  const tenants = [];
  try {
    await setup.query("begin");
    for (let i = 0; i < CONCURRENCY; i++) {
      const suffix = String(i).padStart(4, "0");
      const userId = `dddddddd-0000-0000-0000-${suffix}00000000`.slice(0, 36);
      const projectId = `eeeeeeee-0000-0000-0000-${suffix}00000000`.slice(0, 36);
      const slug = `concurrency-${suffix}`;
      await setup.query(
        `insert into users (id, email, display_name, created_at, updated_at)
         values ($1, $2, $3, now(), now())`,
        [userId, `conc-${suffix}@test.dev`, `Conc ${suffix}`],
      );
      await setup.query(
        `insert into projects (id, slug, title, created_by, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [projectId, slug, `Project ${suffix}`, userId],
      );
      await setup.query(
        `insert into project_members
           (id, project_id, user_id, access_role, joined_at, created_at, updated_at)
         values (gen_random_uuid(), $1, $2, 'OWNER', now(), now(), now())`,
        [projectId, userId],
      );
      tenants.push({ userId, slug });
    }
    await setup.query("commit");
  } catch (err) {
    await setup.query("rollback").catch(() => {});
    await setup.end();
    throw err;
  }

  // A pool deliberately smaller than the client count, so connections are
  // reused aggressively. Reuse is the condition under which a leak appears.
  const pool = new pg.Pool({
    connectionString: CONN,
    max: Math.max(4, Math.floor(CONCURRENCY / 4)),
  });

  let leaks = 0;
  let checks = 0;

  try {
    await Promise.all(
      tenants.map(async (tenant) => {
        for (let round = 0; round < ROUNDS; round++) {
          const client = await pool.connect();
          try {
            await client.query("begin");
            await client.query("set local role Porcupine_app");
            await client.query(`select set_config('request.jwt.claims', $1, true)`, [
              JSON.stringify({ sub: tenant.userId }),
            ]);
            const { rows } = await client.query("select slug from projects");
            checks++;
            const wrong = rows.filter((r) => r.slug !== tenant.slug);
            if (wrong.length > 0 || rows.length !== 1) {
              leaks++;
              console.error(
                `\x1b[31m  LEAK: ${tenant.slug} saw ${rows.length} row(s): ` +
                  `${rows.map((r) => r.slug).join(", ")}\x1b[0m`,
              );
            }
            await client.query("commit");
          } catch (err) {
            await client.query("rollback").catch(() => {});
            throw err;
          } finally {
            client.release();
          }
        }
      }),
    );

    // The other half of the claim: after a transaction commits, a *new*
    // transaction on a reused connection must see nothing until it sets its
    // own claim. This is rls_claim_does_not_survive_txn.
    let survivors = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query("set local role Porcupine_app");
          await client.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: tenants[0].userId }),
          ]);
          await client.query("select slug from projects");
          await client.query("commit");

          // Same connection, new transaction, deliberately no claim.
          await client.query("begin");
          await client.query("set local role Porcupine_app");
          const { rows } = await client.query("select slug from projects");
          if (rows.length !== 0) survivors++;
          await client.query("commit");
        } finally {
          client.release();
        }
      }),
    );

    const total = CONCURRENCY * ROUNDS;
    console.log(`  ${checks}/${total} scoped reads across ${CONCURRENCY} clients`);

    if (leaks === 0) {
      console.log(`  \x1b[32mok\x1b[0m - no cross-tenant leakage under concurrency`);
    } else {
      failed = true;
      console.error(`  \x1b[31mnot ok\x1b[0m - ${leaks} cross-tenant leak(s)`);
    }

    if (survivors === 0) {
      console.log(
        `  \x1b[32mok\x1b[0m - claim does not survive commit onto a pooled connection`,
      );
    } else {
      failed = true;
      console.error(`  \x1b[31mnot ok\x1b[0m - claim survived in ${survivors} case(s)`);
    }
  } finally {
    await pool.end();
    // Fixtures are committed, so clean them up explicitly.
    await setup.query(`delete from projects where slug like 'concurrency-%'`);
    await setup.query(`delete from users where email like 'conc-%@test.dev'`);
    await setup.end();
  }
}

// ── R-22: is the token bucket actually atomic across invocations? ───────────
//
// The whole argument for putting the bucket in Postgres is that `for update`
// serializes competing Lambda invocations, where a per-process counter would
// not. That claim is untestable from a single session — which is exactly the
// kind of claim that turns out to be false.
//
// So: N concurrent clients hammer one bucket that holds exactly N/2 tokens.
// Precisely N/2 takes must be granted. Any other number means the
// read-modify-write interleaved, which is the bug this design exists to
// avoid — and the symptom in production would be a silent ban from arXiv.
async function rateLimitConcurrencyTest() {
  heading("▸ rate_limit_take (concurrent, R-22)");

  const CLIENTS = 24;
  const CAPACITY = CLIENTS / 2;
  const key = `test:concurrency:${Date.now()}`;

  const pool = new pg.Pool({ connectionString: CONN, max: 8 });

  try {
    const results = await Promise.all(
      Array.from({ length: CLIENTS }, async () => {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query("set local role Porcupine_app");
          const { rows } = await client.query(
            "select public.rate_limit_take($1, $2, $3) as wait",
            [key, CAPACITY, 0.0001], // refill slow enough to be irrelevant here
          );
          await client.query("commit");
          return Number(rows[0].wait);
        } finally {
          client.release();
        }
      }),
    );

    const granted = results.filter((wait) => wait === 0).length;

    if (granted === CAPACITY) {
      console.log(
        `  \x1b[32mok\x1b[0m - exactly ${granted}/${CLIENTS} takes granted ` +
          `against a bucket of ${CAPACITY}`,
      );
    } else {
      failed = true;
      console.error(
        `  \x1b[31mnot ok\x1b[0m - ${granted} takes granted against a bucket ` +
          `of ${CAPACITY}: the read-modify-write is not atomic`,
      );
    }
  } finally {
    await pool.end();
    const cleanup = new pg.Client({ connectionString: CONN });
    await cleanup.connect();
    await cleanup.query("delete from rate_limit_buckets where key like 'test:%'");
    await cleanup.end();
  }
}

// ── Lost updates on a screening decision ────────────────────────────────────
//
// The Phase 1 exit trial found four members silently overwriting each other's
// screening decisions: 20 decisions produced 7 screened papers, and every
// member's UI reported success. Last writer won, and a supervisor's exclusion
// could be reversed by a colleague's include with no trace.
//
// The fix is a compare-and-swap over a `select … for update`. This test is
// what keeps it fixed. It is here rather than in the browser trial because
// the trial needs a 300-paper corpus from OpenAlex and takes minutes; this
// runs in the merge path in well under a second.
//
// N clients read the SAME paper's status and then each try to decide on it.
// Exactly one may succeed. Any other number is a lost update.
async function screeningConcurrencyTest() {
  heading("▸ screening decisions (concurrent, lost-update guard)");

  const CLIENTS = 12;
  const setup = new pg.Client({ connectionString: CONN });
  await setup.connect();

  const ids = {
    user: "dddddddd-1111-1111-1111-111111111111",
    project: "eeeeeeee-1111-1111-1111-111111111111",
    work: "ffffffff-1111-1111-1111-111111111111",
    projectWork: "aaaaaaaa-1111-1111-1111-111111111111",
  };

  const pool = new pg.Pool({ connectionString: CONN, max: 6 });

  try {
    await setup.query(
      `insert into users (id, email, display_name, created_at, updated_at)
       values ($1, 'screenrace@test.dev', 'Racer', now(), now())`,
      [ids.user],
    );
    await setup.query(
      `insert into projects (id, slug, title, kind, created_by, created_at, updated_at)
       values ($1, 'screen-race', 'Screen Race', 'THESIS', $2, now(), now())`,
      [ids.project, ids.user],
    );
    await setup.query(
      `insert into project_members
         (id, project_id, user_id, access_role, joined_at, created_at, updated_at)
       values (gen_random_uuid(), $1, $2, 'OWNER', now(), now(), now())`,
      [ids.project, ids.user],
    );
    await setup.query(
      `insert into works (id, title_norm, title, authors, updated_at)
       values ($1, 'race paper', 'Race Paper', '[]'::jsonb, now())`,
      [ids.work],
    );
    await setup.query(
      `insert into project_works
         (id, project_id, work_id, added_by, source, created_at, updated_at)
       values ($1, $2, $3, $4, 'search', now(), now())`,
      [ids.projectWork, ids.project, ids.work, ids.user],
    );

    // Every client saw IDENTIFIED, which is the situation four screeners
    // sharing one queue are actually in.
    const SEEN = "IDENTIFIED";

    const outcomes = await Promise.all(
      Array.from({ length: CLIENTS }, async () => {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await client.query("set local role Porcupine_app");
          await client.query(`select set_config('request.jwt.claims', $1, true)`, [
            JSON.stringify({ sub: ids.user }),
          ]);

          // The application's read: locking, so the read-modify-write is
          // serialized rather than merely checked.
          const { rows } = await client.query(
            "select screen_status from project_works where id = $1 for update",
            [ids.projectWork],
          );

          const current = rows[0]?.screen_status;
          if (current !== SEEN) {
            await client.query("commit");
            return "refused";
          }

          await client.query(
            "update project_works set screen_status = 'INCLUDED' where id = $1",
            [ids.projectWork],
          );
          await client.query(
            `insert into screening_decisions
               (id, project_id, project_work_id, decided_by, from_status, to_status, created_at)
             values (gen_random_uuid(), $1, $2, $3, $4, 'INCLUDED', now())`,
            [ids.project, ids.projectWork, ids.user, SEEN],
          );
          await client.query("commit");
          return "recorded";
        } catch (err) {
          await client.query("rollback").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      }),
    );

    const recorded = outcomes.filter((o) => o === "recorded").length;
    const refused = outcomes.filter((o) => o === "refused").length;

    const { rows: logged } = await setup.query(
      "select count(*)::int as n from screening_decisions where project_work_id = $1",
      [ids.projectWork],
    );

    if (recorded === 1 && logged[0].n === 1) {
      console.log(
        `  \x1b[32mok\x1b[0m - 1 of ${CLIENTS} decisions recorded, ${refused} refused ` +
          `(no lost update)`,
      );
    } else {
      failed = true;
      console.error(
        `  \x1b[31mnot ok\x1b[0m - ${recorded} decisions recorded and ${logged[0].n} logged ` +
          `for one paper; concurrent screeners are overwriting each other`,
      );
    }

    // And the refusals have to be real: if every client refused, the test
    // would "pass" the overwrite check while proving nothing happened at all.
    if (refused === CLIENTS - 1) {
      console.log(
        `  \x1b[32mok\x1b[0m - every other client was refused, not silently dropped`,
      );
    } else {
      failed = true;
      console.error(
        `  \x1b[31mnot ok\x1b[0m - ${refused} refusals, expected ${CLIENTS - 1}`,
      );
    }
  } finally {
    await pool.end();
    await setup.query("delete from projects where slug = 'screen-race'");
    await setup.query("delete from works where title_norm = 'race paper'");
    await setup.query("delete from users where email = 'screenrace@test.dev'");
    await setup.end();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
try {
  await ensurePgTap();
  runSqlSuites();
  await concurrencyTest();
  await rateLimitConcurrencyTest();
  await screeningConcurrencyTest();
} catch (err) {
  failed = true;
  console.error(`\x1b[31m✗ runner error:\x1b[0m ${err.message}`);
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
heading(
  failed
    ? `\x1b[31m✗ RLS suite FAILED in ${elapsed}s\x1b[0m`
    : `\x1b[32m✓ RLS suite passed in ${elapsed}s\x1b[0m`,
);

if (Number(elapsed) > 90) {
  console.error(
    `\x1b[33m⚠ suite took ${elapsed}s — the 90s budget exists because a slow ` +
      `gate gets skipped, and a skipped gate is worthless (B-03)\x1b[0m`,
  );
}

process.exit(failed ? 1 : 0);
