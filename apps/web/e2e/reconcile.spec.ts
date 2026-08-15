import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Phase 2b — dual extraction and reconciliation, end to end.
 *
 * Three people and one paper: Alice and Bob each extract it independently, and
 * Carol — who has read neither — resolves what they disagree about.
 *
 * This needs its own spec because it needs its own PROJECT. The main flow uses
 * a THESIS, where dual extraction is deliberately unavailable (R-06), so the
 * reconciliation path cannot be reached from it at all.
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

/** Sign in and complete enrollment, leaving the page on /projects. */
async function signInAndEnroll(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /email me a code/i }).click();
  await page.getByLabel(/six-digit code/i).fill(await fetchOtp(email));
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // Wait for the redirect to settle BEFORE branching. Reading page.url()
  // straight after the click caught it still on /sign-in, so the enrolment
  // branch was skipped and the assertion below then failed on /enroll.
  await page.waitForURL(/\/(enroll|projects)/);

  // A new account lands in enrollment; Argon2id is deliberately slow.
  if (page.url().includes("/enroll")) {
    await page.getByRole("button", { name: /generate my keys/i }).click();
    await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL(/\/projects/);
  }
  await expect(page).toHaveURL(/\/projects/);
  return page;
}

/** Fill the extraction form with a given design answer, then submit. */
async function extractAs(page: Page, projectName: RegExp, design: string, task: string) {
  await page.goto("/projects");
  await page.getByRole("link", { name: projectName }).click();
  await page.getByRole("link", { name: /^library$/i }).click();
  await page
    .getByRole("row", { name: /attention is all you need/i })
    .getByRole("link", { name: /^extract$/i })
    .click();

  await page.getByRole("button", { name: /start extracting/i }).click();
  await expect(page.getByRole("heading", { name: /the questions/i })).toBeVisible();

  await page.getByLabel(/^task/i).fill(task);
  await page.getByLabel(/^dataset/i).fill("WMT 2014");
  await page.getByLabel(/^model/i).fill("Transformer");
  await page.getByLabel(/metric name/i).selectOption(design);

  // The QUOTE field must be answered from the paper.
  await page.getByRole("button", { name: /quote from the paper/i }).click();
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="extract-source"]');
    if (!el?.firstChild) return;
    const range = document.createRange();
    range.setStart(el.firstChild, 10);
    range.setEnd(el.firstChild, 70);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  await page.getByRole("button", { name: /^submit$/i }).click();
  await expect(page.getByText(/submitted\. it is frozen/i)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 2b — dual extraction", () => {
  const aliceEmail = uniqueEmail("alice");
  const bobEmail = uniqueEmail("bob");
  const carolEmail = uniqueEmail("carol");
  const PROJECT = /statin adherence review/i;

  let alice: Page;
  let bob: Page;
  let carol: Page;

  test.beforeAll(async ({ browser }) => {
    await createConfirmedUser(bobEmail);
    await createConfirmedUser(carolEmail);

    alice = await signInAndEnroll(browser, aliceEmail);
    bob = await signInAndEnroll(browser, bobEmail);
    carol = await signInAndEnroll(browser, carolEmail);
  });

  test.afterAll(async () => {
    await alice?.context().close();
    await bob?.context().close();
    await carol?.context().close();
  });

  test("a review project is set up with three readers", async () => {
    await alice.goto("/projects");
    await alice.getByLabel("Title").fill("Statin adherence review");
    await alice
      .getByRole("group", { name: /kind/i })
      .getByRole("radio", { name: /systematic review/i })
      .check();
    await alice.getByRole("button", { name: /create project/i }).click();

    await expect(alice).toHaveURL(/\/projects\/[0-9a-f-]{36}/);

    // The member COUNT is asserted after each invite, not "member added".
    // That message stays on screen from the previous invite, so waiting for it
    // again passes instantly and the next step races the write.
    const invites = [bobEmail, carolEmail];
    for (let i = 0; i < invites.length; i++) {
      await alice.getByLabel("Email").fill(invites[i]!);
      await alice.getByLabel("Role").selectOption("CONTRIBUTOR");
      await alice.getByRole("button", { name: /add member/i }).click();
      await expect(
        alice.getByText(new RegExp(`members\\s*\\(${i + 2}\\)`, "i")),
      ).toBeVisible();
    }
  });

  test("a paper and a protocol exist", async () => {
    await alice.getByRole("link", { name: /^import$/i }).click();
    await alice.getByLabel(/paste references/i).fill(`
      @inproceedings{vaswani2017,
        title = {Attention Is All You Need},
        author = {Vaswani, Ashish},
        year = {2017},
        abstract = {The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.}
      }
    `);
    await alice.getByRole("button", { name: /preview/i }).click();
    await alice.getByRole("button", { name: /add 1 paper/i }).click();
    await expect(alice.getByText(/added 1 paper/i)).toBeVisible();

    await alice.goto("/projects");
    await alice.getByRole("link", { name: PROJECT }).click();
    await alice.getByRole("link", { name: /^protocol$/i }).click();
    await alice.getByLabel(/protocol name/i).fill("Data extraction");
    await alice.getByRole("radio", { name: /machine learning benchmarks/i }).check();
    await alice.getByRole("button", { name: /create protocol/i }).click();
    await expect(alice.getByText(/10 fields/)).toBeVisible();
  });

  test("two people extract the same paper independently", async () => {
    /*
     * They AGREE on the ENUM and disagree on the free-text task.
     *
     * Chosen so the page has to render both interesting cases at once. The
     * ENUM is the only kappa-eligible field here, and with both readings in a
     * single category chance alone predicts complete agreement — so κ is
     * undefined, and the page has to say so rather than print 1.00. The text
     * disagreement is what Carol then has to resolve.
     */
    await extractAs(alice, PROJECT, "BLEU", "Sequence transduction");
    await extractAs(bob, PROJECT, "BLEU", "Machine translation");
  });

  test("the queue shows the disagreement, and κ is reported honestly", async () => {
    await carol.goto("/projects");
    await carol.getByRole("link", { name: PROJECT }).click();
    await carol.getByRole("link", { name: /^reconcile$/i }).click();

    await expect(carol.getByRole("heading", { name: /^reconcile$/i })).toBeVisible();
    await expect(carol.getByText(/1 awaiting a third reader/i)).toBeVisible();

    const row = carol.getByRole("row", { name: /attention is all you need/i });
    await expect(row).toBeVisible();

    // Both said BLEU, so chance alone predicts complete agreement and κ is
    // undefined. The page must SAY so rather than print a confident 1.00 —
    // the whole reason cohensKappa returns null.
    await expect(carol.getByText(/κ/).first()).toBeVisible();
    await expect(carol.getByText(/undefined/i).first()).toBeVisible();
    await expect(carol.getByText(/single category/i)).toBeVisible();

    const results = await new AxeBuilder({ page: carol })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    if (results.violations.length > 0) {
      console.error(results.violations.map((v) => `${v.id}: ${v.help}`).join("\n"));
    }
    expect(results.violations).toEqual([]);
  });

  test("an extractor cannot reconcile their own disagreement", async () => {
    await alice.goto("/projects");
    await alice.getByRole("link", { name: PROJECT }).click();
    await alice.getByRole("link", { name: /^reconcile$/i }).click();
    await alice.getByRole("link", { name: /attention is all you need/i }).click();

    // Said before any work is done, not after twenty fields.
    await expect(alice.getByText(/you extracted this paper yourself/i)).toBeVisible();
  });

  test("a third reader resolves it", async () => {
    await carol.goto("/projects");
    await carol.getByRole("link", { name: PROJECT }).click();
    await carol.getByRole("link", { name: /^reconcile$/i }).click();
    await carol.getByRole("link", { name: /attention is all you need/i }).click();

    await expect(carol.getByText(/need a decision|needs a decision/i)).toBeVisible();

    // Take Alice's reading of the task, which is where they differ.
    const taskField = carol.getByRole("group", { name: /^task/i });
    await taskField.getByRole("radio").first().check();

    await carol.getByRole("button", { name: /record the reconciliation/i }).click();

    await expect(carol.getByRole("heading", { name: /^reconcile$/i })).toBeVisible();
    await expect(carol.getByText(/1 resolved/i)).toBeVisible();
  });

  test("the reconciled answers reach the evidence table", async () => {
    await carol.goto("/projects");
    await carol.getByRole("link", { name: PROJECT }).click();
    await carol.getByRole("link", { name: /^evidence$/i }).click();

    // Three rows now: Alice's, Bob's, and the reconciliation.
    await expect(
      carol.getByRole("row", { name: /attention is all you need/i }).first(),
    ).toBeVisible();
  });
});
