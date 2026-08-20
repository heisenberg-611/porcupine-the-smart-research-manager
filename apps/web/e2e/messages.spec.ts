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
  await page.getByRole("button", { name: /email me a .*code/i }).click();
  await page.getByLabel(/verification code/i).fill(await fetchOtp(email));
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(enroll|dashboard|projects)/);

  await page.getByRole("button", { name: /generate my keys/i }).click();
  const shown = page.locator("p.font-mono");
  await expect(shown).toBeVisible({ timeout: 120_000 });
  const passphrase = (await shown.innerText()).trim();

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /continue/i }).click();
  await page.waitForURL(/\/(dashboard|projects)/, { timeout: 60_000 });

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

/**
 * Scoped to the conversation, never the whole page.
 *
 * `page.getByText(sent)` looks right and is not: the composer is a
 * `<textarea>`, and its draft sits in the DOM as text content — so the
 * assertion passes on the message you FAILED to send. That is precisely what
 * happened when the composer changed from an input to a textarea: sending was
 * silently doing nothing, the draft stayed in the box, and this test went on
 * reporting success against it while the database held one row.
 */
const log = (page: Page) => page.getByTestId("message-log");

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
    await goto(alice, "/projects/new");
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
    await alice.getByLabel("Role", { exact: true }).selectOption("CONTRIBUTOR");
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
    await expect(log(bob).getByText(reply)).toBeVisible({ timeout: 60_000 });

    // Alice is still unlocked in her tab. Nothing pushes — there is no
    // subscription, deliberately — so she refreshes, which is the control the
    // UI actually offers.
    await alice.getByRole("button", { name: /^refresh$/i }).click();
    await expect(log(alice).getByText(reply)).toBeVisible({ timeout: 60_000 });
  });

  test("Alice answers a particular message, and the quote resolves", async () => {
    /*
     * docs/14 §1: the reply link travels INSIDE the ciphertext, so the server
     * never learns the reply graph. That it works is proved by the quote
     * rendering — the client must decrypt every message in the channel and
     * resolve the parent in memory, because nothing on the server can.
     */
    const answer = "Only the twelve where the abstract disagreed with the table";

    const target = log(alice)
      .getByRole("listitem")
      .filter({ hasText: /re-screen/i })
      .first();
    await target.hover();
    await target.getByRole("button", { name: /reply to this message/i }).click();
    await expect(alice.getByText(/replying to/i)).toBeVisible();

    await alice.getByLabel(/^message$/i).fill(answer);
    await alice.getByRole("button", { name: /^send$/i }).click();

    const sent = log(alice).getByRole("listitem").filter({ hasText: answer });
    await expect(sent).toBeVisible({ timeout: 60_000 });
    await expect(sent, "the quote carries who was answered").toContainText(/re-screen/i);

    await bob.getByRole("button", { name: /^refresh$/i }).click();
    const seen = log(bob).getByRole("listitem").filter({ hasText: answer });
    await expect(seen).toBeVisible({ timeout: 60_000 });
    await expect(seen).toContainText(/re-screen/i);
  });

  test("both react, and each sees the other's", async () => {
    const target = log(bob)
      .getByRole("listitem")
      .filter({ hasText: /re-screen/i })
      .first();

    await target.hover();
    await target.getByRole("button", { name: /add a reaction/i }).click();
    await target.getByRole("button", { name: "React 👍" }).click();
    await expect(target.getByRole("button", { name: /👍 from/i })).toBeVisible({
      timeout: 60_000,
    });

    await alice.getByRole("button", { name: /^refresh$/i }).click();
    const onAlice = log(alice)
      .getByRole("listitem")
      .filter({ hasText: /re-screen/i })
      .first();
    await expect(onAlice.getByRole("button", { name: /👍 from/i })).toBeVisible({
      timeout: 60_000,
    });

    // Alice agrees too: one chip counted 2, not two chips.
    await onAlice.hover();
    await onAlice.getByRole("button", { name: /add a reaction/i }).click();
    await onAlice.getByRole("button", { name: "React 👍" }).click();
    await expect(onAlice.getByRole("button", { name: /👍 from/i })).toContainText("2", {
      timeout: 60_000,
    });
  });

  test("a second choice replaces the first, and choosing it again withdraws it", async () => {
    /*
     * One reaction per person per message — forced by the encryption, not a
     * preference: the only uniqueness the server can enforce is
     * (message, author), because a constraint including the emoji would
     * require the server to see the emoji.
     */
    const target = log(alice)
      .getByRole("listitem")
      .filter({ hasText: /re-screen/i })
      .first();

    await target.hover();
    await target.getByRole("button", { name: /add a reaction/i }).click();
    await target.getByRole("button", { name: "React 🎯" }).click();

    // Alice's 👍 became a 🎯, so 👍 is back to one — Bob's.
    await expect(target.getByRole("button", { name: /🎯 from/i })).toBeVisible({
      timeout: 60_000,
    });
    await expect(target.getByRole("button", { name: /👍 from/i })).toContainText("1");

    await target.getByRole("button", { name: /🎯 from/i }).click();
    await expect(target.getByRole("button", { name: /🎯 from/i })).toHaveCount(0, {
      timeout: 60_000,
    });
  });

  test("the reaction picker can be closed without reacting", async () => {
    /*
     * Reported: "if I press react then I can't cancel it without reacting."
     *
     * Opening the picker replaced React and Reply with six emoji and nothing
     * else, so the only way out was to choose one — and the picker appears on
     * hover, which makes opening it by accident easy.
     */
    const target = log(alice)
      .getByRole("listitem")
      .filter({ hasText: /re-screen/i })
      .first();

    const before = await target.getByRole("button", { name: /from/i }).count();

    await target.hover();
    await target.getByRole("button", { name: /add a reaction/i }).click();
    await expect(target.getByRole("button", { name: "React 🎉" })).toBeVisible();

    // The explicit way out.
    await target.getByRole("button", { name: /close the reaction picker/i }).click();
    await expect(target.getByRole("button", { name: "React 🎉" })).toHaveCount(0);

    // And Escape, which is what a keyboard reaches for.
    await target.hover();
    await target.getByRole("button", { name: /add a reaction/i }).click();
    await expect(target.getByRole("button", { name: "React 🎉" })).toBeVisible();
    await alice.keyboard.press("Escape");
    await expect(target.getByRole("button", { name: "React 🎉" })).toHaveCount(0);

    // Nothing was reacted to on the way through.
    expect(await target.getByRole("button", { name: /from/i }).count()).toBe(before);
  });

  test("a link in a message is a link", async () => {
    const withLink = "The preprint is at https://example.com/paper.pdf — worth a read.";

    await alice.getByLabel(/^message$/i).fill(withLink);
    await alice.getByRole("button", { name: /^send$/i }).click();

    const anchor = log(alice).getByRole("link", {
      name: "https://example.com/paper.pdf",
    });
    await expect(anchor).toBeVisible({ timeout: 60_000 });

    // Opened away from the app, and without handing the destination a
    // reference back to this window.
    await expect(anchor).toHaveAttribute("target", "_blank");
    await expect(anchor).toHaveAttribute("rel", /noopener/);

    // The em dash after it belongs to the sentence, not to the URL.
    await expect(anchor).toHaveAttribute("href", "https://example.com/paper.pdf");
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

    /*
     * The reactions too, the newer half of the same claim. The server is
     * allowed to know somebody reacted — it stores the row — but not what they
     * said with it.
     */
    const reactionDump = execFileSync(
      "psql",
      [
        "--no-psqlrc",
        "-At",
        process.env.DIRECT_URL ??
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "-c",
        "select coalesce(string_agg(encode(ciphertext, 'escape'), ' '), '') from message_reactions",
      ],
      { encoding: "utf8" },
    );
    const reactionCount = Number(
      execFileSync(
        "psql",
        [
          "--no-psqlrc",
          "-At",
          process.env.DIRECT_URL ??
            "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
          "-c",
          "select count(*) from message_reactions",
        ],
        { encoding: "utf8" },
      ).trim(),
    );
    // Otherwise "no emoji in the dump" is also true of an empty table.
    expect(reactionCount, "a reaction should be stored at all").toBeGreaterThan(0);
    expect(reactionDump).not.toContain("👍");
    expect(reactionDump).not.toContain("🎯");

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
      .getByRole("link", { name: "Keys & members" })
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

/**
 * A member added AFTER the key exists.
 *
 * The describe above invites Bob before anyone provisions a key, so Bob is
 * included in epoch 1's wraps and everything works. That is not how a project
 * grows: people join a conversation that already has one.
 *
 * Reported from real use — "the member put his key for the project and the
 * epoch also changed, but sending keeps both of us locked out and we cannot
 * see each other's chat." The cause is that a member holding no wrap was shown
 * "This project has no content key yet" and a button that MINTS A NEW ONE:
 * the condition was "I hold no key" while the words and the button said "the
 * project has none". Clicking it advanced the epoch, orphaning the history and
 * leaving whoever still had the old epoch cached writing messages the other
 * could not read.
 */
test.describe("a member who joins after the key exists", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  test.skip(({ isMobile }) => !!isMobile, "one browser is enough for a key path");

  let ownerEmail = "";
  let joinerEmail = "";
  let owner: Page;
  let joiner: Page;
  let ownerPhrase = "";
  let joinerPhrase = "";
  let projectId = "";

  const FIRST = "Written before anyone else joined";

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    ownerEmail = uniqueEmail(`k-owner-${testInfo.project.name}`);
    joinerEmail = uniqueEmail(`k-joiner-${testInfo.project.name}`);
    await createConfirmedUser(ownerEmail);
    await createConfirmedUser(joinerEmail);

    const o = await signUp(browser, ownerEmail);
    owner = o.page;
    ownerPhrase = o.passphrase;

    const j = await signUp(browser, joinerEmail);
    joiner = j.page;
    joinerPhrase = j.passphrase;

    await goto(owner, "/projects/new");
    await owner.getByLabel("Title").fill(`Key sharing ${testInfo.project.name}`);
    await owner
      .getByRole("group", { name: /kind/i })
      .getByRole("radio", { name: /thesis or dissertation/i })
      .check();
    await owner.getByRole("button", { name: /create project/i }).click();
    await owner.waitForURL(/\/projects\/[0-9a-f-]+$/);
    projectId = owner.url().split("/").pop()!;
  });

  test.afterAll(async () => {
    await owner?.context().close();
    await joiner?.context().close();
  });

  test("the owner sets up alone and says something", async () => {
    await unlock(owner, ownerPhrase, `/projects/${projectId}/keys`);
    await owner.getByRole("button", { name: /create the project key/i }).click();
    await expect(owner.getByText(/epoch 1 sealed to 1 member/i)).toBeVisible({
      timeout: 60_000,
    });

    await owner
      .getByRole("navigation", { name: /sections/i })
      .getByRole("link", { name: "Messages" })
      .click();
    await owner.getByLabel(/new channel/i).fill("planning");
    await owner.getByRole("button", { name: /^create$/i }).click();
    await expect(
      owner.getByRole("navigation", { name: /channels/i }).getByText("planning"),
    ).toBeVisible({ timeout: 60_000 });

    await owner.getByLabel(/^message$/i).fill(FIRST);
    await owner.getByRole("button", { name: /^send$/i }).click();
    await expect(log(owner).getByText(FIRST)).toBeVisible({ timeout: 60_000 });
  });

  test("then adds somebody, who is told to ask rather than invited to mint a key", async () => {
    await goto(owner, `/projects/${projectId}`);
    await owner.getByLabel("Email").fill(joinerEmail);
    await owner.getByLabel("Role", { exact: true }).selectOption("CONTRIBUTOR");
    await owner.getByRole("button", { name: /add member/i }).click();
    await expect(owner.getByText(/members \(2\)/i)).toBeVisible();

    await unlock(joiner, joinerPhrase, `/projects/${projectId}/messages`);

    /*
     * The whole bug in one assertion. Holding no wrap is not the same as the
     * project having no key, and offering to create one here is what advanced
     * the epoch and locked both people out.
     */
    await expect(joiner.getByText(/waiting for the key/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      joiner.getByRole("button", { name: /create the project key/i }),
    ).toHaveCount(0);
  });

  test("the owner shares the key, without a rotation", async () => {
    /*
     * First: the owner is TOLD, on the page where they are writing.
     *
     * The split is otherwise invisible — the conversation looks fine to
     * everyone in it, and the only symptom is somebody eventually saying they
     * cannot see the messages.
     */
    await unlock(owner, ownerPhrase, `/projects/${projectId}/messages`);
    await expect(owner.getByText(/cannot read this conversation/i)).toBeVisible({
      timeout: 60_000,
    });

    // By CLICKING, so the in-memory identity survives — without it there is no
    // key to share and the button would be disabled.
    await owner
      .getByRole("navigation", { name: /sections/i })
      .getByRole("link", { name: "Keys & members" })
      .click();
    await expect(owner.getByRole("heading", { name: "Who holds a key" })).toBeVisible();

    await owner.getByRole("button", { name: /give .* the key/i }).click();
    await expect(owner.getByText(/now holds the key/i)).toBeVisible({ timeout: 60_000 });

    /*
     * Still epoch 1 — asserted against the database, not the page.
     *
     * "Sharing is not rotating" is the whole point of the fix, and a rotation
     * here would have thrown away the history it is meant to hand over. The
     * epoch is a number in a column; reading it from the copy on screen would
     * be testing the wording.
     */
    const epoch = execFileSync(
      "psql",
      [
        "--no-psqlrc",
        "-At",
        process.env.DIRECT_URL ??
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        "-c",
        `select current_key_epoch from projects where id = '${projectId}'`,
      ],
      { encoding: "utf8" },
    ).trim();
    expect(epoch, "sharing must not advance the epoch").toBe("1");
  });

  test("and now both read each other, including what came before", async () => {
    await unlock(joiner, joinerPhrase, `/projects/${projectId}/messages`);

    // History, because this member joined with ALL_HISTORY access.
    await expect(log(joiner).getByText(FIRST)).toBeVisible({ timeout: 60_000 });

    const answer = "Reading it fine, thanks";
    await joiner.getByLabel(/^message$/i).fill(answer);
    await joiner.getByRole("button", { name: /^send$/i }).click();
    await expect(log(joiner).getByText(answer)).toBeVisible({ timeout: 60_000 });

    // The owner is on Keys after sharing; walk back by clicking, so the
    // in-memory identity survives and the key stays open.
    await owner
      .getByRole("navigation", { name: /sections/i })
      .getByRole("link", { name: "Messages" })
      .click();
    await expect(owner.getByRole("heading", { name: "Messages" })).toBeVisible();

    await owner.getByRole("button", { name: /^refresh$/i }).click();
    await expect(log(owner).getByText(answer)).toBeVisible({ timeout: 60_000 });
  });

  test("and the warning clears once they hold it", async () => {
    /*
     * The silent split, made loud.
     *
     * A project divides into people holding the current key and people who do
     * not, everyone sees a working conversation, and the only symptom is
     * somebody eventually saying "I can't see your messages". This asserts the
     * warning is shown to the person who can fix it, and that it goes away
     * when they have.
     */
    await expect(owner.getByText(/cannot read this conversation/i)).toHaveCount(0);
  });

  test("and the owner's NEXT message reaches them too", async () => {
    /*
     * Reported after the sharing fix shipped: "when the owner sent a message,
     * the member got locked out again."
     *
     * The test above only ever ran the exchange one way — the joiner sent and
     * the owner read. This is the other direction, which is the one that was
     * broken and the one anybody would try first.
     */
    const afterShare = "Now that you can read this, here is the plan";

    await owner.getByLabel(/^message$/i).fill(afterShare);
    await owner.getByRole("button", { name: /^send$/i }).click();
    await expect(log(owner).getByText(afterShare)).toBeVisible({ timeout: 60_000 });

    await joiner.getByRole("button", { name: /^refresh$/i }).click();
    await expect(log(joiner).getByText(afterShare)).toBeVisible({ timeout: 60_000 });

    // And nothing in the conversation became unreadable in the process.
    await expect(log(joiner).getByText(/key you do not hold/i)).toHaveCount(0);
  });
});
