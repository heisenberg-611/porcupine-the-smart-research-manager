import { expect, test, type Browser, type Page } from "@playwright/test";

import { goto } from "./ready";

/**
 * Phase 3 week 3a — unlock, and the first project key written outside a test.
 *
 * Two weeks of crypto were correct and called by nothing. This is the spec
 * that makes them reachable, and the assertions are about the properties that
 * would be expensive to get wrong:
 *
 *   * the passphrase never reaches the server
 *   * a wrong passphrase is refused rather than producing wrong keys
 *   * a member can open the key sealed to them AND verify who sealed it
 *   * rotation adds an epoch instead of editing one
 */

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.dev`;
}

/**
 * The sign-in code, from the mailbox — and only one issued AFTER `since`.
 *
 * The `since` argument is the whole point. Without it this returns the newest
 * message for the address, which on a RETRY is the previous attempt's code:
 * Supabase invalidates the old one the moment a new one is issued, so the
 * retry signs in with a code that is guaranteed to be rejected, `waitForURL`
 * waits for a navigation that never comes, and the hook burns its full 180
 * second timeout before failing exactly as it did the first time.
 *
 * That turned every flake into three, and it is most of why a CI run took an
 * hour and twenty minutes to not finish.
 */
async function fetchOtp(email: string, since: number): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch("http://127.0.0.1:54324/api/v1/messages?limit=50");
    if (res.ok) {
      const body = (await res.json()) as {
        messages?: Array<{
          ID: string;
          Created?: string;
          To?: Array<{ Address: string }>;
        }>;
      };
      const match = body.messages?.find(
        (m) =>
          m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()) &&
          // A second of slack: mailpit stamps the message when it receives it,
          // which is fractionally after the click that caused it.
          new Date(m.Created ?? 0).getTime() >= since - 1000,
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
  throw new Error(`No OTP arrived for ${email} after ${new Date(since).toISOString()}`);
}

/**
 * The address, scoped to this attempt.
 *
 * A retry that reuses the address cannot sign in. GoTrue rate-limits OTP
 * resends, so asking again inside the window sends no new mail at all — and
 * the previous code has already been consumed. The retry then fills in a dead
 * code, waits for a navigation that never comes, and burns its whole timeout
 * failing exactly as the first attempt did. Three attempts, one outcome, and
 * most of why a CI run took an hour and twenty minutes to not finish.
 *
 * A fresh address per attempt is what makes a retry a retry.
 */
function attemptEmail(base: string): string {
  const { retry } = test.info();
  return retry > 0 ? `r${retry}-${base}` : base;
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

test.describe("unlocking, and a project key", () => {
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

  /**
   * Per Playwright project, not per file.
   *
   * A module-level unique email is shared by chromium and mobile — the file is
   * imported once and run twice — so with two workers both browsers sign in as
   * the same account and create projects with the same title. The keys screen
   * then reports the OTHER run's epoch. Same trap the navigation and screening
   * specs hit; fixed the same way.
   */
  let email = "";
  let page: Page;
  let passphrase = "";
  let projectId = "";

  test.beforeAll(async ({ browser }: { browser: Browser }, testInfo) => {
    test.setTimeout(240_000);
    email = uniqueEmail(`keys-${testInfo.project.name}`);
    await createConfirmedUser(attemptEmail(email));

    const context = await browser.newContext();
    page = await context.newPage();

    await goto(page, "/sign-in");
    await page.getByLabel("Email").fill(email);
    // Stamped before the click: anything already in this mailbox belongs
    // to an earlier attempt and has been invalidated by this one.
    const requestedAt = Date.now();
    await page.getByRole("button", { name: /email me a .*code/i }).click();
    await page.getByLabel(/verification code/i).fill(await fetchOtp(email, requestedAt));
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL(/\/(enroll|dashboard|projects)/);

    // Enrolment shows the passphrase exactly once. Capturing it here is the
    // only way this spec can unlock later — which is the product working as
    // designed, not a test inconvenience.
    await page.getByRole("button", { name: /generate my keys/i }).click();
    const shown = page.locator("p.font-mono");
    await expect(shown).toBeVisible({ timeout: 120_000 });
    passphrase = (await shown.innerText()).trim();
    expect(passphrase.length).toBeGreaterThan(20);

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL(/\/(dashboard|projects)/, { timeout: 60_000 });

    // Project creation has a page of its own now.
    await goto(page, "/projects/new");
    await page.getByLabel("Title").fill(`Encrypted project ${testInfo.project.name}`);
    await page
      .getByRole("group", { name: /kind/i })
      .getByRole("radio", { name: /thesis or dissertation/i })
      .check();
    await page.getByRole("button", { name: /create project/i }).click();
    await page
      .getByRole("link", { name: `Encrypted project ${testInfo.project.name}` })
      .click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    await expect(page.getByRole("list", { name: /project totals/i })).toBeVisible();
    projectId = page.url().split("/").pop()!;
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("the encryption page asks to be unlocked before it will do anything", async () => {
    await goto(page, `/projects/${projectId}/keys`);
    await expect(page.getByRole("main").getByText(/your keys are locked/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /unlock your keys/i })).toBeVisible();
    // Nothing cryptographic is offered while locked.
    await expect(
      page.getByRole("button", { name: /create the project key/i }),
    ).toHaveCount(0);
  });

  test("a wrong passphrase is refused, not guessed at", async () => {
    await goto(page, "/unlock");
    await page.getByLabel(/recovery passphrase/i).fill("WRONG-WRONG-WRONG-WRONG");
    await page.getByRole("button", { name: /^unlock$/i }).click();
    // By text, not by role: Next renders its own empty role="alert" route
    // announcer on every page, and an unscoped getByRole("alert") resolves to
    // that and waits out the timeout against an empty string. Third spec in
    // this suite to meet it.
    await expect(page.getByText(/did not open your keys/i)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("the passphrase never leaves the browser", async () => {
    // The claim the whole design rests on. Every request the page makes while
    // unlocking is inspected for the passphrase in its body.
    const bodies: string[] = [];
    page.on("request", (request) => {
      const body = request.postData();
      if (body) bodies.push(body);
    });

    await goto(page, `/unlock?next=${encodeURIComponent(`/projects/${projectId}/keys`)}`);
    await page.getByLabel(/recovery passphrase/i).fill(passphrase);
    await page.getByRole("button", { name: /^unlock$/i }).click();

    await page.waitForURL(new RegExp(`/projects/${projectId}/keys`), {
      timeout: 120_000,
    });

    expect(
      bodies.length,
      "the unlock should have talked to the server at all",
    ).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain(passphrase);
    }
    page.removeAllListeners("request");
  });

  test("creates a project key and seals it to the members who can hold one", async () => {
    await expect(page.getByText(/no content key yet/i)).toBeVisible();

    await page.getByRole("button", { name: /create the project key/i }).click();
    await expect(page.getByText(/epoch 1 sealed to 1 member/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/current epoch: 1/i)).toBeVisible();
  });

  test("opens its own key and verifies who sealed it", async () => {
    // The signature check is the control that makes an anonymous sealed box
    // trustworthy; this is the only place it runs end to end.
    await page.getByRole("button", { name: /open and verify my key/i }).click();
    await expect(page.getByText(/signature verifies against/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/256 bits/i)).toBeVisible();
  });

  test("rotating adds an epoch rather than editing one", async () => {
    await page.getByRole("button", { name: /rotate to a new epoch/i }).click();
    await expect(page.getByText(/epoch 2 sealed to/i)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/current epoch: 2/i)).toBeVisible();

    // And the old epoch still opens — rotation protects what comes next, it
    // does not retroactively lock anyone out of what they already had.
    await page.getByRole("button", { name: /open and verify my key/i }).click();
    await expect(page.getByText(/epoch 2 key opened/i)).toBeVisible({ timeout: 60_000 });
  });

  test("a reload locks it again, because nothing is persisted", async () => {
    // The cost of keeping the identity in memory only, asserted rather than
    // assumed. Device registration is what removes this, and it is week 4.
    await page.reload();
    await expect(page.getByRole("main").getByText(/your keys are locked/i)).toBeVisible();
  });

  test("a remembered browser unlocks without the passphrase", async () => {
    /*
     * The point of the whole Master Key layer, finally visible: no Argon2id,
     * no passphrase, and the identity comes out the same. The device holds a
     * key it cannot export; the server holds the master key sealed to it.
     * Neither half is enough alone.
     */
    await goto(page, "/unlock");
    await page.getByLabel(/recovery passphrase/i).fill(passphrase);
    await page.getByLabel(/remember this browser/i).check();
    await page.getByRole("button", { name: /^unlock$/i }).click();
    // No `next` on this visit, so unlock falls back to its default landing
    // page — the dashboard, not /projects, since the dashboard became the
    // place every entry flow finishes.
    await page.waitForURL(/\/dashboard/, { timeout: 120_000 });

    // A full reload — which, before this, always meant re-entering the
    // passphrase. The "a reload locks it again" test above is the one this
    // replaces, and it is kept because it still describes browsers that have
    // NOT been remembered.
    await goto(page, `/projects/${projectId}/keys`);
    await expect(page.getByText(/current epoch/i)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole("main").getByText(/your keys are locked/i)).toHaveCount(
      0,
    );
  });

  test("the remembered browser is listed, and revoking it is real", async () => {
    await goto(page, "/unlock");
    await expect(
      page.getByRole("heading", { name: /remembered browsers/i }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: /^revoke$/i })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: /remembered browsers/i })).toHaveCount(
      0,
      { timeout: 30_000 },
    );

    // Revocation deletes the server's half. The browser still has its key and
    // now has nothing to open with it, so the next visit is locked again —
    // which is the difference between revoking and merely hiding a row.
    await goto(page, `/projects/${projectId}/keys`);
    await expect(page.getByRole("main").getByText(/your keys are locked/i)).toBeVisible({
      timeout: 120_000,
    });
  });
});
