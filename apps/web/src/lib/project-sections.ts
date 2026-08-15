import {
  capabilities,
  type ProjectCapabilities,
  type ProjectKind,
} from "@porcupine/shared";

/**
 * Which screens a project has, in workflow order — the single source of truth.
 *
 * Two things used to decide this independently and neither was right.
 *
 * The project page listed nine destinations in a flat row, in an order that
 * was neither the workflow's nor alphabetical, and offered every one of them
 * regardless of project kind. So a THESIS showed links to Reconcile and
 * PRISMA, and clicking either cost a page load to be told the feature is for
 * systematic reviews. `capabilities()` was being enforced at the destination
 * instead of at the door: the gate worked, and the user still paid for it.
 *
 * Meanwhile the app header offered no project links at all, so every lateral
 * move between those nine screens went back through the hub.
 *
 * Both now read this. A section that is not in this list for a given kind
 * cannot be linked to from anywhere, which is a stronger guarantee than
 * remembering to check.
 *
 * The DESTINATIONS still check capabilities themselves and must keep doing so
 * — a URL typed by hand is not a link, and R-06 is a security boundary rather
 * than a navigation convenience.
 */

export type SectionGroup = "Collect" | "Screen" | "Extract" | "Synthesise";

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
  "Collect",
  "Screen",
  "Extract",
  "Synthesise",
];

const ALL_SECTIONS: ReadonlyArray<
  ProjectSection & { requires?: keyof ProjectCapabilities }
> = [
  {
    // First in the workflow, because it is first in the work: the keywords
    // here are what search ranks against, so a project that skips this ranks
    // nothing. It used to have no screen at all — see the actions file.
    slug: "questions",
    label: "Research questions",
    group: "Collect",
    blurb: "What the review asks. Search is ranked against these.",
  },
  {
    slug: "search",
    label: "Find papers",
    group: "Collect",
    blurb: "Search five sources at once. Duplicates are merged.",
  },
  {
    slug: "import",
    label: "Import",
    group: "Collect",
    blurb: "Paste BibTeX or RIS from a reference manager.",
  },
  {
    slug: "library",
    label: "Library",
    group: "Collect",
    blurb: "Everything in the project, filterable by status.",
  },
  {
    slug: "screen",
    label: "Screen",
    group: "Screen",
    blurb: "Decide what is in, one paper at a time.",
  },
  {
    slug: "progress",
    label: "Progress",
    group: "Screen",
    blurb: "How much is done, by whom, and how fast.",
  },
  {
    slug: "prisma",
    label: "PRISMA",
    group: "Screen",
    blurb: "The flow diagram, built from real decisions.",
    // NOT gated, despite `capabilities().prismaDiagram` existing and being
    // false for a thesis. The page renders the diagram for every project kind;
    // the flag only controls a note saying exclusion reasons were optional
    // here, so the boxes may be sparse. Hiding the section on the strength of
    // the flag's NAME removed a working feature from three project kinds —
    // caught by an existing e2e test that clicks through to PRISMA in a
    // THESIS. Read what the destination does, not what the capability is
    // called.
  },
  {
    // "Protocol" is the methodology term, and it hid the feature from the
    // person who asked for it: what this screen defines is the set of things
    // everyone records about every paper. The route, the table and the docs
    // keep the word; the label says what it does.
    //
    // In Collect, not Extract. It must exist before any extraction happens,
    // and it should shape what you collect — meeting it after screening is
    // meeting it too late to change anything.
    slug: "protocol",
    label: "Extraction form",
    group: "Collect",
    blurb: "What everyone records about every paper, so papers can be compared.",
  },
  {
    slug: "reconcile",
    label: "Reconcile",
    group: "Extract",
    blurb: "Resolve where two extractors disagreed.",
    requires: "dualExtraction",
  },
  {
    slug: "evidence",
    label: "Evidence",
    group: "Synthesise",
    blurb: "Papers as rows, protocol fields as columns. Exports.",
  },
  {
    slug: "messages",
    label: "Messages",
    group: "Synthesise",
    blurb: "Encrypted conversation. The server cannot read it.",
  },
  {
    // Named after the job, not the mechanism. It was "Encryption", which is
    // what the page uses rather than what it is for — and it stopped being a
    // stop on the way to a conversation when messages absorbed setup, so what
    // is left here is the administrative work: rotation, removal, devices,
    // safety numbers.
    slug: "keys",
    label: "Keys & members",
    group: "Synthesise",
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
 * Matches the FIRST segment after the project id, so /read/[workId] and
 * /extract/[workId] — screens reached from the library rather than from the
 * nav — resolve to no section rather than to a wrong one. Highlighting
 * "Library" while someone is in the reader would be a lie about where they
 * are, which is the failure this whole module exists to fix.
 */
export function activeSection(pathname: string, projectId: string): string | null {
  const prefix = `/projects/${projectId}`;
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/^\//, "");
  if (rest === "") return "";
  return rest.split("/")[0] ?? null;
}
