import { expect, test, type Browser, type Page } from "@playwright/test";

import { goto } from "./ready";

/**
 * Phase 2c week 4 — the extraction form's spine, and a queue you can act from.
 *
 * The extraction form is where someone spends twenty minutes per paper, three
 * hundred times. What it lacked was not features but ORIENTATION: how far
 * through am I, is my work saved, and which of the twenty fields is the one
 * stopping me from submitting.
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

const BIB = `
@article{spine2021,
  title = {A study with an abstract worth quoting from},
  author = {Lindqvist, D.},
  year = {2021},
  journal = {Journal of Extraction},
  abstract = {The primary outcome was sustained attention measured over four weeks.}
}
`;

test.describe("the extraction form's spine", () => {
  test.describe.configure({ mode: "serial" });

  const email = uniqueEmail("spine");
  let page: Page;
  let projectId = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await createConfirmedUser(email);
    page = await signInAndEnroll(browser, email);

    await goto(page, "/projects/new");
    await page.getByLabel("Title").fill("Extraction spine");
    await page
      .getByRole("group", { name: /kind/i })
      .getByRole("radio", { name: /thesis or dissertation/i })
      .check();
    await page.getByRole("button", { name: /create project/i }).click();
    await page.getByRole("link", { name: "Extraction spine" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    await expect(page.getByRole("list", { name: /project totals/i })).toBeVisible();
    projectId = page.url().split("/").pop()!;

    await goto(page, `/projects/${projectId}/import`);
    await page.getByLabel(/paste references/i).fill(BIB);
    await page.getByRole("button", { name: /preview/i }).click();
    await page.getByRole("button", { name: /^add 1 paper$/i }).click();
    await expect(page.getByText(/added 1 paper/i)).toBeVisible();

    // A protocol with one required field and one optional one — the smallest
    // fixture that can tell "required and empty" from "empty".
    await goto(page, `/projects/${projectId}/protocol`);
    await page.getByLabel(/protocol name/i).fill("Spine");
    // "Start from nothing", so the protocol has exactly the two fields added
    // below. The default template is PICO and would bring ten more, which
    // would make "0 of 2 answered" meaningless.
    await page.getByRole("radio", { name: /start from nothing/i }).check();
    await page.getByRole("button", { name: /create protocol/i }).click();

    // "Add a field" reveals the form; "Add field" submits it. Two buttons one
    // word apart, so both regexes are anchored.
    const openFieldForm = page.getByRole("button", { name: /^add a field$/i });
    await expect(openFieldForm).toBeVisible({ timeout: 30_000 });

    await openFieldForm.click();
    await page.getByLabel(/^label$/i).fill("Sample size");
    await page.getByLabel(/^type$/i).selectOption("NUMBER");
    await page.getByLabel(/required/i).check();
    await page.getByRole("button", { name: /^add field$/i }).click();
    await expect(page.getByText("Sample size")).toBeVisible();

    await openFieldForm.click();
    await page.getByLabel(/^label$/i).fill("Reviewer notes");
    await page.getByLabel(/^type$/i).selectOption("TEXT");
    await page.getByRole("button", { name: /^add field$/i }).click();
    await expect(page.getByText("Reviewer notes")).toBeVisible();
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test("says how far through the paper you are", async () => {
    await goto(page, `/projects/${projectId}/library`);
    // Anchored. The project is called "Extraction spine", so an unanchored
    // /extract/i matched the back-link to the project and navigated there.
    await page
      .getByRole("link", { name: /^extract$/i })
      .first()
      .click();
    await page.waitForURL(/\/extract\//);

    // waitFor, not isVisible: `isVisible` answers immediately and the page
    // streams, so it kept answering "no" about a button that was on its way.
    // Third time this exact trap has been hit in this suite.
    const start = page.getByRole("button", { name: /start extracting/i });
    const needsStart = await start
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (needsStart) await start.click();

    // "Am I nearly done" was only answerable by scrolling and counting.
    await expect(page.getByText(/0 of 2 answered/i)).toBeVisible();

    await page.getByLabel("Reviewer notes").fill("Looks reasonable.");
    await expect(page.getByText(/1 of 2 answered/i)).toBeVisible();
  });

  test("and warns that the work is only in the browser", async () => {
    // This form does not autosave, which is defensible — a half-typed number
    // should not become a recorded answer — but nothing said the work was
    // unsaved, and twenty fields is twenty minutes of reading.
    await expect(page.getByText(/unsaved changes/i)).toBeVisible();

    await page.getByRole("button", { name: /save draft/i }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    await expect(page.getByText(/unsaved changes/i)).toHaveCount(0);
  });

  test("names every empty required field before the round trip", async () => {
    // The database refuses an incomplete submission, and that is the rule that
    // matters. But it refuses one field at a time, after a save, on a form
    // twenty fields long — so finding out costs one failed submission per
    // missing answer.
    await page.getByRole("button", { name: /^submit$/i }).click();

    // The SERVER refuses and supplies the headline message — that rule lives
    // in submitExtraction and this assertion is what keeps it honest.
    await expect(page.getByText(/still unanswered/i)).toBeVisible();

    // What the client adds is the part the server cannot: every missing field
    // at once, each one a link to itself. Naming a field the reader then has
    // to hunt for is most of the work left undone.
    const jump = page.getByRole("link", { name: "Sample size" });
    await expect(jump).toBeVisible();
    await expect(jump).toHaveAttribute("href", /^#field-/);
  });

  test("and submits once the required field is answered", async () => {
    await page.getByLabel("Sample size").fill("128");
    await expect(page.getByText(/2 of 2 answered/i)).toBeVisible();

    await page.getByRole("button", { name: /^submit$/i }).click();
    await expect(page.getByText(/submitted/i).first()).toBeVisible();
  });
});

test.describe("the queue can be acted on", () => {
  test.describe.configure({ mode: "serial" });

  const email = uniqueEmail("queue");
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await createConfirmedUser(email);
    page = await signInAndEnroll(browser, email);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test("an empty queue says what would put something in it", async () => {
    await goto(page, "/assigned");
    // The one screen someone lands on with nothing to do. It used to render a
    // header and then nothing at all — no next action, on the surface most
    // likely to be a new collaborator's first impression.
    await expect(
      page.getByRole("main").getByText(/nothing is waiting for you/i),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /go to your projects/i })).toBeVisible();
  });
});

test.describe("choosing a project kind", () => {
  /**
   * The single most consequential decision in the product, and the only one
   * that cannot be undone. It used to be a dropdown with a one-line hint that
   * said "You can add structure later" — which was never true: the capability
   * flag behind that sentence was read by nothing, no action updates `kind`,
   * and no screen offers to.
   */
  test("shows what each kind gives you, before you choose", async ({ browser }) => {
    test.setTimeout(180_000);
    const email = uniqueEmail("kind");
    await createConfirmedUser(email);
    const page = await signInAndEnroll(browser, email);

    try {
      await goto(page, "/projects/new");

      // Scoped to <main>, and that is not incidental. React streams content
      // into a `<div hidden>` before an inline script relocates it, so for a
      // moment the DOM holds two copies of the page. `getByText` matches
      // hidden nodes and saw both; role queries skip the hidden subtree.
      const main = page.getByRole("main");
      const kinds = page.getByRole("group", { name: /kind/i });
      await expect(kinds.getByRole("radio", { name: /thesis/i })).toBeChecked();

      // The consequences of the CURRENT choice, in place. Reading them after
      // creating the project is reading them too late.
      await expect(main.getByText(/a protocol is optional/i)).toBeVisible();
      await expect(main.getByText(/no reconciliation step/i)).toBeVisible();

      await kinds.getByRole("radio", { name: /systematic review/i }).check();

      await expect(main.getByText(/a protocol is required/i)).toBeVisible();
      await expect(page.getByText(/two people extract each paper/i)).toBeVisible();
      await expect(page.getByText(/cohen/i)).toBeVisible();

      // And the irreversibility, said where the choice is made.
      await expect(main.getByText(/cannot be changed afterwards/i)).toBeVisible();
    } finally {
      await page.context().close();
    }
  });
});
