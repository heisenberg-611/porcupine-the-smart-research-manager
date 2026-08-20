import { execFileSync } from "node:child_process";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { colourFor } from "../src/lib/annotation-colour";
import { goto } from "./ready";

/**
 * File storage, stage 2 — attaching a PDF to a paper.
 *
 * docs/12-file-storage-build-plan.md §10 states the acceptance criteria for
 * the phase, and three of them are here: a member can upload a PDF to a paper,
 * a member of a different project receives nothing from the storage API when
 * asking for it by path, and a file that is not a PDF never reaches the bucket.
 *
 * Its own project rather than the seed, because the seed has no files and this
 * needs to watch one arrive.
 */

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

/**
 * Enough of a PDF for every check in the pipeline.
 *
 * Not a real document: nothing here renders it. What matters is the five-byte
 * signature the server reads back over a Range request, which is the one
 * property an uploader cannot assert about itself.
 */
const PDF_BYTES = buildPdf([
  "Sleep restriction impaired vigilance in every cohort we examined.",
  "Effect sizes on the second page were smaller but consistently negative.",
]);

/**
 * A real, parseable PDF with one line of text per page.
 *
 * Built by hand because nothing in the tree ships one, and stage 3 needs a
 * file pdf.js will actually extract text from — a stub with a `%PDF-` header
 * satisfies the magic-byte check and yields no pages, which would let the
 * whole text pipeline pass while doing nothing.
 */
function buildPdf(pageTexts: string[]): Buffer {
  const objs: string[] = [];
  const pageIds = pageTexts.map((_, i) => 4 + i * 2);
  objs[1] = "<</Type/Catalog/Pages 2 0 R/MarkInfo<</Marked true>>>>";
  objs[2] = `<</Type/Pages/Kids[${pageIds.map((i) => `${i} 0 R`).join(" ")}]/Count ${pageTexts.length}>>`;
  objs[3] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";

  pageTexts.forEach((text, i) => {
    const id = pageIds[i]!;
    /*
     * 9pt starting at x=40, which is not a style choice.
     *
     * At 18pt from x=72 the longer of these lines runs past the right edge of
     * a 612pt page, and pdf.js drops the glyphs that fall outside the
     * MediaBox — so `getTextContent` returned "...consistently negat" and the
     * assertion below failed against a truncation this fixture had caused.
     * A test fixture that silently loses text is worse than no fixture: it
     * would mask exactly the extraction bug it exists to catch.
     */
    /*
     * Wrapped in BDC/EMC, so the fixture is TAGGED.
     *
     * Not decoration. A tagged PDF is what publishers produce, and it changes
     * both halves of the pipeline: `getTextContent()` returns marked-content
     * markers that carry no `str` (which a naive join turns into the literal
     * "undefined"), and pdf.js's text layer nests the runs inside
     * `<span class="markedContent">` with the line-break `<br>` INSIDE that
     * nesting (which a walk of direct children never counts).
     *
     * An untagged fixture cannot see either fault, so it passed while real
     * uploads came out wrong.
     */
    const stream =
      `/P <</MCID ${i}>> BDC BT /F1 9 Tf 40 700 Td ` +
      `(${text.replace(/([()\\])/g, "\\$1")}) Tj ET EMC`;
    objs[id] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${id + 1} 0 R` +
      "/Resources<</Font<</F1 3 0 R>>>>>>";
    objs[id + 1] = `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    if (!objs[i]) continue;
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }

  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) {
    out +=
      offsets[i] === undefined
        ? "0000000000 65535 f \n"
        : `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<</Size ${objs.length}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A PNG signature. The point is that it will be offered as `paper.pdf`. */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Age a row by hand.
 *
 * Both reconciler functions have a grace period, and that is not politeness —
 * an upload in flight writes its object before its confirming action runs, so
 * without the window the sweeper would delete files out from under people
 * watching a progress bar. Testing it therefore means making something old,
 * and neither `storage.objects.created_at` nor the clock is reachable through
 * an API. psql is already a hard dependency of the local stack this suite
 * needs.
 */
function backdate(sql: string) {
  execFileSync(
    "psql",
    [
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
}

/**
 * Select `length` characters inside a page's text layer.
 *
 * Playwright cannot drag-select across the layer's absolutely-positioned runs,
 * so the selection is made through the DOM and the same mouseup the component
 * listens for is dispatched.
 *
 * Walks to a TEXT NODE rather than using `firstChild`: in the plain-text
 * reader the layer's first child is the text itself, but in the rendered PDF
 * it is a `<span>` holding a run, and `setEnd(span, 24)` addresses child
 * NODES, not characters. The earlier version of this helper did exactly that
 * and captured nothing.
 */
async function selectInLayer(page: Page, pageNumber: number, length: number) {
  return page.evaluate(
    ({ pageNumber, length }) => {
      const layer = document.querySelector(
        `[data-page="${pageNumber}"] [data-section-index], [data-section-index]`,
      );
      if (!layer) return null;

      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text | null;
      while (node && node.length < length) node = walker.nextNode() as Text | null;
      if (!node) return null;

      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      layer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return range.toString();
    },
    { pageNumber, length },
  );
}

/** One value out of the database, for assertions no API exposes. */
function query(sql: string): string {
  return execFileSync(
    "psql",
    ["postgresql://postgres:postgres@127.0.0.1:54322/postgres", "-tAc", sql],
    { encoding: "utf8" },
  ).trim();
}

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
 * An access token for this account, without going through the browser.
 *
 * The cross-project test needs to call the storage API *as somebody*, which is
 * the only way to ask the question it asks: RLS is evaluated on the JWT, so a
 * request with no token proves only that anonymous access is closed — which it
 * is for every bucket and would pass with the policies deleted.
 */
async function accessTokenFor(email: string): Promise<string> {
  const linked = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const otp = ((await linked.json()) as { email_otp?: string }).email_otp;
  if (!otp) throw new Error(`could not mint a link for ${email}`);

  const verified = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email, token: otp }),
  });
  const token = ((await verified.json()) as { access_token?: string }).access_token;
  if (!token) throw new Error(`could not sign in ${email}`);
  return token;
}

/** The user id inside an access token, without decoding the JWT ourselves. */
async function ownerId(token: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  return ((await res.json()) as { id: string }).id;
}

/** Every object currently in the papers bucket for a project. */
async function objectsIn(projectId: string): Promise<string[]> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/papers`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix: projectId, limit: 100 }),
  });
  const body = (await res.json()) as Array<{ name: string }>;
  return Array.isArray(body) ? body.map((o) => o.name) : [];
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

  if (page.url().includes("/enroll")) {
    await page.getByRole("button", { name: /generate my keys/i }).click();
    await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL(/\/(dashboard|projects)/);
  }
  return page;
}

test.describe.configure({ mode: "serial" });

test.describe("file storage — attaching a paper's PDF", () => {
  // Desktop only. The form is the same on a phone, and running it twice
  // doubles a slow spec to prove nothing this suite does not already know
  // about responsive layout.
  test.skip(({ isMobile }) => !!isMobile, "not a layout test");

  const ownerEmail = uniqueEmail("filer");
  const strangerEmail = uniqueEmail("stranger");
  const colleagueEmail = uniqueEmail("colleague");

  let owner: Page;
  let colleague: Page;
  let projectId = "";
  let projectWorkId = "";
  let readUrl = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await createConfirmedUser(strangerEmail);
    await createConfirmedUser(colleagueEmail);
    owner = await signInAndEnroll(browser, ownerEmail);
    if (process.env.UPLOAD_DEBUG) {
      owner.on("console", (m) => console.warn(`[console.${m.type()}] ${m.text()}`));
      owner.on("pageerror", (e) => console.warn(`[pageerror] ${e.message}`));
      owner.on("requestfailed", (r) =>
        console.warn(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`),
      );
    }
  });

  test.afterAll(async () => {
    await owner?.context().close();
    await colleague?.context().close();
  });

  test("a project with one paper in it", async () => {
    await goto(owner, "/projects/new");
    await owner.getByLabel("Title").fill("File storage check");
    await owner
      .getByRole("group", { name: /kind/i })
      .getByRole("radio", { name: /systematic review/i })
      .check();
    await owner.getByRole("button", { name: /create project/i }).click();
    await expect(owner).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
    projectId = owner.url().split("/").pop()!;

    await owner.getByRole("link", { name: /^import$/i }).click();
    await owner.getByLabel(/paste references/i).fill(`
      @article{shannon1948,
        title = {A Mathematical Theory of Communication},
        author = {Shannon, Claude},
        year = {1948},
      }
    `);
    await owner.getByRole("button", { name: /preview/i }).click();
    await owner.getByRole("button", { name: /add 1 paper/i }).click();
    await expect(owner.getByText(/added 1 paper/i)).toBeVisible();

    await goto(owner, `/projects/${projectId}/library`);
    // The title IS the read link — there is no separate "Read" control.
    await owner
      .getByRole("link", { name: /mathematical theory of communication/i })
      .click();
    await owner.waitForURL(/\/read\/[0-9a-f-]{36}/);
    readUrl = owner.url();
  });

  test("a file that is not a PDF never reaches the bucket", async () => {
    /*
     * Offered as `paper.pdf` with `Content-Type: application/pdf`, so both the
     * name and the declared type are exactly what a real PDF would carry.
     * Only the bytes disagree — which is the whole reason the magic-byte check
     * exists, and the reason this assertion is about the BUCKET and not just
     * about the message on screen.
     */
    await owner.locator("#paper-pdf").setInputFiles({
      name: "paper.pdf",
      mimeType: "application/pdf",
      buffer: PNG_BYTES,
    });
    await owner.getByRole("button", { name: /attach this pdf/i }).click();

    await expect(owner.getByText(/not a PDF, whatever it is named/i)).toBeVisible();
    expect(await objectsIn(projectId), "nothing should have been uploaded").toEqual([]);
  });

  test("a member attaches the PDF, and the page says so", async () => {
    await owner.locator("#paper-pdf").setInputFiles({
      name: "shannon.pdf",
      mimeType: "application/pdf",
      buffer: PDF_BYTES,
    });
    await owner.getByRole("button", { name: /attach this pdf/i }).click();

    /*
     * Waits for the END of the job, not the middle of it.
     *
     * An earlier version waited for "The PDF is attached" — which the page
     * showed as soon as the bytes landed, while the text extraction was still
     * running. The next test then navigated and cut the remaining work off
     * mid-flight, leaving pages in the database and `text_status` stuck at
     * PENDING. The bug was real and in the product, not the test; the test's
     * share of it was asserting on an intermediate state.
     */
    await expect(owner.getByText(/reading the full text/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(owner.getByText(/the PDF is attached/i)).toBeVisible();

    // The object is really there, at the path the policy reads.
    const objects = await objectsIn(projectId);
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });

  test("and the upload form is gone, because there is nothing left to attach", async () => {
    await goto(owner, readUrl);
    await expect(owner.getByText(/the PDF is attached/i)).toBeVisible();
    await expect(owner.locator("#paper-pdf")).toHaveCount(0);
  });

  /*
   * The sweeper.
   *
   * Skipped without CRON_SECRET, because the route is closed without one and a
   * test asserting 503 would pass with the whole reconciler deleted. Run it
   * with:
   *
   *     CRON_SECRET=test-secret pnpm --filter @Porcupine/web test:e2e
   */
  /*
   * Stage 3. docs/12-file-storage-build-plan.md §6 and §10: the reader gains a
   * source, and a quote resolves to a page of the actual paper rather than to
   * a sentence in an abstract.
   */
  test("the paper's own pages become the thing you read", async () => {
    await goto(owner, readUrl);

    // Survives a reload: the text is stored, not held in the uploader's tab.
    await expect(owner.getByText(/2 pages from the attached PDF/i)).toBeVisible();

    // Labelled, because a quote's page is the citable part.
    await expect(owner.getByText(/^Page 2$/)).toBeVisible();
    await expect(owner.getByText(/impaired vigilance in every cohort/i)).toBeVisible();

    /*
     * Page two is drawn when it is reached, not before.
     *
     * The document is virtualized: a 300-page paper rendered all at once is
     * hundreds of megabytes of canvas and a tab that dies. So this scrolls, as
     * a reader would, and waits for the page to arrive.
     */
    await owner.locator('[data-page="2"]').scrollIntoViewIfNeeded();
    await expect(owner.locator('[data-page="2"] [data-section-index]')).toContainText(
      /smaller but consistently negative/i,
      { timeout: 30_000 },
    );
  });

  /*
   * The viewer. docs/13-pdf-viewer-plan.md.
   *
   * The claim is not "a canvas appeared" — it is that the page is drawn AND
   * that a selection taken from the layer over it measures against the same
   * string the anchor is stored in. The second half is the one that would rot
   * silently, so it is asserted directly.
   */
  test("the page is drawn, not transcribed", async () => {
    await goto(owner, readUrl);

    const pages = owner.locator('[data-testid="pdf-document"] [data-page]');
    await expect(pages).toHaveCount(2, { timeout: 60_000 });

    // A canvas with actual pixels in it, at the page's own aspect ratio.
    const drawn = await owner.locator('[data-page="1"] canvas').evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height };
    });
    expect(drawn.width).toBeGreaterThan(100);
    expect(drawn.height).toBeGreaterThan(drawn.width); // portrait, as built

    // The text layer is over it and is selectable — transparent, not absent.
    const layer = owner.locator('[data-page="1"] [data-section-index]');
    await expect(layer).toContainText(/impaired vigilance/i);
  });

  test("an offset taken from the rendered layer matches the stored text", async () => {
    /*
     * The join rule, checked where it actually matters.
     *
     * pdf.js marks line breaks with `<br>`, which `Range.toString()` skips
     * while the stored page string has a "\n" there. If the two disagree the
     * anchoring engine stops hitting its fast path and starts guessing between
     * repeated phrases — no error, just a slow loss of precision. This asserts
     * they agree on a page that actually has a line break in it.
     */
    const stored = query(
      `select text from file_pages fp
         join file_objects fo on fo.id = fp.file_id
        where fo.project_id = '${projectId}' and fp.page_number = 1`,
    );

    const fromLayer = await owner
      .locator('[data-page="1"] [data-section-index]')
      .evaluate((el) => {
        // Mirrors joinPageText: runs contribute their text, <br> contributes
        // the newline the stored string has.
        let text = "";
        for (const child of Array.from(el.childNodes)) {
          if (
            child.nodeType === Node.ELEMENT_NODE &&
            (child as Element).tagName === "BR"
          ) {
            text += "\n";
            continue;
          }
          text += child.textContent ?? "";
        }
        return text;
      });

    expect(fromLayer.trim()).toBe(stored.trim());
  });

  test("selecting does not move the page under you", async () => {
    /*
     * Reported from real use: "when I select text, the page drifts away".
     *
     * The viewer's highlight list was derived inline in the parent, so it had
     * a new identity on every render — and the reader re-renders on every
     * selection change. The effect that built the document listed it as a
     * dependency, so each drag tore down and rebuilt every page, and the
     * scroll position belonged to nodes that no longer existed.
     *
     * Asserted on the scroll position across a selection, and on the canvas
     * surviving: a rebuild replaces the element, so holding a reference to it
     * is how we can tell the difference between a repaint and a reconstruction.
     */
    await goto(owner, readUrl);
    await expect(owner.locator('[data-page="1"] canvas')).toBeVisible({
      timeout: 60_000,
    });

    await owner.locator('[data-page="2"]').scrollIntoViewIfNeeded();
    await expect(owner.locator('[data-page="2"] [data-section-index]')).toContainText(
      /consistently negative/i,
      { timeout: 30_000 },
    );

    const before = await owner.evaluate(() => window.scrollY);
    const marked = await owner.evaluate(() => {
      const canvas = document.querySelector('[data-page="1"] canvas');
      if (canvas) (canvas as HTMLElement).dataset.witness = "1";
      return Boolean(canvas);
    });
    expect(marked).toBe(true);

    await selectInLayer(owner, 2, 20);

    // Give React every chance to do the wrong thing before measuring.
    await expect(owner.getByRole("button", { name: /^highlight$/i })).toBeVisible();

    expect(await owner.evaluate(() => window.scrollY)).toBe(before);
    expect(
      await owner.evaluate(
        () => document.querySelector('[data-page="1"] canvas[data-witness]') !== null,
      ),
      "the page was rebuilt rather than repainted",
    ).toBe(true);
  });

  test("a selection runs through the text rather than scattering", async () => {
    /*
     * Also reported: the selection "is not in a straight line, it's gibberish".
     *
     * pdf.js positions every run absolutely, so a native selection between two
     * of them has nothing in between to travel through and the browser picks
     * its own path. pdf.js's answer is a full-height blocker appended after the
     * runs — `.endOfContent` — revealed while `.selecting` is set. Both the
     * element and the class live in pdf.js's VIEWER, which this component does
     * not use, so the vendored CSS was matching nothing.
     *
     * The check is that a selection dragged across a page yields the page's
     * text in order, rather than a jumble of runs.
     */
    await owner.locator('[data-page="1"]').scrollIntoViewIfNeeded();

    const layer = owner.locator('[data-page="1"] [data-section-index]');
    await expect(layer).toContainText(/impaired vigilance/i, { timeout: 30_000 });

    expect(
      await owner.evaluate(
        () => document.querySelectorAll('[data-page="1"] .endOfContent').length,
      ),
      "the blocker pdf.js selection depends on must exist",
    ).toBe(1);

    const selected = await owner.evaluate(() => {
      const target = document.querySelector('[data-page="1"] [data-section-index]')!;
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? "";
    });

    // In reading order, not shuffled between absolutely positioned runs.
    expect(selected).toContain("Sleep restriction impaired vigilance");
  });

  test("the selectable text sits exactly on the drawn glyphs", async () => {
    /*
     * Reported from real use: "the selection should be more precise."
     *
     * `setLayerDimensions` CONSUMES `--total-scale-factor` — it writes
     * `width: round(down, var(--total-scale-factor) * 612px, …)` — but does
     * not set it. pdf.js's own viewer sets it on the page container, and this
     * component is not that viewer, so nothing did.
     *
     * Unset, every dependent calc() collapsed: each run's
     * `font-size: calc(var(--text-scale-factor) * var(--font-height))` fell
     * back to the browser's default 16px, so the invisible text was half again
     * as wide as the glyphs drawn beneath it. Pointing at a word selected an
     * earlier one, and the error grew along the line.
     *
     * Asserted on the geometry, because that is the fault, and then on the
     * behaviour, because that is the symptom.
     */
    await goto(owner, readUrl);
    await expect(owner.locator('[data-page="1"] canvas')).toBeVisible({
      timeout: 60_000,
    });
    await expect(owner.locator('[data-page="1"] [data-section-index]')).toContainText(
      /impaired vigilance/i,
      { timeout: 30_000 },
    );

    const geometry = await owner.evaluate(() => {
      const layer = document.querySelector(
        '[data-page="1"] [data-section-index]',
      ) as HTMLElement;
      const run = layer.querySelector("span") as HTMLElement;
      const canvas = document.querySelector('[data-page="1"] canvas') as HTMLElement;
      return {
        scale: getComputedStyle(layer).getPropertyValue("--total-scale-factor").trim(),
        fontSize: parseFloat(getComputedStyle(run).fontSize),
        fontHeight: parseFloat(run.style.getPropertyValue("--font-height")),
        canvasWidth: canvas.getBoundingClientRect().width,
      };
    });

    expect(geometry.scale, "--total-scale-factor must be set by us").not.toBe("");

    // The layer is expressed in the same scale the canvas was drawn at.
    expect(Number(geometry.scale)).toBeCloseTo(geometry.canvasWidth / 612, 2);

    /*
     * The run's font size resolves from the PDF's own font height, rather than
     * falling back to 16px. This is the assertion that fails with the bug: the
     * fallback is a round 16 and has nothing to do with --font-height.
     */
    expect(geometry.fontSize).toBeCloseTo(
      geometry.fontHeight * Number(geometry.scale),
      1,
    );

    /*
     * And the symptom: double-clicking a word selects THAT word. Real browser
     * word selection, not a synthetic drag — Playwright's mouse events do not
     * reliably drive selection across absolutely positioned, transformed runs,
     * so a drag here would be testing Playwright.
     */
    const run = owner.locator('[data-page="1"] [data-section-index] span').first();
    const box = (await run.boundingBox())!;
    await owner.mouse.dblclick(box.x + box.width * 0.2, box.y + box.height / 2);

    // 20% into "Sleep restriction impaired vigilance in every cohort we
    // examined." lands inside "restriction". With the layer mis-scaled it
    // landed several words earlier.
    expect(await owner.evaluate(() => window.getSelection()?.toString())).toBe(
      "restriction",
    );
    await expect(owner.locator("blockquote").first()).toHaveText("restriction");
  });

  test("the annotate panel appears at the selection, not at the end of the paper", async () => {
    /*
     * Reported from real use: "for annotation to register I need to go to the
     * last of the paper always".
     *
     * The compose panel sat after the document in normal flow. On a one-page
     * abstract that reads as "just below"; on a 300-page PDF it means
     * scrolling to the end of the paper to press Highlight and scrolling back
     * to carry on reading.
     *
     * Asserted as a DISTANCE from the selected text, because "near" is the
     * claim. Asserting merely that the panel exists would pass with it at the
     * bottom of a thousand-page document.
     */
    await goto(owner, readUrl);
    await expect(owner.locator('[data-page="1"] [data-section-index]')).toContainText(
      /impaired vigilance/i,
      { timeout: 60_000 },
    );

    const run = owner.locator('[data-page="1"] [data-section-index] span').first();
    const box = (await run.boundingBox())!;
    await owner.mouse.dblclick(box.x + box.width * 0.3, box.y + box.height / 2);

    const panel = owner.getByTestId("annotate-panel");
    await expect(panel).toBeVisible();

    const panelBox = (await panel.boundingBox())!;
    const gap = panelBox.y - (box.y + box.height);
    expect(gap, "the panel should sit just under the selected line").toBeGreaterThan(-4);
    expect(gap, "and not somewhere further down the document").toBeLessThan(80);

    /*
     * There was a second assertion here — that the offset between panel and
     * passage survives a scroll — and it is gone deliberately.
     *
     * It passed under `--grep` only because the page was not scrollable in
     * that subset, and failed in the full suite because scrolling brings page
     * two into the viewport, the virtualizer renders it, and the span element
     * this compared against is replaced. It was measuring virtualization, not
     * the panel. The panel is positioned absolutely inside the document's own
     * frame, so scrolling with the passage is a property of the layout rather
     * than something to assert through a re-rendering page.
     */
  });

  test("and a highlight on page two is recorded as being on page two", async () => {
    /*
     * The payoff of the whole file pipeline. `enforce_value_anchor` has
     * refused un-sourced quotes since Phase 2 and the reader has resolved
     * anchors since Phase 1, but the passage has always been a sentence in an
     * abstract. This is the first anchor into a page of a real document, and
     * the page number is the part that was never available before.
     */
    await owner.locator('[data-page="2"]').scrollIntoViewIfNeeded();
    await expect(owner.locator('[data-page="2"] [data-section-index]')).toContainText(
      /consistently negative/i,
      { timeout: 30_000 },
    );

    const quote = await selectInLayer(owner, 2, 24);

    expect(quote, "a selection should have been captured on page 2").toBeTruthy();

    await owner.getByRole("button", { name: /^highlight$/i }).click();
    await expect(owner.getByText(/highlight saved/i)).toBeVisible();

    // Re-resolved server-side on the next render, against the page it came
    // from — so this is the round trip, not just the optimistic UI.
    await goto(owner, readUrl);
    await expect(owner.getByText(/page 2/i).last()).toBeVisible();
    await expect(owner.getByText(/lost in this document/i)).toHaveCount(0);
  });

  /*
   * Stage 4 — the payoff, and the acceptance criterion of the whole phase.
   *
   * `enforce_value_anchor` has refused un-sourced quotes since Phase 2, and
   * the evidence table's cells have opened "the passage" since then too — but
   * the passage was always a sentence in an abstract. This is the first time
   * an extraction quote points at a page of the actual paper, and the page
   * number is the part that could not exist before.
   */
  test("a second member's marks are their own colour, with their name", async () => {
    /*
     * Two people marking the same paper is the normal case in a review, and
     * one colour for everybody turns an overlap into a single darker smear
     * that names nobody. Colour separates; the label identifies.
     */
    // The owner marks page one first, so the page carries two people's marks
    // rather than one. Both are on page 1 because only rendered pages paint,
    // and asserting across a virtualized document would be asserting on which
    // pages happened to be near the viewport.
    await goto(owner, readUrl);
    await expect(owner.locator('[data-page="1"] [data-section-index]')).toContainText(
      /impaired vigilance/i,
      { timeout: 60_000 },
    );
    const ownRun = owner.locator('[data-page="1"] [data-section-index] span').first();
    const ownBox = (await ownRun.boundingBox())!;
    await owner.mouse.dblclick(
      ownBox.x + ownBox.width * 0.1,
      ownBox.y + ownBox.height / 2,
    );
    await owner.getByRole("button", { name: /^highlight$/i }).click();
    await expect(owner.getByText(/highlight saved/i)).toBeVisible();

    await goto(owner, `/projects/${projectId}`);
    await owner.getByLabel("Email").fill(colleagueEmail);
    await owner.getByLabel("Role", { exact: true }).selectOption("CONTRIBUTOR");
    await owner.getByRole("button", { name: /add member/i }).click();
    await expect(owner.getByText(/members\s*\(2\)/i)).toBeVisible();

    colleague = await signInAndEnroll(owner.context().browser()!, colleagueEmail);
    await goto(colleague, readUrl);
    await expect(colleague.locator('[data-page="1"] canvas')).toBeVisible({
      timeout: 60_000,
    });
    await expect(colleague.locator('[data-page="1"] [data-section-index]')).toContainText(
      /impaired vigilance/i,
      { timeout: 30_000 },
    );

    const run = colleague.locator('[data-page="1"] [data-section-index] span').first();
    const box = (await run.boundingBox())!;
    await colleague.mouse.dblclick(box.x + box.width * 0.45, box.y + box.height / 2);
    await colleague.getByRole("button", { name: /^highlight$/i }).click();
    await expect(colleague.getByText(/highlight saved/i)).toBeVisible();

    // The owner now sees two people's marks, in two colours, each named.
    await goto(owner, readUrl);
    await expect(owner.locator('[data-page="1"] canvas')).toBeVisible({
      timeout: 60_000,
    });
    // Marks are painted after the text layer renders, which is after the
    // canvas appears. Waiting for the canvas alone raced the paint.
    await expect(owner.locator('[data-page="1"] [data-highlight]').first()).toBeVisible({
      timeout: 30_000,
    });

    const authors = await owner.evaluate(
      () =>
        new Set(
          Array.from(
            document.querySelectorAll('[data-page="1"] [data-highlight][data-author]'),
          ).map((el) => (el as HTMLElement).dataset.author),
        ).size,
    );
    expect(authors, "both members' marks should be on the page").toBe(2);

    /*
     * Each mark carries the colour its author's id prescribes.
     *
     * NOT "the two members have different colours" — eight hues cannot
     * separate every pair, and two arbitrary accounts collide about one time
     * in eight. A test asserting they differ would pass on the draw and fail
     * on a Tuesday. The contract is the mapping, and the NAME is what
     * disambiguates a collision, which is asserted below.
     */
    const painted = await owner.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-page="1"] [data-highlight][data-author]'),
      ).map((el) => ({
        author: (el as HTMLElement).dataset.author!,
        background: (el as HTMLElement).style.background,
      })),
    );

    expect(painted.length).toBeGreaterThanOrEqual(2);
    for (const mark of painted) {
      // Spaces normalised: the browser re-serialises the colour it was given.
      const asWritten = (c: string) => c.replace(/\s+/g, "");
      expect(asWritten(mark.background), `colour for ${mark.author}`).toBe(
        asWritten(colourFor(mark.author).fill),
      );
    }

    // And one author never gets two colours on the same page.
    const perAuthor = new Map<string, Set<string>>();
    for (const mark of painted) {
      const seen = perAuthor.get(mark.author) ?? new Set();
      seen.add(mark.background);
      perAuthor.set(mark.author, seen);
    }
    for (const [author, seen] of perAuthor) {
      expect(seen.size, `${author} should have one colour`).toBe(1);
    }

    // And the name is beside the mark, not only in the list.
    const labels = await owner.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-page="1"] [data-highlight-author]'),
      ).map((el) => el.textContent),
    );
    /*
     * One label per highlight, whatever else the suite has left on this page.
     * Counting an exact number here made the test depend on how many marks
     * earlier tests happened to save, which is not the claim.
     */
    const distinctHighlights = new Set(
      painted.map((mark) => mark.author + mark.background),
    );
    expect(labels.length).toBeGreaterThanOrEqual(distinctHighlights.size);
    expect(labels.join(" "), "the colleague is named beside their mark").toMatch(
      /colleague-/,
    );
    expect(labels.join(" "), "and so is the owner").toMatch(/filer-/);
  });

  test("a private note reaches nobody else's browser", async () => {
    /*
     * Enforced by RLS, not by the UI: `annotations_select_visible` requires
     * `visibility = 'PROJECT' OR author_id = current_user_id()`, so another
     * member's private note is never sent at all.
     *
     * Asserted on what the colleague's page RECEIVED rather than on what it
     * displays — a check that only looked at rendering would pass just as well
     * against a note that arrived and was hidden with CSS.
     */
    await goto(owner, readUrl);
    const run = owner.locator('[data-page="1"] [data-section-index] span').first();
    const box = (await run.boundingBox())!;
    await owner.mouse.dblclick(box.x + box.width * 0.75, box.y + box.height / 2);

    await owner.getByRole("checkbox", { name: /private to me/i }).check();
    await owner.getByLabel(/note \(optional\)/i).fill("my own half-formed thought");
    await owner.getByRole("button", { name: /save note/i }).click();
    await expect(owner.getByText(/note saved/i)).toBeVisible();

    await goto(owner, readUrl);
    await expect(owner.getByText(/half-formed thought/i)).toBeVisible();

    await goto(colleague, readUrl);
    await expect(colleague.locator('[data-page="1"] canvas')).toBeVisible({
      timeout: 60_000,
    });
    // Present for its author, absent for everyone else — including from the
    // page source, not merely from view.
    await expect(colleague.getByText(/half-formed thought/i)).toHaveCount(0);
    expect(await colleague.content()).not.toContain("half-formed thought");
  });

  test("an extraction quotes page two of the real paper", async () => {
    await goto(owner, `/projects/${projectId}/protocol`);
    await owner.getByLabel(/protocol name/i).fill("Data extraction");
    await owner.getByRole("button", { name: /create protocol/i }).click();

    await owner.getByRole("button", { name: /add a question/i }).click();
    await owner.getByLabel(/^label$/i).fill("Key finding");
    await owner.getByLabel(/^type$/i).selectOption("QUOTE");
    await owner.getByRole("button", { name: /^add question$/i }).click();
    await expect(owner.getByText("Key finding")).toBeVisible();

    await goto(owner, `/projects/${projectId}/library`);
    await owner
      .getByRole("row", { name: /mathematical theory/i })
      .getByRole("link", { name: /^extract$/i })
      .click();
    await owner.waitForURL(/\/extract\/[0-9a-f-]{36}/);
    projectWorkId = owner.url().split("/").pop()!;
    await owner.getByRole("button", { name: /start extracting/i }).click();

    // The source panel is the paper now, page by page — not its abstract.
    await expect(owner.getByText(/^Page 2$/)).toBeVisible();

    /*
     * Scoped to this field's own button.
     *
     * The default template arrives with quote-typed fields of its own, so
     * there are three "Quote from the paper" buttons on the page and an
     * unscoped match is a strict-mode violation — correctly, since clicking
     * the wrong one would put the answer in the wrong question.
     */
    await owner
      .locator('[data-field-key="key_finding"]')
      .getByRole("button", { name: /quote from the paper/i })
      .click();

    const quote = await owner.evaluate(() => {
      const blocks = document.querySelectorAll('[data-testid="extract-source"]');
      const second = blocks[1];
      if (!second?.firstChild) return null;
      const range = document.createRange();
      range.setStart(second.firstChild, 0);
      range.setEnd(second.firstChild, 30);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      second.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return range.toString();
    });

    expect(quote, "a quote should have been captured from page 2").toContain("Effect");

    /*
     * A DRAFT, not a submission.
     *
     * Submitting requires every required field of the template answered, which
     * is a lot of typing to prove nothing this test is about. Saving is what
     * writes the anchor, and the anchor is the claim: its page number could not
     * have existed before the file pipeline.
     */
    await owner.getByRole("button", { name: /save draft/i }).click();
    await expect(owner.getByText(/^Saved /)).toBeVisible();
  });

  test("and the stored anchor carries the page it came from", async () => {
    const row = query(
      `select coalesce(page::text, 'NULL') || '|' || left(quote, 6)
         from anchors
        where project_id = '${projectId}'
        order by created_at desc limit 1`,
    );

    // Page 2, from the second page's text — not NULL, which is what every
    // anchor in this product carried until now.
    expect(row).toBe("2|Effect");
  });

  test("and following it opens the paper at that page", async () => {
    const anchorId = query(
      `select id from anchors where project_id = '${projectId}'
        order by created_at desc limit 1`,
    );

    await goto(owner, `/projects/${projectId}/read/${projectWorkId}?anchor=${anchorId}`);

    /*
     * OK, not DRIFTED and not BROKEN.
     *
     * The extraction form and the reader load the paper through the same
     * helper, so the text a quote was captured against is character-for-
     * character the text it is resolved against. If those two ever loaded the
     * document differently, this is the assertion that would say so — quietly
     * degrading to "possibly moved" is exactly the failure the anchoring
     * engine exists to make visible.
     */
    await expect(
      owner.getByText(/showing the passage this evidence came from/i),
    ).toBeVisible();
    await expect(owner.getByText(/could not be found/i)).toHaveCount(0);
    await expect(owner.getByText(/wording here has changed/i)).toHaveCount(0);
  });

  test("the sweeper deletes bytes that no record claims", async () => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "no CRON_SECRET, so the endpoint is closed");

    const token = await accessTokenFor(ownerEmail);
    const orphan = `${projectId}/${crypto.randomUUID()}.pdf`;

    // Straight to the bucket, as the app never does: this is the shape of an
    // upload whose confirming call was lost. Nothing in the product can see
    // it, nobody can delete it, and it bills forever.
    const planted = await fetch(`${SUPABASE_URL}/storage/v1/object/papers/${orphan}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf",
      },
      body: new Uint8Array(PDF_BYTES),
    });
    expect(planted.ok, "the plant itself must succeed").toBe(true);

    backdate(
      `update storage.objects set created_at = now() - interval '2 hours' where name = '${orphan}'`,
    );

    const swept = await fetch(
      `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}/tasks/reconcile-uploads`,
      {
        headers: { Authorization: `Bearer ${secret}` },
      },
    );
    expect(swept.status).toBe(200);
    expect((await swept.json()).orphans_deleted).toBeGreaterThanOrEqual(1);

    // The attached file is still there. A sweeper that cannot tell the two
    // apart is worse than none.
    const left = await objectsIn(projectId);
    expect(left).toHaveLength(1);
    expect(orphan.endsWith(left[0]!)).toBe(false);
  });

  test("and refuses a planted non-PDF that never went past the browser", async () => {
    const secret = process.env.CRON_SECRET;
    test.skip(!secret, "no CRON_SECRET, so the endpoint is closed");

    /*
     * The check the client cannot be trusted to make.
     *
     * The refusal test above is a BROWSER refusal: the form reads the first
     * five bytes and never uploads. That is the fast path, and it proves
     * nothing about an upload that skips the form — which is the only kind an
     * attacker would make. So this one plants the row and the bytes directly,
     * as a modified client would, and lets the server meet the file for the
     * first time on its own.
     *
     * PNG bytes, `.pdf` name, `Content-Type: application/pdf`: past the
     * extension, past the bucket's `allowed_mime_types`, and into the one
     * check that reads the file itself.
     */
    const token = await accessTokenFor(ownerEmail);
    const auth = {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const works = await fetch(
      `${SUPABASE_URL}/rest/v1/project_works?project_id=eq.${projectId}&select=work_id`,
      { headers: auth },
    );
    const workId = ((await works.json()) as Array<{ work_id: string }>)[0]!.work_id;

    const fileId = crypto.randomUUID();
    const path = `${projectId}/${fileId}.pdf`;

    const planted = await fetch(`${SUPABASE_URL}/storage/v1/object/papers/${path}`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/pdf",
      },
      body: new Uint8Array(PNG_BYTES),
    });
    expect(
      planted.ok,
      "the bucket accepts it — the declared type is honest-looking",
    ).toBe(true);

    const row = await fetch(`${SUPABASE_URL}/rest/v1/file_objects`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        id: fileId,
        owner_id: (await ownerId(token)) as string,
        project_id: projectId,
        work_id: workId,
        bucket: "papers",
        storage_path: path,
        mime_type: "application/pdf",
        size_bytes: PNG_BYTES.length,
        sha256: "0".repeat(64),
        upload_state: "PENDING",
        updated_at: new Date().toISOString(),
      }),
    });
    expect(row.ok, await row.text()).toBe(true);

    backdate(
      `update file_objects set created_at = now() - interval '2 hours' where id = '${fileId}'`,
    );

    const swept = await fetch(
      `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}/tasks/reconcile-uploads`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    expect(swept.status).toBe(200);
    expect((await swept.json()).abandoned).toBeGreaterThanOrEqual(1);

    // The bytes are gone and the record says why it will not be retried.
    const state = await fetch(
      `${SUPABASE_URL}/rest/v1/file_objects?id=eq.${fileId}&select=upload_state`,
      { headers: auth },
    );
    expect(
      ((await state.json()) as Array<{ upload_state: string }>)[0]?.upload_state,
    ).toBe("ORPHANED");

    const remaining = await objectsIn(projectId);
    expect(remaining.some((name) => name === `${fileId}.pdf`)).toBe(false);
  });

  test("a member of a different project gets nothing when asking by path", async () => {
    /*
     * The acceptance criterion, asked the way an attacker would: not through
     * the UI, which never offers the path, but straight at the storage API
     * with a valid token for a real account that simply is not in this
     * project. If this returns 200 the whole boundary is decorative.
     */
    const objects = await objectsIn(projectId);
    const path = `${projectId}/${objects[0]}`;
    const token = await accessTokenFor(strangerEmail);

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/papers/${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });

    expect(res.status, "a non-member must not be served the bytes").not.toBe(200);

    // And the owner still can, so the assertion above is about membership
    // rather than about a path that does not resolve for anybody.
    const ownerToken = await accessTokenFor(ownerEmail);
    const mine = await fetch(`${SUPABASE_URL}/storage/v1/object/papers/${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${ownerToken}` },
    });
    expect(mine.status, "the project's own member must be served the bytes").toBe(200);
  });

  /*
   * Last, and deliberately: this dismantles the fixture every test above
   * depends on. Ordering it earlier made the sweeper test fail for a reason
   * that had nothing to do with the sweeper.
   */
  test("the PDF can be removed, from the database and from storage", async () => {
    await goto(owner, readUrl);

    const before = await objectsIn(projectId);
    expect(before, "the paper should still be attached").toHaveLength(1);

    /*
     * The attached file specifically, not "every file row in the project".
     * An earlier test plants a second, ORPHANED row on purpose, so a
     * project-wide count would never reach zero and would be asserting
     * something this test does not mean.
     */
    const attachedId = query(
      `select id from file_objects
        where project_id = '${projectId}' and upload_state = 'COMPLETE'`,
    );
    expect(attachedId).toMatch(/^[0-9a-f-]{36}$/);

    // Two steps, and the second one states the consequence.
    await owner.getByRole("button", { name: /remove the PDF/i }).click();
    await expect(
      owner.getByText(/highlights and quotes taken from its pages are kept/i),
    ).toBeVisible();
    await owner.getByRole("button", { name: /yes, remove it/i }).click();

    // Back to the upload form, which is the page saying the file is gone.
    await expect(owner.locator("#paper-pdf")).toBeVisible({ timeout: 30_000 });
    await expect(owner.getByText(/the PDF is attached/i)).toHaveCount(0);

    // The bytes are gone from storage too — the point of the request.
    expect(await objectsIn(projectId)).toHaveLength(0);

    // The record went with them, and its page text by cascade.
    expect(query(`select count(*) from file_objects where id = '${attachedId}'`)).toBe(
      "0",
    );
    expect(query(`select count(*) from file_pages where file_id = '${attachedId}'`)).toBe(
      "0",
    );
  });

  test("but the evidence taken from it survives, and says it cannot be found", async () => {
    /*
     * A quote recorded against page 2 is a claim somebody made about this
     * paper. Removing the file does not unmake it, so the anchor stays and
     * reports honestly — which is the anchoring engine doing its job rather
     * than the file taking the record down with it.
     */
    expect(
      query(`select count(*) from anchors where project_id = '${projectId}'`),
    ).not.toBe("0");

    const anchorId = query(
      `select id from anchors where project_id = '${projectId}' order by created_at desc limit 1`,
    );
    await goto(owner, `/projects/${projectId}/read/${projectWorkId}?anchor=${anchorId}`);
    await expect(
      owner.getByText(/could not be found in the current text/i),
    ).toBeVisible();
  });
});
