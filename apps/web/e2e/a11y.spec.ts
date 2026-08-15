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
 */
const ROUTES = ["/", "/about", "/sign-in"] as const;

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
  await page.getByRole("link", { name: /how it works/i }).click();
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

test("skip link is reachable by keyboard and moves focus to main", async ({ page }) => {
  await goto(page, "/");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: /skip to content/i });
  await expect(skipLink).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeVisible();
});
