import { execFileSync } from "node:child_process";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { goto } from "./ready";

/**
 * Phase 3 week 3b — two people, one encrypted conversation.
 *
 * The point of two browsers is that a single-browser round trip proves almost
 * nothing: the same code encrypted and decrypted it, so a bug that used the
 * wrong key consistently would pass. Two members, two unlocks, two identities,
 * one project key sealed separately to each — that is the chain.
 *
 * And the assertion that matters most is not "Bob can read it". It is that
 * what the DATABASE holds is not the text.
 */

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.dev`;
}

async function fetchOtp(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch("http://127.0.0.1:54324/api/v1/messages?limit=50");
    if (res.ok) {
      const body = (await res.json()) as {
        messages?: Array<{ ID: string; To?: Array<{ Address: string }> }>;
      };
      const match = body.messages?.find((m) =>
        m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()),
      );
      if (match) {
        const detail = await fetch(`http://127.0.0.1:54324/api/v1/message/${match.ID}`);
        const text = ((await detail.json()) as { Text?: string }).Text ?? "";
        const code = /\b(\d{6})\b/.exec(text)?.[1];
        if (code) return code;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No OTP arrived for ${email}`);
}

async function createConfirmedUser(email: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`admin createUser failed: ${await res.text()}`);
}

/** Sign in, enrol, and hand back the passphrase shown exactly once. */
async function signUp(
  browser: Browser,
  email: string,
): Promise<{ page: Page; passphrase: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await goto(page, "/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /email me a code/i }).click();
  await page.getByLabel(/six-digit code/i).fill(await fetchOtp(email));
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(enroll|projects)/);

  await page.getByRole("button", { name: /generate my keys/i }).click();
  const shown = page.locator("p.font-mono");
  await expect(shown).toBeVisible({ timeout: 120_000 });
  const passphrase = (await shown.innerText()).trim();

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /continue/i }).click();
  await page.waitForURL(/\/projects/, { timeout: 60_000 });

  return { page, passphrase };
}

async function unlock(page: Page, passphrase: string, next: string) {
  await goto(page, `/unlock?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/recovery passphrase/i).fill(passphrase);
  await page.getByRole("button", { name: /^unlock$/i }).click();
  await page.waitForURL(new RegExp(next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), {
    timeout: 120_000,
  });
}

test.describe("two people, one encrypted conversation", () => {
  /*
   * 120 s per test, not the 30 s default.
   *
   * Argon2id is deliberately expensive and these tests do several of them —
   * an unlock is one, and provisioning seals a key per member on top. With two
   * Playwright projects running at once on one machine that overruns 30 s
   * intermittently, which showed up as a different test failing on each run
   * and looked far more mysterious than it was.
   *
   * Raising the limit rather than making the crypto cheaper: the slowness is
   * the security property.
   */
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  // Per Playwright project: the file is imported once and run for both
  // browsers, so a module-level address is shared between them. See the same
  // note in unlock-keys.spec.ts.
  let aliceEmail = "";
  let bobEmail = "";
  const SECRET = "The screening disagreement is about outcome, not population";

  let alice: Page;
  let bob: Page;
  let alicePhrase = "";
  let bobPhrase = "";
  let projectId = "";

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    aliceEmail = uniqueEmail(`m-alice-${testInfo.project.name}`);
    bobEmail = uniqueEmail(`m-bob-${testInfo.project.name}`);
    await createConfirmedUser(aliceEmail);
    await createConfirmedUser(bobEmail);

    const a = await signUp(browser, aliceEmail);
    alice = a.page;
    alicePhrase = a.passphrase;

    const b = await signUp(browser, bobEmail);
    bob = b.page;
    bobPhrase = b.passphrase;

    // Alice makes the project and invites Bob.
    await alice.getByLabel("Title").fill(`Encrypted talk ${testInfo.project.name}`);
    await alice
      .getByRole("group", { name: /kind/i })
      .getByRole("radio", { name: /thesis or dissertation/i })
      .check();
    await alice.getByRole("button", { name: /create project/i }).click();
    await alice
      .getByRole("link", { name: `Encrypted talk ${testInfo.project.name}` })
      .click();
    await alice.waitForURL(/\/projects\/[0-9a-f-]+$/);
    await expect(alice.getByRole("list", { name: /project totals/i })).toBeVisible();
    projectId = alice.url().split("/").pop()!;

    await alice.getByLabel("Email").fill(bobEmail);
    await alice.getByLabel("Role").selectOption("CONTRIBUTOR");
    await alice.getByRole("button", { name: /add member/i }).click();
    await expect(alice.getByText(/members \(2\)/i)).toBeVisible();
  });

  test.afterAll(async () => {
    await alice?.context().close();
    await bob?.context().close();
  });

  test("Alice provisions a key that reaches both members", async () => {
    await unlock(alice, alicePhrase, `/projects/${projectId}/keys`);
    await alice.getByRole("button", { name: /create the project key/i }).click();
    // Two wraps, because a key sealed only to its creator is not a shared key.
    await expect(alice.getByText(/epoch 1 sealed to 2 members/i)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("Alice opens a channel and says something", async () => {
    // Navigate by CLICKING, not page.goto. A full load drops the in-memory
    // identity — which is the documented cost of not persisting private keys,
    // and is what the unlock spec asserts. Following the nav link is both what
    // a person does and what keeps the session alive.
    await alice
      .getByRole("navigation", { name: /sections/i })
      .getByRole("link", { name: "Messages" })
      .click();
    await expect(alice.getByRole("heading", { name: "Messages" })).toBeVisible();
    await alice.getByLabel(/new channel/i).fill("screening");
    await alice.getByRole("button", { name: /^create$/i }).click();
    await expect(
      alice.getByRole("navigation", { name: /channels/i }).getByText("screening"),
    ).toBeVisible({ timeout: 60_000 });

    await alice.getByLabel(/^message$/i).fill(SECRET);
    await alice.getByRole("button", { name: /^send$/i }).click();
    await expect(alice.getByText(SECRET)).toBeVisible({ timeout: 60_000 });
  });

  test("Bob reads it, with his own identity and his own copy of the key", async () => {
    // The whole chain, in a browser that has never seen Alice's private key:
    // his passphrase → his master key → his wrap of the project key → the
    // message.
    await unlock(bob, bobPhrase, `/projects/${projectId}/messages`);

    // The channel name is ciphertext too, so seeing it at all is part of the
    // proof.
    await expect(
      bob.getByRole("navigation", { name: /channels/i }).getByText("screening"),
    ).toBeVisible({ timeout: 60_000 });
    await expect(bob.getByText(SECRET)).toBeVisible({ timeout: 60_000 });
  });

  test("and can reply, which Alice reads", async () => {
    const reply = "Agreed — I will re-screen the twelve borderline ones";
    await bob.getByLabel(/^message$/i).fill(reply);
    await bob.getByRole("button", { name: /^send$/i }).click();
    await expect(bob.getByText(reply)).toBeVisible({ timeout: 60_000 });

    // Alice is still unlocked in her tab. Nothing pushes — there is no
    // subscription, deliberately — so she refreshes, which is the control the
    // UI actually offers.
    await alice.getByRole("button", { name: /^refresh$/i }).click();
    await expect(alice.getByText(reply)).toBeVisible({ timeout: 60_000 });
  });

  test("what the database holds is not the text", async () => {
    /*
     * The assertion the rest of this exists for.
     *
     * Read straight from Postgres with the service role, bypassing RLS
     * entirely — this is what an operator, a backup, or a subpoena sees. If
     * the plaintext were anywhere in the row, every other test here could
     * still pass.
     */
    // Straight to Postgres as the superuser, not through PostgREST. Two
    // reasons: PostgREST caches its schema and a freshly-created table is a
    // needless way for this to be flaky, and more importantly `psql` as
    // `postgres` is a truer statement of the claim — this is the view an
    // operator, a backup, or a subpoena gets, with RLS not merely satisfied
    // but absent.
    const dump = execFileSync(
      "psql",
      [
        "--no-psqlrc",
        "-At",
        process.env.DIRECT_URL ??
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "-c",
        "select coalesce(string_agg(encode(ciphertext, 'escape'), ' '), '') from messages",
      ],
      { encoding: "utf8" },
    );

    const rowCount = execFileSync(
      "psql",
      [
        "--no-psqlrc",
        "-At",
        process.env.DIRECT_URL ??
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "-c",
        "select count(*) from messages",
      ],
      { encoding: "utf8" },
    ).trim();

    expect(
      Number(rowCount),
      "the messages should be in the database at all",
    ).toBeGreaterThan(0);

    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain("re-screen the twelve borderline");
    // Not even a distinctive word from it.
    expect(dump.toLowerCase()).not.toContain("borderline");

    // And the channel name is ciphertext as well.
    const channelDump = execFileSync(
      "psql",
      [
        "--no-psqlrc",
        "-At",
        process.env.DIRECT_URL ??
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "-c",
        "select coalesce(string_agg(encode(name_ct, 'escape'), ' '), '') from channels",
      ],
      { encoding: "utf8" },
    );
    expect(channelDump).not.toContain("screening");
  });

  test("removing Bob rotates the key, and he cannot read what comes next", async () => {
    /*
     * The property the whole epoch design exists for, and the one that was
     * missing until now: rotation was implemented and tested, and NOTHING
     * called it when a member left. A removal that does not rotate leaves the
     * departed member holding a key that opens everything written afterwards.
     */
    const beforeRemoval = "Bob can still see this one";
    const afterRemoval = "Bob must not see this one";

    // Alice says something Bob is still entitled to.
    await alice.getByLabel(/^message$/i).fill(beforeRemoval);
    await alice.getByRole("button", { name: /^send$/i }).click();
    await expect(alice.getByText(beforeRemoval)).toBeVisible({ timeout: 60_000 });

    // Remove and rotate, in one action.
    await alice
      .getByRole("navigation", { name: /sections/i })
      .getByRole("link", { name: "Encryption" })
      .click();
    await expect(alice.getByRole("heading", { name: "Who holds a key" })).toBeVisible();

    await alice
      .getByRole("button", { name: /^remove$/i })
      .first()
      .click();
    await alice.getByRole("button", { name: /remove and rotate/i }).click();
    await expect(alice.getByText(/was removed and the key rotated/i)).toBeVisible({
      timeout: 120_000,
    });
    await expect(alice.getByText(/current epoch: 2/i)).toBeVisible();

    // Alice writes under the new epoch.
    await alice
      .getByRole("navigation", { name: /sections/i })
      .getByRole("link", { name: "Messages" })
      .click();
    await alice.getByLabel(/^message$/i).fill(afterRemoval);
    await alice.getByRole("button", { name: /^send$/i }).click();
    await expect(alice.getByText(afterRemoval)).toBeVisible({ timeout: 60_000 });

    // Bob is no longer a member: RLS stops him at the project, before any
    // question of keys arises. Both halves matter, so both are checked — the
    // rotation is what protects him from reading it if he still had access.
    await bob.reload();
    await expect(bob.getByText(afterRemoval)).toHaveCount(0);

    // And the new epoch was sealed to ONE member, not two. If it had been
    // sealed to Bob as well, the removal would have undone itself.
    const wrapsAtEpochTwo = execFileSync(
      "psql",
      [
        "--no-psqlrc",
        "-At",
        process.env.DIRECT_URL ??
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "-c",
        `select count(*) from project_keys where project_id = '${projectId}' and epoch = 2`,
      ],
      { encoding: "utf8" },
    ).trim();

    expect(Number(wrapsAtEpochTwo)).toBe(1);
  });
});
