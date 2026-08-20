import { expect, test, type Browser, type Page } from "@playwright/test";

import { goto } from "./ready";

/**
 * A press that started something says so.
 *
 * A button that fires a server round trip and then looks exactly as it did
 * before reads as a button that did not register, and the second press is the
 * user's reasonable response to that. `Button`'s `busy` prop is the fix: the
 * label becomes the verb in progress, `aria-busy` says the same thing to a
 * screen reader, and the control refuses further presses while it means it.
 *
 * Two things are worth locking, and only one of them is "the label changes".
 *
 * The second is the harder one. Most of these screens run several actions
 * through ONE `useTransition`, so a busy state driven by that flag alone is
 * not a claim about the button it is attached to — it is a claim that
 * something, somewhere on the page, is happening. Wire it that way and
 * pressing Preview makes "Add 12 papers" announce "Adding…" while nothing is
 * being added. That is worse than silence: silence is uninformative, this is
 * false. So every shared flag is paired with the name of the action that set
 * it, and the test below presses one of two buttons and asserts the other one
 * stays quiet.
 *
 * The delay is injected rather than waited for. Server actions here finish in
 * tens of milliseconds against a local stack, so the busy window is real but
 * far too narrow to observe reliably — and a test that races it would fail on
 * a slow machine for reasons that have nothing to do with the behaviour. The
 * route handler holds the POST open, which makes the window wide and the
 * assertion deterministic.
 */

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

/** One entry, fully specified: a DOI would send the server to a real API. */
const BIBTEX = `@article{busy2026,
  title   = {A paper that needs no lookup},
  author  = {Reviewer, A. and Reviewer, B.},
  journal = {Journal of Waiting},
  year    = {2026}
}`;

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.dev`;
}

/**
 * The sign-in code, from the mailbox — and only one issued AFTER `since`.
 *
 * The `since` argument is the whole point. Without it this returns the newest
 * message for the address, which on a RETRY is the previous attempt's code:
 * Supabase invalidates the old one the moment a new one is issued, so the
 * retry signs in with a code that is guaranteed to be rejected, `waitForURL`
 * waits for a navigation that never comes, and the hook burns its full 180
 * second timeout before failing exactly as it did the first time.
 *
 * That turned every flake into three, and it is most of why a CI run took an
 * hour and twenty minutes to not finish.
 */
async function fetchOtp(email: string, since: number): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch("http://127.0.0.1:54324/api/v1/messages?limit=50");
    if (res.ok) {
      const body = (await res.json()) as {
        messages?: Array<{
          ID: string;
          Created?: string;
          To?: Array<{ Address: string }>;
        }>;
      };
      const match = body.messages?.find(
        (m) =>
          m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()) &&
          // A second of slack: mailpit stamps the message when it receives it,
          // which is fractionally after the click that caused it.
          new Date(m.Created ?? 0).getTime() >= since - 1000,
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
  throw new Error(`No OTP arrived for ${email} after ${new Date(since).toISOString()}`);
}

/**
 * The address, scoped to this attempt.
 *
 * A retry that reuses the address cannot sign in. GoTrue rate-limits OTP
 * resends, so asking again inside the window sends no new mail at all — and
 * the previous code has already been consumed. The retry then fills in a dead
 * code, waits for a navigation that never comes, and burns its whole timeout
 * failing exactly as the first attempt did. Three attempts, one outcome, and
 * most of why a CI run took an hour and twenty minutes to not finish.
 *
 * A fresh address per attempt is what makes a retry a retry.
 */
function attemptEmail(base: string): string {
  const { retry } = test.info();
  return retry > 0 ? `r${retry}-${base}` : base;
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
  await createConfirmedUser(attemptEmail(email));
  const context = await browser.newContext();
  const page = await context.newPage();
  await goto(page, "/sign-in");
  await page.getByLabel("Email").fill(email);
  // Stamped before the click: anything already in this mailbox belongs
  // to an earlier attempt and has been invalidated by this one.
  const requestedAt = Date.now();
  await page.getByRole("button", { name: /email me a .*code/i }).click();
  await page.getByLabel(/verification code/i).fill(await fetchOtp(email, requestedAt));
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(enroll|dashboard|projects)/);

  if (page.url().includes("/enroll")) {
    await page.getByRole("button", { name: /generate my keys/i }).click();
    await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL(/\/(dashboard|projects)/);
  }

  return page;
}

/**
 * Hold every server action open until released.
 *
 * Server actions are POSTs to the current URL carrying a `Next-Action` header,
 * which is what distinguishes them from any other request the page makes.
 */
function holdServerActions(page: Page) {
  let holding = true;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Registered once and never unrouted. Unrouting mid-flight aborts whatever
  // the handler is currently holding — which killed the very request the test
  // had just released, and reported it as the page never navigating.
  const routed = page.route("**/*", async (route) => {
    const request = route.request();
    const isAction =
      request.method() === "POST" && Boolean(request.headers()["next-action"]);
    if (isAction && holding) await held;
    await route.continue();
  });

  return {
    ready: routed,
    release() {
      holding = false;
      release();
    },
  };
}

test.describe("a press that started something says so", () => {
  test.describe.configure({ mode: "serial" });

  const email = uniqueEmail("busy");
  let page: Page;
  let projectId = "";

  test.beforeAll(async ({ browser }) => {
    page = await signInAndEnroll(browser, attemptEmail(email));
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("Create project becomes Creating your project…", async () => {
    await goto(page, "/projects/new");
    await page.getByLabel("Title").fill("Busy states");
    await page
      .getByRole("group", { name: /kind/i })
      .getByRole("radio", { name: /systematic review/i })
      .check();

    const hold = holdServerActions(page);
    await hold.ready;

    const create = page.getByRole("button", { name: /create project/i });
    await create.click();

    // The label IS the message — assert the words, not merely a spinner.
    const busy = page.getByRole("button", { name: /creating your project/i });
    await expect(busy).toBeVisible();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    // And it cannot be pressed a second time, which is the other half of why
    // the state exists.
    await expect(busy).toBeDisabled();

    hold.release();

    await expect(page.getByRole("link", { name: "Busy states" })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("link", { name: "Busy states" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    projectId = page.url().split("/").pop()!;
  });

  test("a busy button names its own action, and leaves the others alone", async () => {
    await goto(page, `/projects/${projectId}/import`);
    await page.getByLabel(/paste references/i).fill(BIBTEX);

    // First preview, uninterrupted, so that BOTH buttons are on screen.
    await page.getByRole("button", { name: /^preview$/i }).click();
    // Matches in BOTH states on purpose. A locator named only for the resting
    // label stops matching the moment the button goes busy, so the regression
    // would surface as "element not found" — true, but it names the wrong
    // thing. This way the failure is the claim itself: Add went busy.
    const add = page.getByRole("button", { name: /add 1 paper|adding…/i });
    await expect(add).toBeVisible({ timeout: 60_000 });

    const hold = holdServerActions(page);
    await hold.ready;

    // Press Preview again. Both buttons are now visible and share one
    // transition — the regression this guards is Add borrowing its state.
    await page.getByRole("button", { name: /^preview$/i }).click();

    await expect(page.getByRole("button", { name: /reading…/i })).toBeVisible();

    // The claim that matters: Add says nothing, because Add is not running.
    await expect(add).toBeVisible();
    await expect(add).not.toHaveAttribute("aria-busy", "true");
    await expect(add).toHaveText(/add 1 paper/i);

    hold.release();
    await expect(page.getByRole("button", { name: /^preview$/i })).toBeVisible({
      timeout: 60_000,
    });
  });
});
