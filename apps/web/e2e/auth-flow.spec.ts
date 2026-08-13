import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 0 exit criterion, end to end:
 *   sign up → enroll identity keys → create a project → invite a member
 *
 * Runs against the real local Supabase stack. The OTP is read from the
 * database rather than from an inbox, which is why sign-in uses a code
 * instead of a magic link — an emailed link cannot be tested without
 * driving a mail client.
 *
 * These tests are serial and share one account: enrollment is once-only by
 * design, so a fresh account per test would mean re-proving the same thing.
 */

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.dev`;
}

/**
 * Reads the most recent OTP from Mailpit, which the local stack uses as its
 * mail sink.
 */
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
        const text =
          ((await detail.json()) as { Text?: string; HTML?: string }).Text ?? "";
        const code = /\b(\d{6})\b/.exec(text)?.[1];
        if (code) return code;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No OTP arrived for ${email}`);
}

/** Creates a confirmed account directly, for the invitee. */
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

test.describe.configure({ mode: "serial" });

test.describe("Phase 0 exit criterion", () => {
  const email = uniqueEmail("lead");
  const inviteeEmail = uniqueEmail("sup");

  // One page for the whole block. Playwright gives each test a fresh context,
  // which would drop the session cookie between steps — and this is a single
  // continuous journey, not seven independent assertions.
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("signs up with an email OTP", async () => {
    await page.goto("/sign-in");

    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /email me a code/i }).click();

    await expect(page.getByLabel(/six-digit code/i)).toBeVisible();

    const code = await fetchOtp(email);
    await page.getByLabel(/six-digit code/i).fill(code);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // A new account has no identity keys, so it lands in enrollment.
    await expect(page).toHaveURL(/\/enroll/);
    await expect(page.getByRole("heading", { name: /one-time setup/i })).toBeVisible();
  });

  test("generates identity keys and shows the recovery passphrase once", async () => {
    await page.goto("/enroll");
    await page.getByRole("button", { name: /generate my keys/i }).click();

    // Argon2id is deliberately slow.
    const passphrase = page.locator("p.font-mono");
    await expect(passphrase).toBeVisible({ timeout: 30_000 });
    await expect(passphrase).toHaveText(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){5}$/);

    // The warning must be present at the moment the passphrase is shown,
    // not buried in a help article.
    await expect(page.getByText(/cannot be recovered/i)).toBeVisible();

    // Continue is gated on acknowledging that the passphrase was saved.
    const cont = page.getByRole("button", { name: /continue/i });
    await expect(cont).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(cont).toBeEnabled();
    await cont.click();

    await expect(page).toHaveURL(/\/projects/);
  });

  test("enrollment does not run twice", async () => {
    // Keys already exist, so /enroll must redirect rather than offer to
    // overwrite them — regenerating would strand every existing ciphertext.
    await page.goto("/enroll");
    await expect(page).toHaveURL(/\/projects/);
  });

  test("creates a project and becomes its owner", async () => {
    await page.goto("/projects");
    await expect(page.getByText(/no projects yet/i)).toBeVisible();

    await page.getByLabel("Title").fill("Transformer efficiency in low-resource NLP");
    await page.getByLabel("Kind").selectOption("THESIS");
    await page.getByRole("button", { name: /create project/i }).click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
    await expect(
      page.getByRole("heading", { name: /transformer efficiency/i }),
    ).toBeVisible();

    // The creator's OWNER membership is written in the same transaction as
    // the project — without it the project would be invisible to everyone,
    // including its creator.
    // exact: getByText does case-insensitive substring matching, so a bare
    // "OWNER" also matches an email address containing "owner".
    await expect(page.getByText("OWNER", { exact: true })).toBeVisible();
    await expect(page.getByText(/members\s*\(1\)/i)).toBeVisible();
  });

  test("invites an existing user as a supervisor", async () => {
    await createConfirmedUser(inviteeEmail);

    await page.goto("/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();

    await page.getByLabel("Email").fill(inviteeEmail);
    await page.getByLabel("Role").selectOption("REVIEWER");

    // ADR-006: the history prompt appears only for reviewers, which is the
    // case where it carries weight.
    await expect(page.getByLabel(/history access/i)).toBeVisible();
    await page.getByLabel(/history access/i).selectOption("ALL_HISTORY");

    await page.getByRole("button", { name: /add member/i }).click();

    await expect(page.getByText(/member added/i)).toBeVisible();
    await expect(page.getByText(/members\s*\(2\)/i)).toBeVisible();
    await expect(page.getByText("REVIEWER", { exact: true })).toBeVisible();
  });

  test("refuses to invite an address with no account", async () => {
    await page.goto("/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();

    await page.getByLabel("Email").fill(uniqueEmail("stranger"));
    await page.getByRole("button", { name: /add member/i }).click();

    await expect(page.getByText(/no porcupine account/i)).toBeVisible();
  });

  test("signs out and blocks the project list", async () => {
    await page.goto("/projects");
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    // Middleware gates it, RLS backs that up.
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
