import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 2's last open exit criterion.
 *
 * The evidence table's 3 s budget was signed off on a DATABASE measurement:
 * 51–56 ms per query shape for 300 papers × 20 fields. That number was real
 * and it was also the easy half. It says nothing about the server component
 * that awaits the RPC, the React tree built from 5,000-odd cells, the payload
 * crossing the wire, or the browser laying out a 20-column table — and every
 * one of those is between the query and the person waiting.
 *
 * So this measures the whole thing, from navigation to the table being on
 * screen, and reports the gap between that and the query it wraps.
 *
 * NOT A TEST. It runs under `playwright.measure.config.ts`, which the merge
 * gate does not use, and it asserts almost nothing on purpose: a timing
 * assertion on a developer laptop is a flaky test that teaches people to
 * ignore the suite. It prints numbers for a human to read.
 *
 *     pnpm db:seed --all-extracted
 *     pnpm --filter @Porcupine/web measure
 */

const MAILPIT = "http://127.0.0.1:54324";
const SEED_EMAIL = process.env.SEED_EMAIL ?? "demo@test.dev";
const RUNS = Number(process.env.MEASURE_RUNS ?? 7);

interface Timing {
  /** responseStart − requestStart: the server had the whole page to build. */
  ttfb: number;
  /** Everything parsed. */
  domContentLoaded: number;
  /** Largest contentful paint — the closest thing to "I can see the table". */
  lcp: number | null;
  /** Bytes of HTML. A 300-row × 20-column table is not a small document. */
  bytes: number;
}

async function fetchOtp(email: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
    if (res.ok) {
      const body = (await res.json()) as {
        messages?: Array<{ ID: string; To?: Array<{ Address: string }> }>;
      };
      const match = body.messages?.find((m) =>
        m.To?.some((t) => t.Address.toLowerCase() === email.toLowerCase()),
      );
      if (match) {
        const detail = await fetch(`${MAILPIT}/api/v1/message/${match.ID}`);
        const text = ((await detail.json()) as { Text?: string }).Text ?? "";
        const code = /\b(\d{6})\b/.exec(text)?.[1];
        if (code) return code;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No sign-in code arrived for ${email}. Has \`pnpm db:seed\` been run?`);
}

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(SEED_EMAIL);
  await page.getByRole("button", { name: /email me a code/i }).click();
  await page.getByLabel(/six-digit code/i).fill(await fetchOtp(SEED_EMAIL));
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(enroll|projects)/);

  if (page.url().includes("/enroll")) {
    await page.getByRole("button", { name: /generate my keys/i }).click();
    await expect(page.locator("p.font-mono")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL(/\/projects/);
  }
}

/**
 * One navigation, timed from the browser's own clock rather than ours.
 *
 * `page.goto` returns when the load event fires, so wrapping it in Date.now()
 * measures Playwright's round trip as much as the page. The Navigation Timing
 * entry is what the browser actually recorded.
 */
async function timeNavigation(page: Page, url: string): Promise<Timing> {
  // LCP has to be observed BEFORE the navigation it belongs to, so the
  // observer is installed as an init script and the entry is read afterwards.
  await page.addInitScript(() => {
    (window as unknown as { __lcp: number }).__lcp = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        (window as unknown as { __lcp: number }).__lcp = entry.startTime;
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });

  const response = await page.goto(url, { waitUntil: "load" });
  const bytes = (await response!.body()).byteLength;

  // Give LCP a moment to settle: the entry can arrive after the load event.
  await page.waitForTimeout(250);

  return await page.evaluate((size) => {
    const nav = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    const lcp = (window as unknown as { __lcp: number }).__lcp;
    return {
      ttfb: nav.responseStart - nav.requestStart,
      domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
      lcp: lcp > 0 ? lcp : null,
      bytes: size,
    };
  }, bytes);
}

function summarise(label: string, runs: Timing[]) {
  const stat = (pick: (t: Timing) => number | null) => {
    const xs = runs
      .map(pick)
      .filter((x): x is number => x !== null)
      .sort((a, b) => a - b);
    if (xs.length === 0) return "—";
    const median = xs[Math.floor(xs.length / 2)]!;
    // Not "p95" with seven samples. The worst of seven is the honest name for
    // the worst of seven, and calling it a percentile would imply a
    // distribution this has not sampled.
    const worst = xs[xs.length - 1]!;
    return `${median.toFixed(0)} ms (worst ${worst.toFixed(0)})`;
  };

  const kb = (runs[0]!.bytes / 1024).toFixed(0);
  console.log(
    `  ${label.padEnd(26)} ttfb ${stat((t) => t.ttfb).padEnd(24)} ` +
    `dcl ${stat((t) => t.domContentLoaded).padEnd(24)} ` +
    `lcp ${stat((t) => t.lcp).padEnd(24)} html ${kb} KB`,
  );
}

test("evidence table, 300 papers × 20 fields", async ({ page }) => {
  test.setTimeout(10 * 60_000);

  await signIn(page);

  // Find the seeded review by its title rather than a hard-coded id: the seed
  // makes fresh uuids every run.
  await page.goto("/projects");
  const link = page.getByRole("link", {
    name: /sleep restriction and cognitive performance/i,
  });
  await expect(
    link,
    "the seeded review is missing — run `pnpm db:seed --all-extracted` first",
  ).toBeVisible();
  await link.click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
  const projectId = page.url().split("/").pop()!;

  const evidence = `/projects/${projectId}/evidence`;

  // The four shapes the database measurement used, so the two numbers are
  // comparable rather than merely both existing.
  const shapes: Array<[string, string]> = [
    ["page 1, default sort", evidence],
    ["sorted by a number", `${evidence}?sort=sample_size`],
    ["filtered", `${evidence}?fk=design&q=RCT`],
    ["grouped", `${evidence}?group=risk_of_bias`],
    ["last page", `${evidence}?page=6`],
  ];

  // One untimed pass first. The very first render of a route compiles and
  // warms caches, and including it would report a number no user ever waits
  // for after the first minute of the server's life.
  for (const [, url] of shapes) await page.goto(url);

  console.log(
    `\n  Evidence table — ${RUNS} runs each, production build, local Supabase\n`,
  );

  const results: Array<[string, Timing[]]> = [];
  for (const [label, url] of shapes) {
    const runs: Timing[] = [];
    for (let i = 0; i < RUNS; i++) runs.push(await timeNavigation(page, url));
    summarise(label, runs);
    results.push([label, runs]);
  }

  // Row count, so the numbers above are anchored to what was actually on the
  // page rather than to what the seed was asked for.
  const rows = await page.locator("tbody tr").count();
  const cols = await page.locator("thead th").count();
  console.log(`\n  Rendered ${rows} rows × ${cols} columns per page.\n`);

  // The only assertion, and it is about the FIXTURE rather than performance:
  // a measurement of an empty table would print fast, reassuring, meaningless
  // numbers. Timings themselves are not asserted — see the header.
  expect(rows, "no rows rendered; the measurement would be meaningless").toBeGreaterThan(
    10,
  );
});
