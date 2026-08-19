import type { Page, Response } from "@playwright/test";

/**
 * Navigate, and wait for the page to stop being two pages.
 *
 * React streams a route's content into a `<div hidden id="S:0">` parked at the
 * end of `<body>`, and an inline script moves it into place. Until that
 * happens the document genuinely contains TWO copies of the content: the
 * hidden one and, once relocated, the real one. It is not a rendering bug and
 * users never see it — the copy is `hidden`, so it is not painted and not in
 * the accessibility tree.
 *
 * Tests do see it. `getByText` matches hidden nodes, so an assertion that
 * lands inside that window fails with "resolved to 2 elements" — which reads
 * like a duplicated-component bug and is not one. The window is normally sub-
 * millisecond; it widens when the main thread is busy, which is why it showed
 * up only under parallel workers and why it turned up on a different spec each
 * run. Chasing it locator by locator was chasing the wrong thing.
 *
 * So: navigate, then wait for the slot to be reclaimed. Bounded and forgiving
 * — a boundary that never resolves must fail as the real assertion timing out
 * with a useful message, not as an opaque hang in a helper.
 */
/**
 * Pages that have already had the cookie notice seeded.
 *
 * A `WeakSet` so a closed page is collectable, and keyed by page rather than
 * by context because `addInitScript` is a page-level API.
 */
const noticeSeeded = new WeakSet<Page>();

/**
 * Dismiss the cookie notice before the first navigation.
 *
 * The notice is fixed to the bottom of the viewport until somebody dismisses
 * it, and every Playwright context starts with empty storage — so without this
 * it appears in all 187 tests and covers whatever is at the bottom of the page.
 * On a 412px phone that is a lot of page, and the failure it produces is a
 * click landing on the notice instead of the button under it, reported as a
 * timeout that names neither.
 *
 * Seeded rather than clicked: a returning visitor has already dismissed it, and
 * that is the state nearly every test is actually about. The notice itself is
 * exercised deliberately in a11y.spec.ts, with a context that has not been
 * seeded — otherwise this helper would quietly delete the only coverage of a
 * component every first-time visitor sees.
 */
async function seedCookieNotice(page: Page): Promise<void> {
  if (noticeSeeded.has(page)) return;
  noticeSeeded.add(page);

  await page.addInitScript(() => {
    try {
      localStorage.setItem("Porcupine.cookie-notice", "seen");
    } catch {
      // Storage blocked. The notice then shows, and a test that cares will say
      // so rather than this helper failing the run.
    }
  });
}

export async function goto(
  page: Page,
  url: string,
  options?: Parameters<Page["goto"]>[1],
): Promise<Response | null> {
  await seedCookieNotice(page);
  const response = await page.goto(url, options);
  await settled(page);
  return response;
}

/** The same wait, for navigations caused by a click or a reload. */
export async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), null, {
      timeout: 5_000,
    })
    .catch(() => {
      // Deliberately swallowed. See above: the test's own expectation is the
      // better place for this to fail.
    });
}
