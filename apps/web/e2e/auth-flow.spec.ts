import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { goto } from "./ready";

/**
 * Phase 0 exit criterion, end to end:
 *   sign up → enroll identity keys → create a project → invite a member
 *
 * Runs against the real local Supabase stack. The OTP is read from the
 * database rather than from an inbox, which is why sign-in uses a code
 * instead of a magic link — an emailed link cannot be tested without
 * driving a mail client.
 *
 * These tests are serial and share one account: enrollment is once-only by
 * design, so a fresh account per test would mean re-proving the same thing.
 */

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.dev`;
}

/**
 * Reads the most recent OTP from Mailpit, which the local stack uses as its
 * mail sink.
 */
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
        const text =
          ((await detail.json()) as { Text?: string; HTML?: string }).Text ?? "";
        const code = /\b(\d{6})\b/.exec(text)?.[1];
        if (code) return code;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No OTP arrived for ${email}`);
}

/** Creates a confirmed account directly, for the invitee. */
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

test.describe.configure({ mode: "serial" });

test.describe("Phase 0 exit criterion", () => {
  const email = uniqueEmail("lead");
  const inviteeEmail = uniqueEmail("sup");

  // One page for the whole block. Playwright gives each test a fresh context,
  // which would drop the session cookie between steps — and this is a single
  // continuous journey, not seven independent assertions.
  let page: Page;
  // An explicit context, not browser.newPage(): @axe-core/playwright needs to
  // reach the browser through page.context() to inject itself, and refuses a
  // page created directly off the browser.
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("signs up with an email OTP", async () => {
    await goto(page, "/sign-in");

    await page.getByLabel("Email").fill(email);
    /*
     * `/email me a .*code/`, not `/email me a code/`.
     *
     * The button says "Email me a login code" or "Email me a signup code"
     * depending on which mode the form is in — a distinction worth having, and
     * one that broke every spec in this directory when it landed, because all
     * nine of them matched on the exact old string. Twenty-four tests failed
     * with "Target page, context or browser has been closed", which is what a
     * locator that never resolves looks like once the timeout kills the
     * context, and says nothing at all about a renamed button.
     *
     * Same for the code field below: its label is "Verification code" now, not
     * "six-digit code".
     */
    await page.getByRole("button", { name: /email me a .*code/i }).click();

    await expect(page.getByLabel(/verification code/i)).toBeVisible();

    const code = await fetchOtp(email);
    await page.getByLabel(/verification code/i).fill(code);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    // A new account has no identity keys, so it lands in enrollment.
    await expect(page).toHaveURL(/\/enroll/);
    await expect(page.getByRole("heading", { name: /one-time setup/i })).toBeVisible();
  });

  test("generates identity keys and shows the recovery passphrase once", async () => {
    await goto(page, "/enroll");
    await page.getByRole("button", { name: /generate my keys/i }).click();

    // Argon2id is deliberately slow.
    const passphrase = page.locator("p.font-mono");
    await expect(passphrase).toBeVisible({ timeout: 30_000 });
    await expect(passphrase).toHaveText(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){5}$/);

    // The warning must be present at the moment the passphrase is shown,
    // not buried in a help article.
    await expect(page.getByText(/cannot be recovered/i)).toBeVisible();

    // Continue is gated on acknowledging that the passphrase was saved.
    const cont = page.getByRole("button", { name: /continue/i });
    await expect(cont).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(cont).toBeEnabled();
    await cont.click();

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("enrollment does not run twice", async () => {
    // Keys already exist, so /enroll must redirect rather than offer to
    // overwrite them — regenerating would strand every existing ciphertext.
    await goto(page, "/enroll");
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("creates a project and becomes its owner", async () => {
    await goto(page, "/projects");
    // Scoped: React streams into a `<div hidden>` that survives until
    // hydration, so an unscoped `getByText` can match the page twice.
    await expect(page.getByRole("main").getByText(/no projects yet/i)).toBeVisible();

    // The form has a page of its own now — it used to sit under the list, so
    // an empty account's call to action pointed DOWN the page at a form the
    // reader had already scrolled past.
    await page.getByRole("link", { name: /start your first project/i }).click();
    await expect(page).toHaveURL(/\/projects\/new/);

    await page.getByLabel("Title").fill("Transformer efficiency in low-resource NLP");
    await page
      .getByRole("group", { name: /kind/i })
      .getByRole("radio", { name: /thesis or dissertation/i })
      .check();
    await page.getByRole("button", { name: /create project/i }).click();

    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
    await expect(
      page.getByRole("heading", { name: /transformer efficiency/i }),
    ).toBeVisible();

    // The creator's OWNER membership is written in the same transaction as
    // the project — without it the project would be invisible to everyone,
    // including its creator.
    // exact: getByText does case-insensitive substring matching, so a bare
    // "OWNER" also matches an email address containing "owner".
    await expect(page.getByText("OWNER", { exact: true })).toBeVisible();
    await expect(page.getByText(/members\s*\(1\)/i)).toBeVisible();
  });

  test("invites an existing user as a supervisor", async () => {
    await createConfirmedUser(inviteeEmail);

    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();

    await page.getByLabel("Email").fill(inviteeEmail);
    await page.getByLabel("Role", { exact: true }).selectOption("REVIEWER");

    // ADR-006: the history prompt appears only for reviewers, which is the
    // case where it carries weight.
    await expect(page.getByLabel(/history access/i)).toBeVisible();
    await page.getByLabel(/history access/i).selectOption("ALL_HISTORY");

    await page.getByRole("button", { name: /add member/i }).click();

    await expect(page.getByText(/member added/i)).toBeVisible();
    await expect(page.getByText(/members\s*\(2\)/i)).toBeVisible();
    await expect(page.getByText("REVIEWER", { exact: true })).toBeVisible();
  });

  test("refuses to invite an address with no account", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();

    await page.getByLabel("Email").fill(uniqueEmail("stranger"));
    await page.getByRole("button", { name: /add member/i }).click();

    await expect(page.getByText(/no Porcupine account/i)).toBeVisible();
  });

  test("search page is reachable, accessible, and degrades on provider failure", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    // Anchored. A project page legitimately offers this destination more than
    // once now — the section nav, the workspace directory, and (on an empty
    // library) the recommended next action — and an unanchored regex matches
    // an accessible name by substring, so it caught all three. The nav link is
    // the stable one.
    await page.getByRole("link", { name: /^find papers$/i }).click();

    await expect(page.getByRole("heading", { name: /find papers/i })).toBeVisible();
    await expect(page.getByLabel(/search terms/i)).toBeVisible();

    // G-07 for an authenticated route. The a11y spec covers only public
    // pages because it has no session; this one does, so the check belongs
    // here rather than nowhere.
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    if (results.violations.length > 0) {
      console.error(
        results.violations
          .map(
            (v: { id: string; impact?: string | null; help: string }) =>
              `${v.id} (${v.impact}): ${v.help}`,
          )
          .join("\n"),
      );
    }
    expect(results.violations).toEqual([]);

    // A real federated search would hit five external APIs, which makes this
    // suite depend on someone else's uptime. What is asserted instead is the
    // part that is ours: validation runs, and the page reports rather than
    // crashes.
    await page.getByLabel(/search terms/i).fill("a");
    await page.getByRole("button", { name: /^search$/i }).click();
    // Scoped to the form's own alert: Next renders a route announcer with
    // role="alert" too, so a bare getByRole("alert") is ambiguous.
    await expect(page.getByText(/enter at least two characters/i)).toBeVisible();
  });

  test("imports BibTeX into the library", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^import$/i }).click();

    // No DOIs and no arXiv ids, so this exercises parsing and writing without
    // depending on any external provider being up.
    await page.getByLabel(/paste references/i).fill(`
      @inproceedings{vaswani2017,
        title = {Attention Is All You Need},
        author = {Vaswani, Ashish and Shazeer, Noam},
        booktitle = {NeurIPS},
        year = {2017},
        abstract = {The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence entirely.}
      }

      @article{devlin2019,
        title = {{BERT}: Pre-training of Deep Bidirectional Transformers},
        author = {Devlin, Jacob},
        journal = {NAACL},
        year = {2019}
      }
    `);

    await page.getByRole("button", { name: /preview/i }).click();

    await expect(page.getByText(/read as .*bibtex/i)).toBeVisible();

    // Scoped to the preview list: the textarea still holds the pasted source,
    // so a bare getByText matches the input as well as the parsed result.
    const preview = page.getByRole("list", { name: /references to import/i });
    await expect(preview.getByText("Attention Is All You Need")).toBeVisible();
    // Brace-protected capitalization survives as plain text.
    await expect(preview.getByText(/^BERT: Pre-training/)).toBeVisible();

    await page.getByRole("button", { name: /add 2 papers/i }).click();
    await expect(page.getByText(/added 2 papers/i)).toBeVisible();

    // And it is actually in the library, which is the part that proves the
    // upsert_work + project_works transaction ran under RLS.
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^library$/i }).click();

    await expect(page.getByRole("heading", { name: /library/i })).toBeVisible();
    await expect(
      page.getByRole("cell", { name: /attention is all you need/i }),
    ).toBeVisible();
    await expect(page.getByText(/2 papers/i).first()).toBeVisible();
  });

  test("re-importing the same references adds nothing", async () => {
    // upsert_work dedupes on (title_norm, year) when there is no identifier,
    // so the second import must be a no-op rather than a duplicate.
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^import$/i }).click();

    await page
      .getByLabel(/paste references/i)
      .fill(
        `@inproceedings{vaswani2017, title = {Attention Is All You Need}, year = {2017}}`,
      );
    await page.getByRole("button", { name: /preview/i }).click();
    await page.getByRole("button", { name: /add 1 paper/i }).click();

    await expect(page.getByText(/added 0 papers.*already in the library/i)).toBeVisible();
  });

  test("screens a paper and records the decision", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^screen$/i }).click();

    await expect(page.getByRole("heading", { name: /^screen$/i })).toBeVisible();

    // Two papers were imported earlier in this run.
    await expect(page.getByText(/2 left/i)).toBeVisible();

    const first = await page.locator("article h2").innerText();
    await page.getByRole("button", { name: /^include$/i }).click();

    await expect(page.getByText(/1 left/i)).toBeVisible();
    await expect(page.getByText(/1 decided this session/i)).toBeVisible();
    // The decided paper is gone from the queue, not merely re-labelled.
    await expect(page.locator("article h2")).not.toHaveText(first);

    // And it moved in the library.
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^library$/i }).click();
    await expect(page.getByRole("link", { name: /included/i })).toBeVisible();
  });

  test("assignment puts a paper in my queue", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^screen$/i }).click();

    const title = await page.locator("article h2").innerText();
    // selectOption takes a literal label, so pick the option whose text ends
    // in "(me)" — the page marks the signed-in member that way.
    const assign = page.getByLabel(/assign to/i);
    const myOption = await assign.locator("option", { hasText: "(me)" }).innerText();
    await assign.selectOption({ label: myOption });

    // Wait for the confirmation rather than racing the server action.
    await expect(page.getByRole("main").getByText(/^assigned to /i)).toBeVisible();

    await goto(page, "/assigned");
    await expect(page.getByRole("heading", { name: /assigned to me/i })).toBeVisible();
    await expect(page.getByRole("main").getByText(title)).toBeVisible();
  });

  test("highlights a passage and re-resolves the anchor on reload", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^library$/i }).click();
    await page.getByRole("link", { name: /attention is all you need/i }).click();

    await expect(
      page.getByRole("heading", { name: /attention is all you need/i }),
    ).toBeVisible();
    const reader = page.getByTestId("reader-text");
    await expect(reader).toBeVisible();

    // Playwright cannot drag-select reliably across text nodes, so the
    // selection is made through the DOM and the same mouseup the component
    // listens for is dispatched.
    const quote = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="reader-text"]');
      if (!el?.firstChild) return null;
      const node = el.firstChild;
      const range = document.createRange();
      range.setStart(node, 12);
      range.setEnd(node, 64);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return range.toString();
    });

    expect(quote).toBeTruthy();
    await expect(page.getByRole("button", { name: /^highlight$/i })).toBeVisible();
    await page.getByRole("button", { name: /^highlight$/i }).click();
    await expect(page.getByText(/highlight saved/i)).toBeVisible();

    // Reload: the anchor is re-resolved server-side against the current text.
    // If it came back OK the passage is painted and no warning is shown —
    // which is what proves resolution ran rather than offsets being trusted.
    await page.reload();
    await expect(page.getByRole("heading", { name: /annotations/i })).toContainText(
      "(1)",
    );
    await expect(page.locator("mark")).toHaveCount(1);
    await expect(page.locator("mark")).toHaveText(quote!.trim());
    await expect(page.getByText(/possibly moved|lost in this document/i)).toHaveCount(0);
  });

  test("progress reflects the screening decisions made", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^progress$/i }).click();

    await expect(page.getByRole("heading", { name: /^progress$/i })).toBeVisible();

    // Two papers imported, one included during the screening test.
    await expect(page.getByRole("term").filter({ hasText: /^Papers$/ })).toBeVisible();
    const papers = page.locator("dt", { hasText: /^Papers$/ }).locator("+ dd");
    await expect(papers).toHaveText("2");

    const screened = page.locator("dt", { hasText: /^Decided/ }).locator("+ dd");
    await expect(screened).toHaveText("1");

    // The pipeline meters announce their values rather than being decorative.
    await expect(page.getByRole("meter", { name: /included/i })).toHaveAttribute(
      "aria-valuenow",
      "1",
    );

    // A rate this small must NOT produce a finish-date estimate.
    await expect(page.getByText(/too few recent decisions/i)).toBeVisible();
  });

  test("PRISMA flow is derived from real decisions", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^prisma$/i }).click();

    await expect(page.getByRole("heading", { name: /prisma 2020 flow/i })).toBeVisible();
    await expect(
      page.getByRole("img", { name: /prisma 2020 flow diagram/i }),
    ).toBeVisible();

    // Two papers imported, one included during the screening test.
    const table = page.getByRole("table");
    await expect(table.getByRole("row", { name: /records screened/i })).toContainText(
      "2",
    );
    await expect(table.getByRole("row", { name: /^studies included/i })).toContainText(
      "1",
    );

    // The review is unfinished, so the page has to say so rather than let a
    // snapshot be mistaken for a final count.
    await expect(page.getByRole("status")).toContainText(/still to be screened/i);

    // And it names what it cannot report instead of drawing a zero.
    await expect(page.getByText(/not tracked yet/i)).toBeVisible();
    await expect(page.getByText(/reports not retrieved/i)).toBeVisible();
  });

  test("the app shell reaches every area without the back button", async () => {
    // The defect this shell fixes: thirteen pages shipped with no navigation,
    // so landing on /queue left nowhere to go. Asserted from a deep page, not
    // from /projects, because that was exactly the trap.
    await goto(page, "/assigned");

    const nav = page.getByRole("navigation", { name: /main/i });
    await expect(nav).toBeVisible();

    /*
     * Below `sm` the header carries Dashboard alone. That is a width
     * calculation, not a preference: four links plus the theme control plus
     * Sign out do not fit on a 412px row, and a header that wraps to two rows
     * covers the top of the page — which is how a link in the evidence table
     * became unclickable.
     *
     * So the claim being tested is reachability, not a particular link on a
     * particular viewport, and on a phone the route is one hop longer. This
     * used to click the desktop links on both viewports and pass, because the
     * `hidden` that was supposed to drop them never applied — the header was
     * silently wrapping on every phone run.
     */
    const compact = (page.viewportSize()?.width ?? 0) < 640;

    if (compact) {
      await nav.getByRole("link", { name: /^dashboard$/i }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.getByRole("link", { name: /\d+ projects/i }).click();
      await expect(page).toHaveURL(/\/projects$/);

      await nav.getByRole("link", { name: /^dashboard$/i }).click();
      await page.getByRole("link", { name: /\d+ assigned to you/i }).click();
      await expect(page).toHaveURL(/\/assigned$/);
    } else {
      await nav.getByRole("link", { name: /^projects$/i }).click();
      await expect(page).toHaveURL(/\/projects$/);

      await nav.getByRole("link", { name: /assigned to me/i }).click();
      await expect(page).toHaveURL(/\/assigned$/);
    }

    // Signed-in identity is always reachable, on any viewport. The address is
    // shown beside the button on desktop and carried in the button's
    // accessible name everywhere — so this assertion holds on a phone, where
    // the visible copy is deliberately hidden for space.
    await expect(
      nav.getByRole("button", { name: /sign out .*@test\.dev/i }),
    ).toBeVisible();
  });

  test("builds a protocol from a template and protects answered fields", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^protocol$/i }).click();

    await expect(page.getByRole("heading", { name: /^protocol$/i })).toBeVisible();

    await page.getByLabel(/protocol name/i).fill("Data extraction");
    await page.getByRole("radio", { name: /machine learning benchmarks/i }).check();
    await page.getByRole("button", { name: /create protocol/i }).click();

    // The template's fields arrive with it. Scoped to the field list: the
    // create form's own input still holds the typed name, and the template
    // preview lists the same labels, so an unscoped match proves nothing.
    const fields = page.getByRole("list", { name: /protocol questions/i });
    await expect(fields.getByText(/^Dataset/)).toBeVisible();
    await expect(fields.getByText(/^Headline metric/)).toBeVisible();
    await expect(page.getByText(/10 questions/)).toBeVisible();

    // A field demanding provenance says so, because that is the constraint an
    // extractor will hit later.
    await expect(page.getByText(/needs a quoted source/).first()).toBeVisible();

    // Adding a field derives a stable key from the label.
    await page.getByRole("button", { name: /add a question/i }).click();
    await page.getByLabel(/^label$/i).fill("Reported runtime (hours)");
    await page.getByLabel(/^type$/i).selectOption("NUMBER");
    await page.getByRole("button", { name: /^add question$/i }).click();

    await expect(page.getByText("Reported runtime (hours)")).toBeVisible();
    await expect(page.getByText("reported_runtime_hours")).toBeVisible();

    // Removing a field with no answers is a two-step inline confirm, not a
    // modal — and it works.
    await page
      .getByRole("button", { name: /remove reported runtime \(hours\)/i })
      .click();
    await page.getByRole("button", { name: /^confirm$/i }).click();
    await expect(page.getByText(/removed "reported runtime/i)).toBeVisible();
    await expect(page.getByText("reported_runtime_hours")).toHaveCount(0);
  });

  test("extracts against the protocol, quoting the paper for provenance", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^library$/i }).click();

    // Attention Is All You Need is the one with an abstract, so it is the one
    // a QUOTE field can actually be answered from.
    await page
      .getByRole("row", { name: /attention is all you need/i })
      .getByRole("link", { name: /^extract$/i })
      .click();

    await expect(
      page.getByRole("heading", { name: /attention is all you need/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /start extracting/i }).click();

    await expect(page.getByRole("heading", { name: /the questions/i })).toBeVisible();

    // A required text field.
    await page.getByLabel(/^task/i).fill("Sequence transduction");
    await page.getByLabel(/^dataset/i).fill("WMT 2014");
    await page.getByLabel(/^model/i).fill("Transformer");

    // The ENUM renders as a select with the protocol's own options.
    await page.getByLabel(/metric name/i).selectOption("BLEU");

    // Submitting without the quoted field must be refused BY NAME, so the
    // person knows which question is unanswered rather than that "something"
    // is missing.
    await page.getByRole("button", { name: /^submit$/i }).click();
    // getByText, not getByRole("alert"): Next renders a route announcer with
    // role="alert" too, so the role selector is ambiguous.
    await expect(page.getByText(/still unanswered:.*headline metric/i)).toBeVisible();

    // Answer it by quoting the paper — the field cannot be typed into.
    await page.getByRole("button", { name: /quote from the paper/i }).click();
    await expect(page.getByText(/select the sentence in the text/i)).toBeVisible();

    /*
     * Wait for the passage to actually be there before selecting inside it.
     *
     * `page.evaluate` does not retry, so this read raced the render: on a
     * loaded machine `firstChild` was still null, the function returned null,
     * and the test failed on `expect(quote).toBeTruthy()`. It failed on the
     * mobile project and merely went flaky on chromium in the same CI run,
     * which is the signature of a race rather than a broken assertion.
     *
     * The range below needs at least 70 characters of text node, so that is
     * what is waited for — not merely the element's presence.
     */
    const source = page.locator('[data-testid="extract-source"]');
    await expect(source).toBeVisible();
    await expect
      .poll(
        () =>
          source.evaluate((el) =>
            el.firstChild?.nodeType === Node.TEXT_NODE
              ? (el.firstChild.textContent?.length ?? 0)
              : 0,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(70);

    const quote = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="extract-source"]');
      if (!el?.firstChild) return null;
      const range = document.createRange();
      range.setStart(el.firstChild, 10);
      range.setEnd(el.firstChild, 70);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return range.toString();
    });
    expect(quote).toBeTruthy();
    await expect(page.getByRole("blockquote").first()).toContainText(quote!.slice(0, 20));

    await page.getByRole("button", { name: /^submit$/i }).click();
    await expect(page.getByText(/submitted\. it is frozen/i)).toBeVisible();

    // Frozen means frozen: the inputs are disabled until it is reopened.
    await page.reload();
    // By ROLE, not by text. Straight after a reload the server-streamed copy
    // of this banner is still in the document beside the hydrated one — same
    // markup, same words — so an unscoped getByText matches twice and fails
    // strict mode before it ever checks visibility. Only the live one is
    // exposed to the accessibility tree as a status, which is what makes the
    // role unambiguous where the text is not. Same trap as the scoped
    // getByText at the top of this file, and it bites hardest on CI, where
    // hydration finishes later than it does on a developer's machine.
    await expect(page.getByRole("status")).toContainText(/submitted and frozen/i);
    await expect(page.getByLabel(/^dataset/i)).toBeDisabled();

    // And reopening is a door, not a wall.
    await page.getByRole("button", { name: /reopen as a draft/i }).click();
    await expect(page.getByLabel(/^dataset/i)).toBeEnabled();

    /*
     * Submit it again, so this test hands the next one a submitted extraction.
     *
     * The evidence table stopped showing DRAFT rows in 20260816211000, which
     * is right — a table of half-typed answers is not something a supervisor
     * can be sent. This test used to end on the reopen, leaving the only
     * extraction in the project as a draft, so the very next test found an
     * empty evidence table and failed on a locator rather than on the rule
     * that had changed.
     *
     * Restoring the state is the honest fix. Making the next test tolerate an
     * empty table would delete the assertion it exists for.
     */
    await page.getByRole("button", { name: /^submit$/i }).click();
    await expect(page.getByRole("status")).toContainText(/frozen/i);
  });

  test("the evidence table shows the extraction, holes included", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^evidence$/i }).click();

    await expect(page.getByRole("heading", { name: /^evidence$/i })).toBeVisible();

    // The answers from the previous test, in a row of their own.
    const row = page
      .locator("[data-evidence-item]:visible")
      .filter({ hasText: /attention is all you need/i });
    await expect(row).toContainText("WMT 2014");
    await expect(row).toContainText("BLEU");

    // 4.5. The row must LOOK incomplete, and say how incomplete: the previous
    // test deliberately left fields unanswered.
    const done = await row.getByText(/^\d+\/\d+$/).textContent();
    const [answered, totalFields] = done!.split("/").map(Number);
    expect(answered).toBeLessThan(totalFields!);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    if (results.violations.length > 0) {
      console.error(results.violations.map((v) => `${v.id}: ${v.help}`).join("\n"));
    }
    expect(results.violations).toEqual([]);
  });

  test("sorting is a link, so a sorted table can be sent to a supervisor", async () => {
    // Sorting lives in the column headers, and there are no columns below
    // `md`: a twenty-column table on a phone is a horizontal scroll through a
    // keyhole, so that viewport gets a card per paper instead. The feature is
    // not missing there — the surface it belongs to is.
    test.skip(test.info().project.name === "mobile", "the table is wide-screen only");

    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^evidence$/i }).click();

    await page.getByRole("link", { name: /^year/i }).click();

    // The whole point of sorting server-side via the URL: the state is in the
    // address bar, so the link is shareable and survives a reload.
    await expect(page).toHaveURL(/sort=year/);
    await expect(page.getByRole("columnheader", { name: /^year/i })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    await page.getByRole("link", { name: /^year/i }).click();
    await expect(page).toHaveURL(/dir=desc/);
    await expect(page.getByRole("columnheader", { name: /^year/i })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  test("a quoted cell opens the paper at the passage it came from", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^evidence$/i }).click();

    // 4.3. The headline-metric answer was quoted from the abstract, so its
    // cell is a link rather than plain text.
    const row = page
      .locator("[data-evidence-item]:visible")
      .filter({ hasText: /attention is all you need/i });
    await row.getByRole("link", { name: /open the passage this came from/i }).click();

    await expect(page).toHaveURL(/\/read\/.*anchor=/);
    await expect(
      page.getByText(/showing the passage this evidence came from/i),
    ).toBeVisible();
  });

  test("the CSV export uses field keys as headers", async () => {
    await goto(page, "/projects");
    await page.getByRole("link", { name: /transformer efficiency/i }).click();
    await page.getByRole("link", { name: /^evidence$/i }).click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: /export csv/i }).click();
    const download = await downloadPromise;

    const path = await download.path();
    const csv = readFileSync(path, "utf8");
    const [header, ...rows] = csv.split("\r\n");

    // 4.4. The header is the field KEYS. `metric_name` is the key; the label
    // on screen is "Metric name". Asserting the underscored form is what
    // separates the two — an export headed with labels would break every
    // script that joins on a column, silently, whenever someone reworded one.
    expect(header).toContain("metric_name");
    expect(header).not.toContain("Metric name");
    expect(header!.startsWith("\uFEFFtitle,year,status,answered,fields,")).toBe(true);

    expect(rows.some((r) => r.includes("WMT 2014"))).toBe(true);
    expect(download.suggestedFilename()).toMatch(/^evidence-.*\.csv$/);
  });

  test("signs out and blocks the project list", async () => {
    await goto(page, "/projects");
    await page.getByRole("button", { name: /sign out/i }).click();

    /*
     * The landing page, not the sign-in form.
     *
     * `auth/sign-out/route.ts` redirects to `/`, which is now a public page
     * that says what the product is rather than a redirect to /dashboard. That
     * is the better place to land: somebody who has just signed out has not
     * asked to sign in again, and putting the form in front of them implies
     * they have.
     *
     * The assertion that matters is the one below, and it is unchanged.
     */
    await expect(page).toHaveURL(/\/$/);

    // Middleware gates it, RLS backs that up.
    await goto(page, "/projects");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
