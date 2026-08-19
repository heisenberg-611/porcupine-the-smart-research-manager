import { execFileSync } from "node:child_process";

import { expect, test, type Browser, type Page } from "@playwright/test";

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
  objs[1] = "<</Type/Catalog/Pages 2 0 R>>";
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
    const stream = `BT /F1 9 Tf 40 700 Td (${text.replace(/([()\\])/g, "\\$1")}) Tj ET`;
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

  let owner: Page;
  let projectId = "";
  let projectWorkId = "";
  let readUrl = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await createConfirmedUser(strangerEmail);
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

    // Both pages, and labelled — a quote's page is the citable part.
    await expect(owner.getByText(/impaired vigilance in every cohort/i)).toBeVisible();
    await expect(owner.getByText(/smaller but consistently negative/i)).toBeVisible();
    await expect(owner.getByText(/^Page 2$/)).toBeVisible();
  });

  test("and a highlight on page two is recorded as being on page two", async () => {
    /*
     * The payoff of the whole file pipeline. `enforce_value_anchor` has
     * refused un-sourced quotes since Phase 2 and the reader has resolved
     * anchors since Phase 1, but the passage has always been a sentence in an
     * abstract. This is the first anchor into a page of a real document, and
     * the page number is the part that was never available before.
     */
    const quote = await owner.evaluate(() => {
      const blocks = document.querySelectorAll("[data-section-index]");
      const second = blocks[1];
      if (!second?.firstChild) return null;
      const range = document.createRange();
      range.setStart(second.firstChild, 0);
      range.setEnd(second.firstChild, 24);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      second.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return range.toString();
    });

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
});
