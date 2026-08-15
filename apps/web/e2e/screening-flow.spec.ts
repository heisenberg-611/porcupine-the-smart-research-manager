import { expect, test, type Browser, type Page } from "@playwright/test";

import { goto } from "./ready";

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
  await goto(page, "/sign-in");
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
    await goto(page, "/projects");
    await page.getByLabel("Title").fill("Screening throughput");
    await page
      .getByRole("group", { name: /kind/i })
      .getByRole("radio", { name: /thesis or dissertation/i })
      .check();
    await page.getByRole("button", { name: /create project/i }).click();
    await page.getByRole("link", { name: "Screening throughput" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    await expect(page.getByRole("list", { name: /project totals/i })).toBeVisible();
    projectId = page.url().split("/").pop()!;

    await goto(page, `/projects/${projectId}/import`);
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
    await goto(page, `/projects/${projectId}/screen`);
    await expect(page.getByRole("main").getByText(/3 left/i)).toBeVisible();

    const first = await page.locator("article h2").innerText();

    /*
     * Hold the server action open so it cannot possibly have answered, then
     * decide. If the queue still advances, it advanced optimistically — which
     * is the whole claim. Without this, the test passes against a blocking
     * implementation too, on a fast local server.
     *
     * Scoped to POST and wrapped in try/finally, both learned from CI. A
     * server action posts to the CURRENT url, so an unscoped `**\/screen`
     * route also intercepts the page's own document and RSC requests; and an
     * unroute that only runs on success leaks the interception into the next
     * test, because these tests share one page. In CI that took down the
     * shortcut test two cases later with an error naming neither.
     */
    // Held open until the test releases it, rather than for a fixed 3 s.
    //
    // The fixed version was `setTimeout(() => route.continue(), 3000)`, and it
    // outlived its own test: the assertions finish in ~300 ms, `finally`
    // unroutes, the route object is disposed — and three seconds later the
    // timer fires into whatever test is running by then and throws "Route is
    // already handled!". In CI that killed a test two cases later on chromium
    // and a different one on mobile, each blaming a line it never ran.
    //
    // A promise the test resolves means nothing survives the test that created
    // it, and the held request still completes before the route is removed.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    await page.route("**/screen", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await held;
      // The page may have navigated on by now; a dead route is not a failure.
      await route.continue().catch(() => {});
    });

    try {
      await page.getByRole("button", { name: /^include$/i }).click();

      // 250 ms is well above a render and far below anything the server could
      // have answered in, since the request is still being held.
      await page.waitForTimeout(250);
      await expect(page.locator("article h2")).not.toHaveText(first);
    } finally {
      // Let the held request finish AND wait for it, so the decision it
      // records has landed before the next test reads the queue. Releasing
      // without waiting left a POST in flight across the test boundary, which
      // made the following test's queue count 3 or 2 depending on timing.
      const landed = page
        .waitForResponse((r) => r.request().method() === "POST", { timeout: 10_000 })
        .catch(() => null);
      release();
      await landed;
      await page.unroute("**/screen");
    }
  });

  test("and rolls the paper back when the server refuses", async () => {
    await goto(page, `/projects/${projectId}/screen`);

    /*
     * Counts are READ, never hard-coded.
     *
     * These tests share a queue and each one changes it, so "2 left" was only
     * ever true if every preceding test did exactly what was expected — which
     * is not a property a test should depend on, and stopped being true the
     * moment the previous test began reliably recording its decision. What
     * matters here is that the count is UNCHANGED by a refused decision, and
     * that is checkable against whatever it happens to be.
     */
    const remaining = page.getByText(/\d+ left/);
    await expect(remaining).toBeVisible();
    const before = await remaining.innerText();

    const target = await page.locator("article h2").innerText();

    // Fail the action outright — POST only, so the page's own navigation and
    // RSC requests still work, and in a try/finally so a failure here cannot
    // leave the interception in place for the next test.
    await page.route("**/screen", (route) =>
      route.request().method() === "POST" ? route.abort("failed") : route.continue(),
    );

    try {
      await page.getByRole("button", { name: /^include$/i }).click();

      // Scoped: Next ships its own empty role="alert" route announcer, and an
      // unscoped getByRole("alert") resolves to that first and waits forever on
      // an empty string.
      const failure = page.locator("section p[role='alert']");
      await expect(failure).toContainText(target, { timeout: 15_000 });
      await expect(failure).toContainText(/back in the queue/i);
      // Unchanged, and the paper itself is current again.
      await expect(remaining).toHaveText(before);
      await expect(page.locator("article h2")).toHaveText(target);
    } finally {
      await page.unroute("**/screen");
    }
  });

  test("shortcuts stay out of the way while a control is focused", async () => {
    // The failure this prevents: a document-level listener that fires whatever
    // has focus, so choosing an assignee with the keyboard screens the paper
    // instead. It is the reason so many apps quietly abandoned their
    // shortcuts, and it is invisible until someone uses the app without a
    // mouse.
    await goto(page, `/projects/${projectId}/screen`);

    const remaining = page.getByText(/\d+ left/);
    await expect(remaining).toBeVisible();
    const count = await remaining.innerText();
    const before = await page.locator("article h2").innerText();

    await page.getByLabel(/assign to/i).focus();
    await page.keyboard.press("i");
    await page.keyboard.press("e");
    await page.keyboard.press("s");

    await expect(remaining).toHaveText(count);
    await expect(page.locator("article h2")).toHaveText(before);
  });

  test("the shortcut list is visible, not hidden", async () => {
    await goto(page, `/projects/${projectId}/screen`);
    // A shortcut nobody is told about is a feature for whoever wrote it.
    const hint = page.getByRole("button", { name: /keyboard/i });
    await expect(hint).toBeVisible();
    await hint.click();
    await expect(page.getByText(/skip — leaves it undecided/i)).toBeVisible();
  });
  test("the whole queue can be driven from the keyboard", async () => {
    await goto(page, `/projects/${projectId}/screen`);

    const remaining = page.getByText(/\d+ left/);
    await expect(remaining).toBeVisible();
    const start = Number(/(\d+)/.exec(await remaining.innerText())![1]);
    expect(start, "the queue should have something in it").toBeGreaterThan(0);

    // Focus the document body rather than any control, which is where a
    // person's focus actually is while reading an abstract.
    await page.locator("article h2").click();

    // Drain it, alternating the two decisions. Bounded by what the queue
    // actually holds rather than by a number written here: how many papers
    // survive the earlier tests depends on what those tests did, and hard-
    // coding it made this test a report on THEM.
    for (let i = 0; i < start; i++) {
      await page.keyboard.press(i % 2 === 0 ? "i" : "e");
      await page.waitForTimeout(150);
    }

    await expect(page.getByText(/that is everything for now/i)).toBeVisible();
    await expect(page.getByText(/decisions? recorded/i)).toBeVisible();
  });
});
