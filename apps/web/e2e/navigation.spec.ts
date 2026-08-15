import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { goto } from "./ready";

/**
 * Phase 2c week 1 — no link leads to a refusal, and every screen says where
 * you are.
 *
 * The defect this locks shut: the project hub offered all nine sections
 * regardless of project kind, so a THESIS showed links to Reconcile and
 * PRISMA and clicking either cost a page load to be told the feature is for
 * systematic reviews. `capabilities()` was enforced at the destination
 * instead of at the door — the gate worked, and the user paid for it.
 *
 * The test walks every link the hub offers and asserts none of them lands on
 * a refusal. Written that way on purpose rather than as "Reconcile is absent":
 * a hard-coded list of two forbidden labels stops being true the moment a
 * tenth section is added, and this is exactly the kind of rule that decays
 * silently.
 */

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

/** Wording that means "this project kind cannot do this". */
const REFUSAL = /is for systematic reviews|only for systematic reviews/i;

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

/**
 * Sign in once, in a context the whole suite shares.
 *
 * Signing in per test looked tidier and was not: the second sign-in for the
 * same address raced the first one's code, `waitForURL` sat on /sign-in until
 * the timeout, and the failure named the navigation rather than the OTP. One
 * session, created once, is also closer to what a person does.
 */
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

/** The visible label for each kind — the picker is radios, not a select. */
const KIND_LABEL: Record<string, RegExp> = {
  THESIS: /thesis or dissertation/i,
  SYSTEMATIC_REVIEW: /systematic review/i,
  LAB_PAPER: /lab paper/i,
  GENERAL: /something else/i,
};

async function createProject(page: Page, title: string, kind: string): Promise<string> {
  await goto(page, "/projects");
  await page.getByLabel("Title").fill(title);
  await page
    .getByRole("group", { name: /kind/i })
    .getByRole("radio", { name: KIND_LABEL[kind]! })
    .check();
  await page.getByRole("button", { name: /create project/i }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
  // waitForURL returns while the RSC payload is still streaming, so the page
  // at that instant is the loading skeleton — which is a `main` with no links
  // in it. Reading the hub before this line found zero sections and blamed
  // the hub. Wait for the content the skeleton stands in for.
  await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
  return page.url().split("/").pop()!;
}

test.describe("project navigation", () => {
  test.describe.configure({ mode: "serial" });

  const email = uniqueEmail("nav");
  let page: Page;
  let thesisId = "";
  let reviewId = "";

  test.beforeAll(async ({ browser }) => {
    await createConfirmedUser(email);
    page = await signInAndEnroll(browser, email);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test("a THESIS never links to something it cannot do", async () => {
    thesisId = await createProject(page, "Nav thesis", "THESIS");

    // Collect every in-project link the hub offers, then follow each one.
    const hrefs = await page
      .locator(`main a[href^="/projects/${thesisId}"]`)
      .evaluateAll((links) =>
        Array.from(
          new Set(links.map((a) => (a as HTMLAnchorElement).getAttribute("href")!)),
        ),
      );

    // A hub that linked to nothing would pass the refusal check vacuously.
    expect(hrefs.length, "the hub should offer some sections").toBeGreaterThan(4);

    for (const href of hrefs) {
      // `load`, not `networkidle`. networkidle waits for a 500 ms gap in
      // network activity, which never arrives reliably on a slower machine
      // and hung this test for the full 30 s three times in CI while passing
      // locally every time.
      await goto(page, href, { waitUntil: "load" });
      await expect(
        page.locator("body"),
        `${href} answered with a capability refusal, so it should not have been linked`,
      ).not.toHaveText(REFUSAL);
    }
  });

  test("but the destinations still refuse a URL typed by hand", async () => {
    // The complement, and the one that matters for R-06: hiding the link is a
    // navigation convenience, not the security boundary. If this ever passes
    // by rendering the feature, the gate has been moved into the nav by
    // mistake.
    await goto(page, `/projects/${thesisId}/reconcile`);
    await expect(page.getByText(REFUSAL)).toBeVisible();
  });

  test("a SYSTEMATIC_REVIEW gets the sections a thesis does not", async () => {
    reviewId = await createProject(page, "Nav review", "SYSTEMATIC_REVIEW");

    const nav = page.getByRole("navigation", { name: /sections/i });
    await expect(nav.getByRole("link", { name: "Reconcile" })).toBeVisible();

    // And the thesis genuinely lacks it — otherwise the assertion above
    // proves only that links exist somewhere.
    await goto(page, `/projects/${thesisId}`);
    await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();
    const thesisNav = page.getByRole("navigation", { name: /sections/i });
    await expect(thesisNav.getByRole("link", { name: "Reconcile" })).toHaveCount(0);

    // PRISMA, by contrast, is NOT gated and must stay: the page renders the
    // diagram for every project kind and only adds a note when exclusion
    // reasons were optional. The first draft of the section list hid it from a
    // thesis on the strength of a capability flag's name, which removed a
    // working feature from three of the four kinds.
    await expect(thesisNav.getByRole("link", { name: "PRISMA" })).toBeVisible();
  });

  test("every project screen says which project and which section", async () => {
    for (const section of ["library", "evidence", "protocol", "progress"]) {
      await goto(page, `/projects/${reviewId}/${section}`);

      const nav = page.getByRole("navigation", { name: /sections/i });
      await expect(nav.getByRole("link", { name: "Nav review" })).toBeVisible();

      // aria-current is the whole reason the nav is a client component. If it
      // regresses, the header is back to being a list of links that never says
      // which one you are looking at.
      await expect(
        nav.locator("a[aria-current='page']"),
        `${section} should mark itself current`,
      ).toHaveCount(1);
    }
  });

  test("the overview counts what is there and links where it counts", async () => {
    await goto(page, `/projects/${reviewId}`);
    await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();

    // An empty project: the next action must be "find papers", not a generic
    // welcome. This is the claim that the hub reflects state at all.
    await expect(page.getByText(/the library is empty/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /find papers/i }).first()).toBeVisible();

    // Every stat is a link. A dashboard number you cannot click is a dead end
    // that made you read it first.
    const stats = page.getByRole("list", { name: /project totals/i });
    await expect(stats.getByRole("link")).toHaveCount(4);
  });

  test("the new navigation has no accessibility violations", async () => {
    await goto(page, `/projects/${reviewId}`);
    await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
