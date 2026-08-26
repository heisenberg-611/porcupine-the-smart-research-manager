/**
 * The screening pipeline and its controlled vocabulary.
 *
 * Exclusion reasons are a fixed list rather than free text because PRISMA
 * 2020 requires exclusions to be REPORTED BY CATEGORY with counts. Free text
 * means the Phase 2 flow diagram cannot be auto-derived, and hand-drawing it
 * in PowerPoint is precisely the pain this product exists to remove.
 *
 * The categories below are the ones that appear in published PRISMA diagrams
 * across disciplines. `OTHER` exists because no fixed list survives contact
 * with a real review — but it carries a free-text note, so the count stays
 * reportable and the detail is not lost.
 */

export const SCREEN_STATUSES = [
  "IDENTIFIED",
  "SCREENING",
  "INCLUDED",
  "EXCLUDED",
  "READING",
  "EXTRACTED",
  "SYNTHESIZED",
] as const;

export type ScreenStatus = (typeof SCREEN_STATUSES)[number];

/**
 * Which transitions are allowed.
 *
 * Not a bureaucratic restriction — the PRISMA diagram is derived from these
 * transitions, so a paper that jumps from IDENTIFIED straight to EXTRACTED
 * produces a flow diagram whose numbers do not add up, and a reviewer cannot
 * then defend the count in a methods section.
 *
 * Backwards moves are permitted throughout: screening decisions get revised,
 * and a tool that makes a person delete and re-add a paper to correct a
 * misclick is a tool they will work around.
 */
export const ALLOWED_TRANSITIONS: Record<ScreenStatus, readonly ScreenStatus[]> = {
  IDENTIFIED: ["SCREENING", "INCLUDED", "EXCLUDED"],
  SCREENING: ["INCLUDED", "EXCLUDED", "IDENTIFIED"],
  INCLUDED: ["READING", "EXCLUDED", "SCREENING"],
  EXCLUDED: ["SCREENING", "IDENTIFIED", "INCLUDED"],
  READING: ["EXTRACTED", "INCLUDED", "EXCLUDED"],
  EXTRACTED: ["SYNTHESIZED", "READING", "EXCLUDED"],
  SYNTHESIZED: ["EXTRACTED", "EXCLUDED"],
};

export function canTransition(from: ScreenStatus, to: ScreenStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const EXCLUSION_REASONS = [
  { code: "WRONG_POPULATION", label: "Wrong population" },
  { code: "WRONG_INTERVENTION", label: "Wrong intervention or exposure" },
  { code: "WRONG_COMPARATOR", label: "Wrong comparator" },
  { code: "WRONG_OUTCOME", label: "Wrong outcome" },
  { code: "WRONG_STUDY_DESIGN", label: "Wrong study design" },
  { code: "WRONG_SETTING", label: "Wrong setting" },
  { code: "NOT_PEER_REVIEWED", label: "Not peer reviewed" },
  { code: "LANGUAGE", label: "Language not covered by the protocol" },
  { code: "DUPLICATE", label: "Duplicate record" },
  { code: "FULL_TEXT_UNAVAILABLE", label: "Full text unavailable" },
  { code: "SUPERSEDED", label: "Superseded by a later version" },
  { code: "OTHER", label: "Other (explain in the note)" },
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number]["code"];

export const EXCLUSION_REASON_CODES = EXCLUSION_REASONS.map((r) => r.code);

export function exclusionReasonLabel(code: string): string {
  return EXCLUSION_REASONS.find((r) => r.code === code)?.label ?? code;
}

/**
 * The statuses that count as "still to do" for one person.
 *
 * READING is included: a paper assigned and half-read is not finished, and a
 * queue that empties before the work does is a queue people stop trusting.
 */
export const OPEN_QUEUE_STATUSES: readonly ScreenStatus[] = [
  "IDENTIFIED",
  "SCREENING",
  "INCLUDED",
  "READING",
];

/** Human-readable status label. */
export function screenStatusLabel(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}
