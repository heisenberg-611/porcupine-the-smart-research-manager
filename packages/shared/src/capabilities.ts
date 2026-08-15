/**
 * R-06 — `Project.kind` branches the UI, it does not merely label the project.
 *
 * A humanities PhD student reading 40 books wants none of the systematic-review
 * machinery; a review team wants all of it and pays for the guardrails. Same
 * schema, two products. Every screen reads this function rather than testing
 * `kind` inline — otherwise the branching drifts and the THESIS path slowly
 * grows review-shaped UI, which is exactly the failure C-06 describes.
 *
 * The THESIS path ships first. The review path is a strict superset of it.
 *
 * See docs/05-resolution-plan.md R-06.
 *
 * There was a `structureUpgradePath` flag here, "offer the add-structure
 * upgrade path toward a review-shaped project". It was declared, given a value
 * for every kind, and read by NOTHING — no screen, no action, no test. Its
 * only effect was through a person: the new-project form told people "You can
 * add structure later", which was never true, about the one decision in this
 * product that cannot be undone. Nothing updates `kind`; nothing offers to.
 *
 * Removed rather than implemented. A capability that lies about what the app
 * does is worse than an absent one, and the upgrade path can be added back
 * with the feature that earns it.
 */

export const PROJECT_KINDS = [
  "THESIS",
  "SYSTEMATIC_REVIEW",
  "LAB_PAPER",
  "GENERAL",
] as const;

export type ProjectKind = (typeof PROJECT_KINDS)[number];

export interface ProjectCapabilities {
  /** An extraction Protocol must exist before papers can be extracted. */
  protocolRequired: boolean;
  /** Two independent extractors + reconciliation. Phase 2b, review-only. */
  dualExtraction: boolean;
  /** Cohen's κ reported on reconciled extractions. */
  interRaterAgreement: boolean;
  /** PRISMA 2020 flow diagram derived from screening decisions. */
  prismaDiagram: boolean;
  /** Screening requires an explicit exclusion reason. */
  exclusionReasonRequired: boolean;
  /**
   * GitHub linking is offered at all. Off for THESIS by default (R-17): a
   * biology student landing in an org-permissions screen will grant access to
   * every repository because it looks like the default option.
   *
   * DECLARED AND UNREAD, as of 2026-08-15. No screen consults this, because
   * GitHub linking is not built. It is left here rather than removed because,
   * unlike the `structureUpgradePath` flag that used to sit below it, nothing
   * tells a user anything on its strength — it is inert rather than untrue.
   *
   * Kept honest deliberately: the moment a screen reads this flag, delete this
   * paragraph. The moment someone writes UI copy that ASSUMES it, the flag has
   * become a promise and should be treated like the last one.
   */
  githubLinking: boolean;
}

const THESIS_DEFAULTS: ProjectCapabilities = {
  protocolRequired: false,
  dualExtraction: false,
  interRaterAgreement: false,
  prismaDiagram: false,
  exclusionReasonRequired: false,
  githubLinking: false,
};

const REVIEW_DEFAULTS: ProjectCapabilities = {
  protocolRequired: true,
  dualExtraction: true,
  interRaterAgreement: true,
  prismaDiagram: true,
  exclusionReasonRequired: true,
  githubLinking: true,
};

const BY_KIND: Record<ProjectKind, ProjectCapabilities> = {
  THESIS: THESIS_DEFAULTS,
  SYSTEMATIC_REVIEW: REVIEW_DEFAULTS,
  // A lab paper is collaborative and often has engineers on it, so GitHub is
  // on — but it is not a systematic review and must not demand a protocol.
  LAB_PAPER: {
    ...THESIS_DEFAULTS,
    githubLinking: true,
  },
  GENERAL: THESIS_DEFAULTS,
};

/**
 * Capabilities for a project kind. Callers may override individual flags
 * where a project has explicitly opted in — pass the stored overrides.
 */
export function capabilities(
  kind: ProjectKind,
  overrides?: Partial<ProjectCapabilities>,
): ProjectCapabilities {
  return { ...BY_KIND[kind], ...overrides };
}

export function isProjectKind(value: unknown): value is ProjectKind {
  return (
    typeof value === "string" && (PROJECT_KINDS as readonly string[]).includes(value)
  );
}
