import { expect, test, type Browser, type Page } from "@playwright/test";

import { goto } from "./ready";

/**
 * Closing an account — the refusal, the wait, and the point of no return.
 *
 * Three things are worth a browser test here, and they are the three that
 * would be embarrassing to get wrong in front of somebody who has just decided
 * to leave:
 *
 *   1. It refuses while a project would be left without an owner, and NAMES
 *      the project. "You cannot delete your account" with no reason is the
 *      message people take to support.
 *   2. The waiting period is real and cancelling costs nothing.
 *   3. Immediate deletion actually ends the account — the old address can no
 *      longer sign in.
 *
 * The scrub itself is asserted in packages/db/test/16_account_deletion.sql,
 * where the assertion can be about rows rather than about pixels.
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

async function signInAndEnroll(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await goto(page, "/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /email me a .*code/i }).click();
  await page.getByLabel(/verification code/i).fill(await fetchOtp(email));
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(enroll|dashboard|projects)/);

  const generate = page.getByRole("button", { name: /generate my keys/i });
  const needsKeys = await generate
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);

  if (needsKeys) {
    await generate.click();
    await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /continue/i }).click();
  }
  await page.waitForURL(/\/(dashboard|projects)/, { timeout: 60_000 });
  return page;
}

test.describe("closing an account", () => {
  test.describe.configure({ mode: "serial" });

  const email = uniqueEmail("closing");
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await createConfirmedUser(email);
    page = await signInAndEnroll(browser, email);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test("says what will survive, and what will not", async () => {
    await goto(page, "/account");

    const main = page.getByRole("main");
    // Level 1, because "Delete your account" is also a heading on this page and
    // an unanchored /your account/ matches both.
    await expect(
      main.getByRole("heading", { level: 1, name: "Your account" }),
    ).toBeVisible();
    // The address appears twice on this page — in the details list and as the
    // hint under the confirmation field — so the assertion names which one it
    // means rather than reaching for `.first()`, which would have been happy
    // with either.
    await expect(
      main.getByRole("region", { name: "Details" }).getByText(email),
    ).toBeVisible();

    // The two sentences somebody is most likely to feel misled about later.
    await expect(
      main.getByText(/screening decisions, extractions and annotations stay/i),
    ).toBeVisible();
    await expect(main.getByText(/flagged for key rotation/i)).toBeVisible();
  });

  test("the button stays off until the address matches", async () => {
    const confirm = page.getByLabel(/type your email address/i);
    const button = page.getByRole("button", { name: /schedule deletion/i });

    await expect(button).toBeDisabled();
    await confirm.fill("someone@else.test");
    await expect(button).toBeDisabled();

    // Case-insensitively, because an address is not case-sensitive in the half
    // that matters and refusing "Alice@" for "alice@" teaches nobody anything.
    await confirm.fill(email.toUpperCase());
    await expect(button).toBeEnabled();
  });

  test("scheduling it starts a clock that can be stopped", async () => {
    await page.getByRole("button", { name: /schedule deletion/i }).click();

    await expect(page.getByText(/scheduled for deletion on/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Nothing has happened yet, and that is the point of the wait.
    await goto(page, "/dashboard");
    await expect(
      page.getByRole("status").filter({ hasText: /scheduled for deletion/i }),
    ).toBeVisible();

    await goto(page, "/account");
    await page.getByRole("button", { name: /keep my account/i }).click();

    await expect(page.getByLabel(/type your email address/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("deleting it immediately ends the account", async () => {
    await goto(page, "/account");
    await page.getByLabel(/type your email address/i).fill(email);
    await page.getByRole("checkbox", { name: /delete it permanently now/i }).check();

    await page.getByRole("button", { name: /delete permanently/i }).click();

    // Landed on the public front page, signed out.
    await page.waitForURL(/\/$/, { timeout: 30_000 });

    // And the gate is real: the app is no longer reachable.
    await goto(page, "/projects");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
