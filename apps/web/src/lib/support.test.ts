import { describe, expect, it } from "vitest";

import { formatContext, issueUrl, routeShape, type ReportContext } from "./support";

/**
 * The privacy guard, pinned.
 *
 * These are not tests of formatting. A GitHub issue is public and permanent,
 * so the thing being asserted is that no identifier can reach one — and that
 * is exactly the kind of rule that decays silently when a route is added
 * later, because nothing about a new route announces that it leaks.
 */
describe("routeShape", () => {
  it("replaces a project id", () => {
    expect(routeShape("/projects/3f9a2b41-8c7d-4e1f-9a2b-5c6d7e8f9a0b/screen")).toBe(
      "/projects/[id]/screen",
    );
  });

  it("replaces every id in a nested route", () => {
    expect(
      routeShape(
        "/projects/3f9a2b41-8c7d-4e1f-9a2b-5c6d7e8f9a0b/read/8b21c4d5-6e7f-4a8b-9c0d-1e2f3a4b5c6d",
      ),
    ).toBe("/projects/[id]/read/[id]");
  });

  it("replaces long opaque segments that are not uuids", () => {
    // A route added later with a slug or a token in it must not leak just
    // because it does not match the uuid shape.
    expect(routeShape("/share/aVeryLongOpaqueTokenThatIdentifiesSomething")).toBe(
      "/share/[id]",
    );
  });

  it("leaves ordinary route words alone", () => {
    expect(routeShape("/dashboard")).toBe("/dashboard");
    expect(routeShape("/projects/new")).toBe("/projects/new");
    expect(routeShape("/studio")).toBe("/studio");
  });
});

describe("the issue link", () => {
  const context: ReportContext = {
    build: "a1b2c3d",
    screen: "/projects/[id]/screen",
    browser: "Mozilla/5.0 (Macintosh) Safari/605.1.15",
    viewport: "1440×900",
    theme: "dark",
  };

  it("carries the build, the screen and the browser", () => {
    const body = formatContext(context);
    expect(body).toContain("a1b2c3d");
    expect(body).toContain("/projects/[id]/screen");
    expect(body).toContain("Safari");
  });

  it("points at the right repository and template", () => {
    const url = issueUrl("bug", context);
    expect(url).toContain("github.com/heisenberg-611/");
    expect(url).toContain("template=bug_report.yml");
    expect(issueUrl("feature", context)).toContain("template=feature_request.yml");
  });

  it("cannot carry a uuid, whatever the caller passes", () => {
    // The belt to routeShape's braces: even a context assembled by hand has
    // to survive the assertion that no identifier reaches a public tracker.
    const url = issueUrl("bug", context);
    expect(url).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});
