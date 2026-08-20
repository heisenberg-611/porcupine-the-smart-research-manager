/**
 * Links out to the issue tracker, and the rule about what may go with them.
 *
 * A GitHub issue is public, permanent, and indexed. Everything this module
 * does is in service of one constraint: a bug report must never carry a
 * fragment of somebody's research. That rules out the obvious conveniences —
 * attaching the current URL, the project title, the paper being screened —
 * because each is a sentence about what a person is studying, published under
 * their name, for a button they pressed expecting to report a broken layout.
 *
 * So the context is an ALLOW-LIST, not a redaction pass. Redaction fails open:
 * a field added later is included until somebody remembers to strip it. This
 * fails closed — a new field is absent until it is named here.
 */

export const REPO = "heisenberg-611/porcupine-the-smart-research-manager";

/**
 * Where to send someone with no GitHub account.
 *
 * Configured, never hard-coded. Plenty of researchers do not have a GitHub
 * account and will not make one to report a bug, so losing those reports is a
 * real cost — but the address belongs to whoever runs the deployment, and
 * baking a personal one into a public repository publishes it to every
 * scraper that reads the source. Absent unless set, and the UI simply omits
 * the option.
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "";

/** The build, so a report can be tied to code rather than to "latest". */
export const BUILD = process.env.NEXT_PUBLIC_COMMIT_SHA?.slice(0, 7) ?? "dev";

export type IssueKind = "bug" | "feature";

const TEMPLATE: Record<IssueKind, string> = {
  bug: "bug_report.yml",
  feature: "feature_request.yml",
};

/**
 * The route, with its variables put back.
 *
 * `/projects/3f9a…/read/8b21…` becomes `/projects/[id]/read/[workId]`. The
 * shape is the useful half — it says which screen broke — and the ids are the
 * half that identifies a project and everyone in it.
 *
 * Anything that looks like a UUID or a long opaque token is replaced, not
 * matched against a list of known routes: a route added later would otherwise
 * leak by default, which is exactly the failure this module exists to avoid.
 */
export function routeShape(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)
      ) {
        return "[id]";
      }
      // Slugs, base64 fragments, and anything else long enough to be a key.
      if (segment.length > 24) return "[id]";
      return segment;
    })
    .join("/");
}

export interface ReportContext {
  build: string;
  screen: string;
  browser: string;
  viewport: string;
  theme: string;
}

/**
 * Everything the report is allowed to carry, and nothing else.
 *
 * Read from the browser at the moment the button is pressed rather than
 * passed in, so a caller cannot widen it by handing over more.
 */
export function collectContext(pathname: string): ReportContext {
  const root = typeof document === "undefined" ? null : document.documentElement;

  return {
    build: BUILD,
    screen: routeShape(pathname),
    // The raw user-agent string. Ugly, and the only thing that reliably
    // distinguishes "Safari 17" from "Safari 18" when a layout breaks in one.
    browser: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
    viewport:
      typeof window === "undefined"
        ? "unknown"
        : `${window.innerWidth}×${window.innerHeight}`,
    theme: root?.getAttribute("data-theme") ?? "system",
  };
}

/** The context as the plain block that goes in the issue's last field. */
export function formatContext(context: ReportContext): string {
  return [
    `Build:    ${context.build}`,
    `Screen:   ${context.screen}`,
    `Browser:  ${context.browser}`,
    `Viewport: ${context.viewport}`,
    `Theme:    ${context.theme}`,
  ].join("\n");
}

/**
 * The prefilled new-issue URL.
 *
 * GitHub issue FORMS take prefills by field id, which is why the templates are
 * YAML rather than markdown — a markdown template can only be prefilled by
 * replacing the whole body, which throws away the structure that makes reports
 * answerable.
 */
export function issueUrl(kind: IssueKind, context: ReportContext): string {
  const params = new URLSearchParams({
    template: TEMPLATE[kind],
    environment: formatContext(context),
  });

  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

/** The same report as an email, for people with no GitHub account. */
export function mailtoUrl(kind: IssueKind, context: ReportContext): string {
  if (!SUPPORT_EMAIL) return "";

  const subject =
    kind === "bug" ? "Porcupine: something is broken" : "Porcupine: a request";

  const params = new URLSearchParams({
    subject,
    body: `\n\n---\n${formatContext(context)}\n`,
  });

  return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
}
