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
const PDF_BYTES = Buffer.from(
  "%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

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
  let readUrl = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    await createConfirmedUser(strangerEmail);
    owner = await signInAndEnroll(browser, ownerEmail);
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

    await expect(owner.getByText(/the PDF is attached/i)).toBeVisible({
      timeout: 30_000,
    });

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
      body: PDF_BYTES,
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
      body: PNG_BYTES,
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
