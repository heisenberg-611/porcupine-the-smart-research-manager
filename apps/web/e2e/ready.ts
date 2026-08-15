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
export async function goto(
  page: Page,
  url: string,
  options?: Parameters<Page["goto"]>[1],
): Promise<Response | null> {
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
