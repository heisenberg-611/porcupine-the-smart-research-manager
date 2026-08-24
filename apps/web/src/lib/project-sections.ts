import {
  capabilities,
  type ProjectCapabilities,
  type ProjectKind,
} from "@Porcupine/shared";

/**
 * The map of what a project contains, in the order the work happens.
 *
 * Replaces hardcoded nav lists in three different files that were slowly
 * drifting apart. The source of truth for:
 *   - which screens a project kind gets (via shared capabilities)
 *   - the human-facing label for each
 *   - the grouped order in the sidebar
 *   - the active state in the narrow-screen project nav
 *
 * The DESTINATIONS still check capabilities themselves and must keep doing so
 * — a URL typed by hand is not a link, and R-06 is a security boundary rather
 * than a navigation convenience.
 */

export type SectionGroup =
  | "1. Questions"
  | "2. Collect"
  | "3. Screen"
  | "4. Protocol"
  | "5. Extract"
  | "6. Synthesis"
  | "Workspace";

export interface ProjectSection {
  /** Path segment under /projects/[id], or "" for the overview itself. */
  slug: string;
  label: string;
  group: SectionGroup;
  /** Shown on the hub. One line, says what the screen is for. */
  blurb: string;
}

/** The groups in the order work actually happens. */
export const SECTION_GROUPS: readonly SectionGroup[] = [
  "1. Questions",
  "2. Collect",
  "3. Screen",
  "4. Protocol",
  "5. Extract",
  "6. Synthesis",
  "Workspace",
];

const ALL_SECTIONS: ReadonlyArray<
  ProjectSection & { requires?: keyof ProjectCapabilities }
> = [
  {
    // First in the workflow, because it is first in the work: the keywords
    // here are what search ranks against, so a project that skips this ranks
    // nothing.
    slug: "questions",
    label: "Research questions",
    group: "1. Questions",
    blurb: "What the review asks. Search is ranked against these.",
  },
  {
    slug: "search",
    label: "Find papers",
    group: "2. Collect",
    blurb: "Search five sources at once. Duplicates are merged.",
  },
  {
    slug: "import",
    label: "Import",
    group: "2. Collect",
    blurb: "Paste BibTeX or RIS from a reference manager.",
  },
  {
    slug: "library",
    label: "Library",
    group: "2. Collect",
    blurb: "Everything in the project, filterable by status.",
  },
  {
    slug: "screen",
    label: "Screen",
    group: "3. Screen",
    blurb: "Decide what is in, one paper at a time.",
  },
  {
    slug: "progress",
    label: "Progress",
    group: "3. Screen",
    blurb: "How much is done, by whom, and how fast.",
  },
  {
    slug: "prisma",
    label: "PRISMA",
    group: "3. Screen",
    blurb: "The flow diagram, built from real decisions.",
  },
  {
    // Extraction Protocol: What everyone records about every paper.
    // In its true methodological position after screening and before extraction.
    slug: "protocol",
    label: "Protocol",
    group: "4. Protocol",
    blurb: "What everyone records about every paper, so papers can be compared.",
  },
  {
    slug: "extract",
    label: "Extract papers",
    group: "5. Extract",
    blurb: "Track and manage paper extractions by member.",
  },
  {
    slug: "reconcile",
    label: "Reconcile",
    group: "5. Extract",
    blurb: "Resolve where two extractors disagreed.",
    requires: "dualExtraction",
  },
  {
    slug: "evidence",
    label: "Evidence",
    group: "6. Synthesis",
    blurb: "Papers as rows, protocol fields as columns. Exports.",
  },
  {
    slug: "docs",
    label: "Collaboration Docs",
    group: "Workspace",
    blurb: "Shared Google Docs and Sheets for this project.",
  },
  {
    slug: "messages",
    label: "Messages",
    group: "Workspace",
    blurb: "Encrypted conversation. The server cannot read it.",
  },
  {
    slug: "keys",
    label: "Keys & members",
    group: "Workspace",
    blurb: "The project's content key, and who holds a copy.",
  },
];

/** The sections this project kind actually has, in workflow order. */
export function projectSections(
  kind: ProjectKind,
  overrides?: Partial<ProjectCapabilities>,
): ProjectSection[] {
  const caps = capabilities(kind, overrides);
  return ALL_SECTIONS.filter((s) => s.requires === undefined || caps[s.requires]).map(
    ({ requires: _requires, ...section }) => section,
  );
}

export function sectionHref(projectId: string, slug: string): string {
  return slug === "" ? `/projects/${projectId}` : `/projects/${projectId}/${slug}`;
}

/**
 * Which section a pathname is in, for the header's active state.
 *
 * Exact match for the overview, prefix match for everything else —
 * `/projects/123/library/456` is inside the library.
 */
export function activeSection(pathname: string, projectId: string): string | null {
  const base = `/projects/${projectId}`;
  if (pathname === base || pathname === `${base}/`) return "";
  if (!pathname.startsWith(`${base}/`)) return null;

  const rest = pathname.slice(base.length + 1);
  const first = rest.split("/")[0];
  return first ?? null;
}
