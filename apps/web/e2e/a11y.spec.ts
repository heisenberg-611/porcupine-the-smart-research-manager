import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
const ROUTES = ["/", "/sign-in"] as const;

for (const route of ROUTES) {
  test(`${route} has no WCAG 2.2 AA violations`, async ({ page }) => {
    await page.goto(route);

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

test("skip link is reachable by keyboard and moves focus to main", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: /skip to content/i });
  await expect(skipLink).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeVisible();
});
