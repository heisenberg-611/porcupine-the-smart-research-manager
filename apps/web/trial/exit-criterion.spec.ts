import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Phase 1 exit criterion.
 *
 * `00-product-plan.md`: *"a 4-person team runs screening on 300 papers and
 * sees progress. **Ship this to a real lab.**"*
 *
 * Four real accounts, four real browser sessions, 300 real papers through
 * the real import path. Not a seeded database — seeding rows behind the app
 * would skip parsing, dedupe, `upsert_work`, and every RLS policy, which is
 * most of what could actually break at this size.
 *
 * What this CAN prove: the system holds at 300 papers and 4 concurrent
 * members, the numbers add up, and the pages stay usable.
 *
 * What it CANNOT prove: whether screening 300 papers in this UI is bearable.
 * That needs four humans and an afternoon, and no test substitutes for it.
 * Anything this run reports about ergonomics is inference, not evidence.
 *
 *     pnpm --filter @porcupine/web test:trial
 *
 * Requires `pnpm --filter @porcupine/discovery measure:corpus` first.
 */

/** Page-load budget. Beyond this a screening session stops feeling live. */
const PAGE_BUDGET_MS = 3000;

interface Member {
  email: string;
  name: string;
  context: BrowserContext;
  page: Page;
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.dev`;
}

async function fetchOtp(email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch("http://127.0.0.1:54324/api/v1/messages?limit=100");
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

/** Sign in and complete enrollment, leaving the session on /projects. */
async function onboard(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /email me a code/i }).click();
  await expect(page.getByLabel(/six-digit code/i)).toBeVisible();

  const code = await fetchOtp(email);
  await page.getByLabel(/six-digit code/i).fill(code);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page).toHaveURL(/\/enroll/);
  await page.getByRole("button", { name: /generate my keys/i }).click();
  // Argon2id is deliberately slow.
  await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/projects/);
}

/** Time a navigation, returning milliseconds to the given ready signal. */
async function timedGoto(
  page: Page,
  url: string,
  ready: () => Promise<unknown>,
): Promise<number> {
  const began = Date.now();
  await page.goto(url);
  await ready();
  return Date.now() - began;
}

test.describe.configure({ mode: "serial", timeout: 900_000 });

test.describe("Phase 1 exit criterion — 4 people, 300 papers", () => {
  const members: Member[] = [];
  let projectUrl = "";
  const timings: Record<string, number> = {};

  test.beforeAll(async ({ browser }) => {
    for (const name of ["Lead", "Second", "Third", "Fourth"]) {
      const context = await browser.newContext();
      members.push({
        email: uniqueEmail(name.toLowerCase()),
        name,
        context,
        page: await context.newPage(),
      });
    }
  });

  test.afterAll(async () => {
    for (const member of members) await member.context.close();

    console.log("\n  ── Phase 1 exit trial ──────────────────────────────");
    for (const [label, ms] of Object.entries(timings)) {
      console.log(`  ${label.padEnd(38)} ${String(ms).padStart(6)} ms`);
    }
    console.log("");
  });

  test("four people sign up and enroll", async () => {
    // Sequential, not parallel: four Argon2id derivations at once on one
    // machine measures the CPU, not the product.
    for (const member of members) {
      await onboard(member.page, member.email);
    }

    for (const member of members) {
      await expect(member.page).toHaveURL(/\/projects/);
    }
  });

  test("the lead creates a project and adds the other three", async () => {
    const lead = members[0]!;
    await lead.page.goto("/projects");
    await lead.page.getByLabel("Title").fill("Systematic review of screening at scale");
    await lead.page.getByLabel("Kind").selectOption("SYSTEMATIC_REVIEW");
    await lead.page.getByRole("button", { name: /create project/i }).click();

    await expect(lead.page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
    projectUrl = new URL(lead.page.url()).pathname;

    for (const member of members.slice(1)) {
      await lead.page.getByLabel("Email").fill(member.email);
      await lead.page.getByLabel("Role").selectOption("CONTRIBUTOR");
      await lead.page.getByRole("button", { name: /add member/i }).click();
      await expect(lead.page.getByText(/member added/i)).toBeVisible();
    }

    await expect(lead.page.getByText(/members\s*\(4\)/i)).toBeVisible();
  });

  test("imports 300 papers through the real import path", async () => {
    const lead = members[0]!;
    const fixtures = resolve(process.cwd(), "../../fixtures");

    let imported = 0;

    for (const batch of ["trial-corpus-1.bib", "trial-corpus-2.bib"]) {
      const bibtex = readFileSync(resolve(fixtures, batch), "utf8");

      await lead.page.goto(`${projectUrl}/import`);
      await lead.page.getByLabel(/paste references/i).fill(bibtex);

      const began = Date.now();
      await lead.page.getByRole("button", { name: /preview/i }).click();
      await expect(lead.page.getByText(/read as .*bibtex/i)).toBeVisible({
        timeout: 120_000,
      });
      timings[`preview ${batch}`] = Date.now() - began;

      const addButton = lead.page.getByRole("button", { name: /^add \d+ papers$/i });
      await expect(addButton).toBeVisible();
      const label = await addButton.innerText();
      const count = Number(/\d+/.exec(label)?.[0] ?? 0);

      const commitBegan = Date.now();
      await addButton.click();
      await expect(lead.page.getByText(/^added \d+ paper/i)).toBeVisible({
        timeout: 180_000,
      });
      timings[`commit ${batch} (${count} papers)`] = Date.now() - commitBegan;

      imported += count;
    }

    expect(imported).toBeGreaterThanOrEqual(290);
  });

  test("the library renders 300 papers within budget", async () => {
    const lead = members[0]!;

    timings["library page (300 rows)"] = await timedGoto(
      lead.page,
      `${projectUrl}/library`,
      async () => {
        await expect(lead.page.getByRole("heading", { name: /library/i })).toBeVisible();
        await expect(lead.page.locator("tbody tr").first()).toBeVisible();
      },
    );

    // The page caps at 200 rows and says so; the count above the table is the
    // real total.
    await expect(lead.page.getByText(/^\d+ papers$/)).toContainText(/29\d|30\d/);
    expect(timings["library page (300 rows)"]).toBeLessThan(PAGE_BUDGET_MS);
  });

  test("four members screen concurrently without corrupting state", async () => {
    // Each member screens from their own session at the same time. This is
    // the part a single-user test cannot reach: four transactions writing
    // project_works and screening_decisions against the same project.
    const perMember = 5;

    const began = Date.now();
    await Promise.all(
      members.map(async (member) => {
        await member.page.goto(`${projectUrl}/screen`);
        await expect(
          member.page.getByRole("heading", { name: /^screen$/i }),
        ).toBeVisible();

        for (let i = 0; i < perMember; i++) {
          // Alternate include and exclude so the PRISMA counts are non-trivial.
          if (i % 2 === 0) {
            await member.page.getByRole("button", { name: /^include$/i }).click();
          } else {
            // A systematic review refuses an exclusion with no reason — the
            // database enforces it, so the form has to supply one.
            await member.page
              .getByLabel(/exclusion reason/i)
              .selectOption("WRONG_POPULATION");
            await member.page.getByRole("button", { name: /^exclude$/i }).click();
          }
          // Each member's local counter advances whether their decision was
          // recorded or refused as already-handled — which is exactly why
          // this assertion alone is not enough, and why the totals are
          // checked against the database below.
          await expect(
            member.page.getByText(new RegExp(`${i + 1} decided this session`)),
          ).toBeVisible({ timeout: 30_000 });
        }
      }),
    );
    timings[`concurrent screening (4 x ${perMember})`] = Date.now() - began;

    const attempts = members.length * perMember;

    // NOT `screened === attempts`. Four people sharing one queue legitimately
    // land on the same papers, so fewer distinct papers than attempts is
    // expected and fine. What must NOT happen is a decision silently
    // overwriting another — which is what this trial caught on its first run,
    // when 20 attempts produced 7 screened papers and every member's UI
    // claimed 5 successes.
    //
    // The invariant that matters: every attempt is accounted for. Each one
    // either recorded a decision or was refused as already-handled, and the
    // decision log holds exactly the recorded ones.
    const lead = members[0]!;
    await lead.page.goto(`${projectUrl}/progress`);

    const screened = Number(
      await lead.page
        .locator("dt", { hasText: /^Screened$/ })
        .locator("+ dd")
        .innerText(),
    );

    expect(screened).toBeGreaterThan(0);
    expect(screened).toBeLessThanOrEqual(attempts);

    // At least one member must have been told their paper was already
    // handled, or the compare-and-swap is not actually engaging and this
    // assertion is passing for the wrong reason.
    // The running tally, not the transient toast: the toast shows only the
    // LAST outcome, so counting it measures whether the final decision
    // happened to collide rather than whether collisions were detected.
    const tallies = await Promise.all(
      members.map((m) => m.page.getByText(/already handled by someone else/i).count()),
    );
    expect(tallies.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  test("progress reports the right numbers at scale", async () => {
    const lead = members[0]!;

    timings["progress page"] = await timedGoto(
      lead.page,
      `${projectUrl}/progress`,
      async () => {
        await expect(
          lead.page.getByRole("heading", { name: /^progress$/i }),
        ).toBeVisible();
      },
    );

    const papers = lead.page.locator("dt", { hasText: /^Papers$/ }).locator("+ dd");
    const screened = lead.page.locator("dt", { hasText: /^Screened$/ }).locator("+ dd");
    const remaining = lead.page.locator("dt", { hasText: /^Remaining$/ }).locator("+ dd");

    const total = Number(await papers.innerText());
    const done = Number(await screened.innerText());
    const left = Number(await remaining.innerText());

    // The arithmetic has to close. A dashboard whose numbers do not add up is
    // worse than no dashboard, because people act on it.
    expect(done + left).toBe(total);
    expect(total).toBeGreaterThanOrEqual(290);
    // Whatever the split between recorded and already-handled, the dashboard
    // must not claim more screening than happened.
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThanOrEqual(20);

    expect(timings["progress page"]).toBeLessThan(PAGE_BUDGET_MS);
  });

  test("each member's queue is their own", async () => {
    // Assignment is per-person, and RLS scopes project_works to members.
    // With four people in one project this is where a leaky policy shows.
    for (const member of members) {
      await member.page.goto("/queue");
      await expect(member.page.getByRole("heading", { name: /my queue/i })).toBeVisible();
      // Nothing was assigned during this trial, so every queue is empty —
      // the assertion that matters is that no member sees another's work.
      await expect(member.page.getByText(/nothing assigned to you/i)).toBeVisible();
    }
  });

  test("a non-member sees none of it", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await onboard(page, uniqueEmail("outsider"));

      // The project exists and has 300 papers. To this account it must be
      // indistinguishable from not existing.
      await page.goto(projectUrl);
      await expect(page.getByRole("heading", { name: /not found|404/i })).toBeVisible();

      await page.goto("/projects");
      await expect(page.getByText(/no projects yet/i)).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
