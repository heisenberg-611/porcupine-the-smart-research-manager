import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { goto } from "./ready";

/**
 * Phase 2c week 3 — the evidence table at 300 × 20.
 *
 * Runs against the SEEDED project rather than building its own fixture, which
 * is a deliberate exception to how every other spec here works. The defects
 * under test only exist at scale: a column chooser is pointless with two
 * fields, and "you cannot read one paper without scrolling past nineteen
 * columns" is not reproducible with three. Building 300 papers and 5,000
 * answers through the UI would take longer than the rest of the suite
 * combined.
 *
 * The cost is that this spec SKIPS when the seed is absent, rather than
 * failing. A red suite that means "you did not run an optional command" is a
 * suite people learn to ignore.
 *
 *     pnpm db:seed
 *     pnpm --filter @Porcupine/web exec playwright test e2e/evidence-table.spec.ts
 */

const SEED_EMAIL = process.env.SEED_EMAIL ?? "demo@test.dev";
const SEED_TITLE = /sleep restriction and cognitive performance/i;

interface MailpitMessage {
  ID: string;
  Created: string;
  To?: Array<{ Address: string }>;
}

async function listFor(email: string): Promise<MailpitMessage[]> {
  const res = await fetch("http://127.0.0.1:54324/api/v1/messages?limit=50");
  if (!res.ok) return [];
  const body = (await res.json()) as { messages?: MailpitMessage[] };
  return (body.messages ?? []).filter((m) =>
    m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()),
  );
}

/**
 * The id of this address's newest message, read BEFORE requesting a new one.
 *
 * Unlike the other specs, this one signs in as a long-lived seeded account
 * whose inbox already has codes in it from previous runs. Polling for "a
 * message to this address" then finds a stale, already-consumed code
 * immediately, fills it in, and the sign-in fails with a navigation timeout
 * that names none of that. Supabase also rate-limits OTP sends per address, so
 * on a fast re-run there may be no new mail at all — and the old code is the
 * only thing there.
 */
async function newestId(email: string): Promise<string | null> {
  return (await listFor(email))[0]?.ID ?? null;
}

async function fetchOtpAfter(
  email: string,
  since: string | null,
): Promise<string | null> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const messages = await listFor(email);
    const fresh = messages[0];
    if (fresh && fresh.ID !== since) {
      const detail = await fetch(`http://127.0.0.1:54324/api/v1/message/${fresh.ID}`);
      const text = ((await detail.json()) as { Text?: string }).Text ?? "";
      const code = /\b(\d{6})\b/.exec(text)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

test.describe("the evidence table at scale", () => {
  test.describe.configure({ mode: "serial" });

  /*
   * Desktop only, and deliberately.
   *
   * The column chooser is not rendered below `sm`. That is partly a design
   * call — choosing among twenty columns is a desktop-shaped problem, and a
   * phone is scrolling the table horizontally whatever you do — and partly
   * containment: with the control present on the narrow layout, an existing
   * mobile test found a cell link that was visible, enabled, stable and not
   * clickable. See the BUILD-LOG for the five hypotheses that did not explain
   * it.
   *
   * The URL half of the feature (`?cols=`) is server-rendered and works on
   * every viewport; only the control is desktop-only.
   */
  test.skip(
    ({ isMobile }) => !!isMobile,
    "the column chooser is not rendered below the sm breakpoint",
  );

  let page: Page;
  let evidence = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext();
    page = await context.newPage();

    const before = await newestId(SEED_EMAIL);

    await goto(page, "/sign-in");
    await page.getByLabel("Email").fill(SEED_EMAIL);
    await page.getByRole("button", { name: /email me a code/i }).click();

    const code = await fetchOtpAfter(SEED_EMAIL, before);
    test.skip(code === null, "no sign-in code arrived — run `pnpm db:seed` first");

    await page.getByLabel(/six-digit code/i).fill(code!);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL(/\/(enroll|dashboard|projects)/);

    /*
     * Enrol only if this account actually needs it.
     *
     * Branching on `page.url().includes("/enroll")` is wrong here and it is
     * wrong in a way this repo has already been bitten by twice. The seeded
     * account is long-lived: the first run enrols it, and every run after that
     * passes THROUGH /enroll to /projects. Reading the URL catches that
     * transit and then waits thirty seconds for a button that was never going
     * to appear.
     *
     * Waiting for the button itself is the honest test of "does this account
     * need keys", and it settles either way in a few seconds.
     */
    const generate = page.getByRole("button", { name: /generate my keys/i });
    const needsKeys = await generate
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (needsKeys) {
      await generate.click();
      // Argon2id is deliberately slow.
      await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 60_000 });
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: /continue/i }).click();
    }

    await page.waitForURL(/\/(dashboard|projects)/, { timeout: 60_000 });

    await goto(page, "/projects");
    const link = page.getByRole("link", { name: SEED_TITLE });
    // waitFor, not isVisible: `isVisible` answers immediately, and the answer
    // it gave was about the loading skeleton rather than the project list —
    // so the whole spec skipped itself with "seeded review not found" against
    // a database that had 300 papers in it. The same trap the week 1 spec
    // fell into, in a different shape.
    const seeded = await link
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!seeded, "seeded review not found — run `pnpm db:seed`");
    await link.click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    evidence = `/projects/${page.url().split("/").pop()}/evidence`;
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("shows every protocol field by default", async () => {
    await goto(page, evidence);
    // 20 fields + Paper, Year, Done. The detail trigger shares the Paper cell
    // rather than taking a column of its own.
    await expect(page.locator("thead th")).toHaveCount(23);
    await expect(page.getByRole("button", { name: /columns/i })).toContainText("20/20");
  });

  test("narrowing the columns changes the table and the URL", async () => {
    await goto(page, evidence);
    await page.getByRole("button", { name: /columns/i }).click();

    // Scoped to the popover throughout. The filter controls above the table
    // have their own Apply and their own checkbox, so an unscoped query is a
    // strict-mode violation at best and clicks the wrong control at worst.
    const chooser = page.getByLabel("Columns");

    // Turn off everything except the first two fields.
    const boxes = chooser.getByRole("checkbox");
    const count = await boxes.count();
    for (let i = 2; i < count; i++) await boxes.nth(i).uncheck();

    await chooser.getByRole("button", { name: /^apply$/i }).click();
    await page.waitForURL(/cols=/);

    // 2 fields + Paper, Year, Done.
    await expect(page.locator("thead th")).toHaveCount(5);

    // The URL is the state, so the narrowed table is a link someone can send.
    // If this ever becomes component state, the whole feature stops being
    // shareable and this is the assertion that says so.
    // Read through URLSearchParams rather than matching the raw string: the
    // comma is percent-encoded on the way out, and asserting the encoded form
    // would be asserting an implementation detail of URLSearchParams.
    expect(new URL(page.url()).searchParams.get("cols")).toBe("sample_size,design");
  });

  test("an unknown column key is dropped, not rendered blank", async () => {
    // The obvious thing to do with a URL parameter is edit it. A typo must
    // vanish rather than becoming a column with no header and no data.
    await goto(page, `${evidence}?cols=sample_size,not_a_real_field`);
    await expect(page.locator("thead th")).toHaveCount(4);
  });

  test("and a wholly unrecognised list falls back to every column", async () => {
    // Otherwise the table becomes a list of titles with no way back that is
    // visible on the page.
    await goto(page, `${evidence}?cols=nonsense`);
    await expect(page.locator("thead th")).toHaveCount(23);
  });

  test("the export follows the columns on screen", async () => {
    await goto(page, `${evidence}?cols=sample_size,design`);

    /*
     * Read the href off the REAL button rather than constructing the URL.
     *
     * The first version of this test built `?cols=...&format=csv` by hand and
     * passed against a page whose Export button did not carry `cols` at all —
     * so a user narrowing the table to two fields and clicking Export got
     * twenty. The test asserted the route's behaviour and called it the
     * feature's.
     */
    const href = await page
      .getByRole("link", { name: /export csv/i })
      .getAttribute("href");
    expect(href, "the export link should carry the column selection").toContain("cols=");

    const response = await page.request.get(href!);
    expect(response.ok()).toBe(true);

    const header = (await response.text()).split("\r\n")[0]!;
    // Field keys, not labels — the reason keys are immutable.
    expect(header).toContain("sample_size");
    expect(header).toContain("design");
    // An export that quietly hands back all twenty columns is the export
    // disagreeing with the screen it came from.
    expect(header).not.toContain("risk_of_bias");
  });

  test("no accessibility violations, with the column chooser open", async () => {
    await goto(page, evidence);
    await page.getByRole("button", { name: /columns/i }).click();
    await expect(page.getByLabel("Columns")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
