#!/usr/bin/env node
/**
 * Does Supabase Realtime actually enforce our RLS policies?
 *
 * NOT part of `pnpm verify`, and it cannot be: CI starts Supabase with
 * `-x realtime` (.github/workflows/ci.yml), so there is no websocket endpoint
 * in the merge path. Run it by hand against a full local stack:
 *
 *     pnpm db:start          # the whole stack, no -x
 *     node apps/web/scripts/check-realtime-rls.mjs
 *
 * It lives under apps/web because that is where `@supabase/supabase-js` is a
 * dependency, and Node resolves imports from the importing FILE upwards — so
 * this runs from any working directory.
 *
 * WHY IT EXISTS. `project_activity` is the only table in the
 * `supabase_realtime` publication, and every browser in a project subscribes
 * to it. The design deliberately assumes as little as possible about
 * Realtime's authorization — the table holds a project id, a word and a
 * timestamp, so the worst an unauthorised subscriber could learn is that some
 * project had some kind of activity. But "we assume nothing" is a claim worth
 * checking rather than asserting, and this checks it.
 *
 * It subscribes as two users — one a member of the project, one not — writes
 * a row that trips the trigger, and reports what each of them received. Last
 * run: the member received the event, the non-member received nothing, and
 * the payload contained only { project_id, kind, at }.
 *
 * If this ever reports the non-member receiving something, the fix is NOT to
 * add a filter in the browser. It is that the table must stay content-free,
 * which it already is, and the finding belongs in docs/BUILD-LOG.md.
 *
 * The JWTs below are minted directly with the local stack's fixed dev secret
 * rather than going through the sign-in flow, because the point of this script
 * is the subscription, not the auth. Those keys are public and local-only.
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

const URL = "http://127.0.0.1:54321";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SECRET = "super-secret-jwt-token-with-at-least-32-characters-long";
const PROJECT = "11110000-0000-0000-0000-0000000000a1";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(sub) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    sub,
    role: "authenticated",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(`${head}.${body}`)
    .digest("base64url");
  return `${head}.${body}.${sig}`;
}

function watcher(name, sub) {
  const client = createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${jwt(sub)}` } },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  client.realtime.setAuth(jwt(sub));

  const got = [];
  return new Promise((resolve) => {
    const ch = client
      .channel(`probe:${name}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_activity",
          filter: `project_id=eq.${PROJECT}`,
        },
        (payload) => got.push(payload),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") resolve({ name, got, client, ch });
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          resolve({ name, got, client, ch, status });
      });
  });
}

const psqlSetup = (sql) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_Porcupine-the-smart-research-manager",
      "psql",
      "-U",
      "postgres",
      "-q",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );

// Seeded and torn down here, so the script leaves the database as it found it
// and can be run twice in a row.
psqlSetup(`
  delete from projects where slug = 'rt-probe';
  delete from works where title_norm = 'rt probe paper';
  delete from users where email in ('rt-probe-member@test.dev', 'rt-probe-stranger@test.dev');
  insert into users (id, email, display_name, created_at, updated_at) values
    ('11110000-0000-0000-0000-000000000001', 'rt-probe-member@test.dev',   'Member',   now(), now()),
    ('11110000-0000-0000-0000-000000000009', 'rt-probe-stranger@test.dev', 'Stranger', now(), now());
  insert into projects (id, slug, title, kind, created_by, created_at, updated_at) values
    ('${PROJECT}', 'rt-probe', 'Realtime probe', 'THESIS',
     '11110000-0000-0000-0000-000000000001', now(), now());
  insert into project_members (id, project_id, user_id, access_role, joined_at, created_at, updated_at) values
    (gen_random_uuid(), '${PROJECT}', '11110000-0000-0000-0000-000000000001', 'OWNER', now(), now(), now());
  insert into works (id, title_norm, title, authors, updated_at) values
    ('11110000-0000-0000-0000-0000000000d1', 'rt probe paper', 'RT probe paper', '[]'::jsonb, now());
`);

const alice = await watcher("member", "11110000-0000-0000-0000-000000000001");
const mallory = await watcher("stranger", "11110000-0000-0000-0000-000000000009");
console.log("subscribed:", alice.status ?? "ok", mallory.status ?? "ok");

// Bump activity via a real write, as the app would.
const psql = (sql) =>
  execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_Porcupine-the-smart-research-manager",
      "psql",
      "-U",
      "postgres",
      "-q",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );

psql(`insert into project_works (id, project_id, work_id, added_by, source, screen_status, created_at, updated_at)
      values (gen_random_uuid(), '${PROJECT}', '11110000-0000-0000-0000-0000000000d1',
              '11110000-0000-0000-0000-000000000001', 'SEARCH', 'IDENTIFIED', now(), now())`);

await new Promise((r) => setTimeout(r, 3000));

console.log(`member received:   ${alice.got.length}`);
console.log(`stranger received: ${mallory.got.length}`);
const ok = alice.got.length > 0 && mallory.got.length === 0;
console.log(
  ok
    ? "RESULT: member notified, non-member not. RLS is enforced over realtime."
    : "RESULT: UNEXPECTED — see the counts above, and read the note at the top.",
);
if (alice.got.length) console.log("payload:", JSON.stringify(alice.got[0].new));

psqlSetup(`
  delete from projects where slug = 'rt-probe';
  delete from works where title_norm = 'rt probe paper';
  delete from users where email in ('rt-probe-member@test.dev', 'rt-probe-stranger@test.dev');
`);
process.exit(ok ? 0 : 1);
