import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Phase 2c week 2 — screening at speed.
 *
 * Two changes under test, both aimed at the same surface: the one a person
 * repeats three hundred times in an afternoon.
 *
 *   1. A decision applies immediately instead of waiting for the round trip,
 *      and rolls back with an explanation if the server refuses.
 *   2. It can be driven entirely from the keyboard.
 *
 * The rollback is the half worth testing hardest. An optimistic UI that
 * cannot undo itself is not a faster interface, it is one that lies about
 * whether the work was saved — and that failure is invisible precisely
 * because the screen already moved on.
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
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /email me a code/i }).click();
  await page.getByLabel(/six-digit code/i).fill(await fetchOtp(email));
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(enroll|projects)/);

  if (page.url().includes("/enroll")) {
    await page.getByRole("button", { name: /generate my keys/i }).click();
    await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL(/\/projects/);
  }

  return page;
}

const BIB = `
@article{alpha2020,
  title = {Alpha study of screening throughput},
  author = {Okonkwo, A.},
  year = {2020},
  journal = {Journal of Screening}
}
@article{beta2021,
  title = {Beta study of screening throughput},
  author = {Nakamura, B.},
  year = {2021},
  journal = {Journal of Screening}
}
@article{gamma2022,
  title = {Gamma study of screening throughput},
  author = {Ferreira, C.},
  year = {2022},
  journal = {Journal of Screening}
}
`;

test.describe("screening at speed", () => {
  test.describe.configure({ mode: "serial" });

  const email = uniqueEmail("screening");
  let page: Page;
  let projectId = "";

  // Enrolment derives an identity key with Argon2id, which is deliberately
  // slow. The default 30 s hook timeout is not enough for that plus a project
  // and an import.
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await createConfirmedUser(email);
    page = await signInAndEnroll(browser, email);

    // A THESIS, so an exclusion reason is optional and `e` alone is a
    // complete decision. The reason-required path has its own test below.
    await page.goto("/projects");
    await page.getByLabel("Title").fill("Screening throughput");
    await page.getByLabel("Kind").selectOption("THESIS");
    await page.getByRole("button", { name: /create project/i }).click();
    await page.getByRole("link", { name: "Screening throughput" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
    projectId = page.url().split("/").pop()!;

    await page.goto(`/projects/${projectId}/import`);
    await page.getByLabel(/paste references/i).fill(BIB);
    await page.getByRole("button", { name: /preview/i }).click();
    await expect(page.getByRole("list", { name: /references to import/i })).toBeVisible();
    await page.getByRole("button", { name: /^add 3 papers$/i }).click();
    await expect(page.getByText(/added 3 papers/i)).toBeVisible();
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test("a decision advances the queue without waiting for the server", async () => {
    await page.goto(`/projects/${projectId}/screen`);
    await expect(page.getByText(/3 left/i)).toBeVisible();

    const first = await page.locator("article h2").innerText();

    // Block the server action so it cannot possibly have answered, then
    // decide. If the queue still advances, it advanced optimistically —
    // which is the whole claim. Without the route block this test passes
    // against a blocking implementation too, on a fast local server.
    await page.route("**/screen", (route) => {
      setTimeout(() => route.continue(), 3000);
    });

    await page.getByRole("button", { name: /^include$/i }).click();

    // 250 ms is far below the 3 s the action is being held for, and well
    // above a render.
    await page.waitForTimeout(250);
    await expect(page.locator("article h2")).not.toHaveText(first);
    await expect(page.getByText(/2 left/i)).toBeVisible();

    await page.unroute("**/screen");
  });

  test("and rolls the paper back when the server refuses", async () => {
    await page.goto(`/projects/${projectId}/screen`);
    await expect(page.getByText(/2 left/i)).toBeVisible();

    const target = await page.locator("article h2").innerText();

    // Fail the action outright. The decision must not survive as a silent
    // success: the paper returns, the count returns, and the message names
    // the paper rather than saying "something went wrong".
    await page.route("**/screen", (route) => route.abort("failed"));
    await page.getByRole("button", { name: /^include$/i }).click();

    // Scoped: Next ships its own empty role="alert" route announcer, and an
    // unscoped getByRole("alert") resolves to that first and waits forever on
    // an empty string.
    const failure = page.locator("section p[role='alert']");
    await expect(failure).toContainText(target, { timeout: 15_000 });
    await expect(failure).toContainText(/back in the queue/i);
    await expect(page.getByText(/2 left/i)).toBeVisible();

    await page.unroute("**/screen");
  });

  test("shortcuts stay out of the way while a control is focused", async () => {
    // The failure this prevents: a document-level listener that fires whatever
    // has focus, so choosing an assignee with the keyboard screens the paper
    // instead. It is the reason so many apps quietly abandoned their
    // shortcuts, and it is invisible until someone uses the app without a
    // mouse.
    await page.goto(`/projects/${projectId}/screen`);
    await expect(page.getByText(/2 left/i)).toBeVisible();

    const before = await page.locator("article h2").innerText();

    await page.getByLabel(/assign to/i).focus();
    await page.keyboard.press("i");
    await page.keyboard.press("e");
    await page.keyboard.press("s");

    await expect(page.getByText(/2 left/i)).toBeVisible();
    await expect(page.locator("article h2")).toHaveText(before);
  });

  test("the shortcut list is visible, not hidden", async () => {
    await page.goto(`/projects/${projectId}/screen`);
    // A shortcut nobody is told about is a feature for whoever wrote it.
    const hint = page.getByRole("button", { name: /keyboard/i });
    await expect(hint).toBeVisible();
    await hint.click();
    await expect(page.getByText(/skip — leaves it undecided/i)).toBeVisible();
  });
  test("the whole queue can be driven from the keyboard", async () => {
    await page.goto(`/projects/${projectId}/screen`);
    await expect(page.getByText(/2 left/i)).toBeVisible();

    // Focus the document body rather than any control, which is where a
    // person's focus actually is while reading an abstract.
    await page.locator("article h2").click();

    await page.keyboard.press("i");
    await expect(page.getByText(/1 left/i)).toBeVisible();

    await page.keyboard.press("e");
    await expect(page.getByText(/that is everything for now/i)).toBeVisible();
    await expect(page.getByText(/2 decisions recorded/i)).toBeVisible();
  });
});
