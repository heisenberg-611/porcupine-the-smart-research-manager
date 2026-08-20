/**
 * A stable colour per person, so overlapping highlights stay legible.
 *
 * Two people marking the same sentence is the normal case in a review — it is
 * often the interesting case — and in one colour it reads as a single darker
 * smear. Keyed by author, the overlap shows both.
 *
 * Derived from the author's id rather than stored or assigned in sequence:
 *
 *   • it is the same colour on every page, in every project, for everyone
 *     looking — an assignment made per-project or per-session would give the
 *     same person two colours in two tabs;
 *   • nothing has to be migrated, and a member who joins later does not
 *     renumber anybody;
 *   • it works for a member whose annotations you can see but whose row you
 *     have not loaded.
 *
 * The cost is that two people can collide on a hue. With eight of them that is
 * likely in a project of eight, which is why the name is drawn beside the mark
 * rather than left to the colour to convey. Colour separates; the label
 * identifies.
 */

/**
 * Fixed hues, not theme tokens.
 *
 * These are drawn over a rendered PDF page, which is white in both themes
 * because it is a photograph of paper. A token that flips with the theme would
 * be chosen for a background this never sits on.
 *
 * Ordered so that neighbours are far apart in hue: an accidental adjacency in
 * the palette is what makes two members hard to tell apart.
 *
 * Three values, because they sit on three different grounds:
 *
 *   `fill`  multiplied over the white page — a highlighter over paper;
 *   `ink`   dark text, readable ON that fill, so only ever used over the page;
 *   `solid` the mid-tone hue, for anything on the APPLICATION's background.
 *
 * The third exists because the margin labels are not on the page. `ink` on a
 * translucent fill works over white and disappears in dark mode, where the
 * fill resolves against a dark ground and dark-on-dark is what a reader gets.
 * Labels therefore take their background from the theme and use `solid` only
 * as an accent, which reads on both.
 *
 * Written the way a browser serialises them — `0.3`, not `0.30` — because
 * these strings are compared against `element.style.background` in a test, and
 * a trailing zero is a mismatch that only appears when somebody happens to
 * hash to that hue.
 */
export const ANNOTATION_COLOURS = [
  { name: "amber", fill: "rgba(245, 158, 11, 0.3)", ink: "#92400e", solid: "#f59e0b" },
  { name: "sky", fill: "rgba(14, 165, 233, 0.28)", ink: "#075985", solid: "#0ea5e9" },
  { name: "rose", fill: "rgba(244, 63, 94, 0.26)", ink: "#9f1239", solid: "#f43f5e" },
  { name: "emerald", fill: "rgba(16, 185, 129, 0.28)", ink: "#065f46", solid: "#10b981" },
  { name: "violet", fill: "rgba(139, 92, 246, 0.28)", ink: "#5b21b6", solid: "#8b5cf6" },
  { name: "orange", fill: "rgba(249, 115, 22, 0.28)", ink: "#9a3412", solid: "#f97316" },
  { name: "teal", fill: "rgba(20, 184, 166, 0.28)", ink: "#115e59", solid: "#14b8a6" },
  { name: "fuchsia", fill: "rgba(217, 70, 239, 0.24)", ink: "#86198f", solid: "#d946ef" },
] as const;

export type AnnotationColour = (typeof ANNOTATION_COLOURS)[number];

/**
 * The colour for one person.
 *
 * FNV-1a rather than summing char codes: a sum gives anagrams the same colour
 * and, worse, distributes UUIDs poorly — they share most of their alphabet, so
 * the sums cluster and half a project ends up amber.
 */
export function colourFor(authorId: string): AnnotationColour {
  let hash = 2166136261;
  for (let i = 0; i < authorId.length; i++) {
    hash ^= authorId.charCodeAt(i);
    // The FNV prime, by shifts, because `* 16777619` overflows to a float and
    // stops being a hash.
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const index = Math.abs(hash) % ANNOTATION_COLOURS.length;
  return ANNOTATION_COLOURS[index]!;
}
