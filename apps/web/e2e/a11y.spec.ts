import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { goto } from "./ready";

/**
 * G-07 — accessibility runs in CI from Phase 0.
 *
 * Public universities in the EU, US, and India have procurement rules that
 * disqualify an inaccessible tool outright, so this is a launch requirement
 * rather than polish. It is also far cheaper to hold the line from an empty
 * repo than to retrofit at Phase 7, which is the classic way to miss it.
 *
 * Every route added to the app should be added here.
 *
 * The thirteen public pages are all here now, and they were not: the list was
 * three entries while the footer linked to twelve pages, so the ones a
 * signed-out visitor is most likely to read — pricing, security, the policies
 * — had never been checked at all. They are cheap to check, being static, and
 * they are the pages that decide whether a procurement office gets past the
 * front door.
 */
const ROUTES = [
  "/",
  "/about",
  "/features",
  "/pricing",
  "/security",
  "/guides",
  "/api",
  "/changelog",
  "/blog",
  "/privacy",
  "/terms",
  "/dpa",
  "/cookies",
  "/sign-in",
] as const;

for (const route of ROUTES) {
  test(`${route} has no WCAG 2.2 AA violations`, async ({ page }) => {
    await goto(page, route);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    // Print the actual rule and selector — a bare count is useless in CI logs.
    if (results.violations.length > 0) {
      console.error(
        results.violations
          .map(
            (v) =>
              `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes
                .map((n) => n.target.join(" "))
                .join("\n  ")}`,
          )
          .join("\n\n"),
      );
    }

    expect(results.violations).toEqual([]);
  });
}

test("the landing page explains the product, not a third of it", async ({ page }) => {
  // It used to cover Find, Screen and Read — three of the six things this
  // does — and never said who it was for or what any of the vocabulary meant.
  // A visitor's only route to an explanation was to make an account.
  await goto(page, "/");

  const main = page.getByRole("main");
  for (const step of ["Ask", "Find", "Screen", "Read", "Extract", "Report"]) {
    await expect(main.getByRole("heading", { name: step, exact: true })).toBeVisible();
  }

  // The words the rest of the app then uses without introduction.
  await expect(main.getByText(/systematic review/i).first()).toBeVisible();
  await expect(main.getByText(/PRISMA/).first()).toBeVisible();

  // And somewhere to go for the longer version, without signing up.
  //
  // Scoped to main. The site footer now appears on every public page and
  // carries its own "How it works" link — same name, same destination, which
  // is correct for a site index and makes an unscoped locator match twice.
  // The assertion is about the landing page offering the route, so the
  // landing page's own content is what it should be looking at.
  await main.getByRole("link", { name: /how it works/i }).click();
  await expect(page).toHaveURL(/\/about/);
  await expect(
    page.getByRole("heading", { name: /what this does not do/i }),
  ).toBeVisible();
});

test("the landing page offers a way in", async ({ page }) => {
  // It did not, for the whole of Phase 1: the placeholder described the
  // product and then offered no link to sign in. A visitor could read about
  // it and had nowhere to go.
  await goto(page, "/");
  await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  await page.getByRole("link", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

/**
 * The cookie notice, on a context that has NOT been seeded.
 *
 * `goto()` dismisses it before every other test in this suite, which is right —
 * a returning visitor has already seen it — and would otherwise leave the one
 * component every first-time visitor meets with no coverage at all. So this
 * navigates with `page.goto` directly.
 */
test("the cookie notice appears once, says what happens if you refuse, and goes away", async ({
  page,
}) => {
  await page.goto("/");

  const notice = page.getByRole("region", { name: /about cookies/i });
  await expect(notice).toBeVisible();

  // The part the notice exists for. Not "we value your privacy".
  await expect(notice).toContainText(/no analytics, no advertising/i);
  await expect(notice).toContainText(/signing in will not/i);

  // No Reject button, deliberately — see components/cookie-notice.tsx. A
  // regression that adds one that does nothing is the pattern this avoids.
  await expect(notice.getByRole("button")).toHaveCount(1);

  // It must not fail the same accessibility bar as the pages it sits on.
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  if (results.violations.length > 0) {
    console.error(results.violations.map((v) => `${v.id}: ${v.help}`).join("\n"));
  }
  expect(results.violations).toEqual([]);

  await notice.getByRole("button", { name: /got it/i }).click();
  await expect(notice).toBeHidden();

  // And it stays gone, which is the whole point of dismissing it.
  await page.goto("/pricing");
  await expect(page.getByRole("region", { name: /about cookies/i })).toBeHidden();
});

test("skip link is reachable by keyboard and moves focus to main", async ({ page }) => {
  await goto(page, "/");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: /skip to content/i });
  await expect(skipLink).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeVisible();
});
