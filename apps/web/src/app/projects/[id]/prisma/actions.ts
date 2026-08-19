"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "../../actions";

/**
 * Every field a person can type into the PRISMA figure.
 *
 * A trimmed string rather than a number, and that is deliberate: `""` is how
 * somebody CLEARS a figure, and coercing early turns it into 0 — which in this
 * diagram is not "unstated" but "we checked, and it was none". Those are
 * different claims in a published figure, so the parse below keeps them apart
 * until the last moment.
 */
const COUNT_FIELDS = [
  "registersIdentified",
  "automationIneligible",
  "otherRemovedBefore",
  "reportsSought",
  "reportsNotRetrieved",
  "otherWebsites",
  "otherOrganisations",
  "otherCitationSearching",
  "otherReportsSought",
  "otherReportsNotRetrieved",
  "otherReportsAssessed",
  "otherReportsExcluded",
  "otherStudiesIncluded",
  "reportsOfIncludedStudies",
] as const;

export type CountField = (typeof COUNT_FIELDS)[number];

const CountsInput = z.object({
  projectId: z.uuid(),
  counts: z.record(z.enum(COUNT_FIELDS), z.string().trim().max(9)),
});

/**
 * Record the PRISMA figures this application cannot count.
 *
 * Owner or admin only, enforced here AND by the table's policies. These numbers
 * go into a published diagram: a contributor screening papers has no reason to
 * change what the review asserts about its own search, and an observer
 * certainly does not.
 */
export async function setPrismaCounts(
  input: z.input<typeof CountsInput>,
): Promise<ActionResult> {
  const parsed = CountsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Those are not valid counts." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, counts } = parsed.data;

  const data: Record<string, number | null> = {};
  for (const field of COUNT_FIELDS) {
    const raw = counts[field];
    if (raw === undefined) continue;

    if (raw === "") {
      // Cleared. Back to unstated, which the diagram draws as a dash.
      data[field] = null;
      continue;
    }
    if (!/^\d+$/.test(raw)) {
      return { ok: false, error: "Counts must be whole numbers, or left empty." };
    }
    const value = Number(raw);
    if (value > 1_000_000) {
      return { ok: false, error: "That is more records than any review has." };
    }
    data[field] = value;
  }

  try {
    await withUserContext(claims, async (tx) => {
      await tx.prismaManualCounts.upsert({
        where: { projectId },
        create: { projectId, updatedBy: claims.sub, ...data },
        update: { updatedBy: claims.sub, ...data },
        select: { projectId: true },
      });
    });

    revalidatePath(`/projects/${projectId}/prisma`);
    return { ok: true };
  } catch (error) {
    // The policies refuse a non-admin, and RLS surfaces that as a failed write
    // rather than a permission error with a name on it.
    if (error instanceof Error && /denied|policy|row-level/i.test(error.message)) {
      return { ok: false, error: "Only an owner or admin can set these." };
    }
    return { ok: false, error: "Could not save those counts." };
  }
}
