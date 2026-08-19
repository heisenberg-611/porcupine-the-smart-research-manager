"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "../../actions";

const TargetInput = z.object({
  projectId: z.uuid(),
  /**
   * The raw field value, because an empty string is meaningful: it CLEARS the
   * target. Coercing to a number here would turn "" into 0 — a target of zero
   * papers each, which the dashboard would then report everyone as having
   * exceeded. Parsed below, once, where the empty case is visible.
   */
  target: z.string().trim().max(6),
});

/**
 * How many papers each member is expected to extract.
 *
 * Owner or admin only, and enforced here rather than only by hiding the form:
 * a member who can read the project can call this action directly, and "the
 * button was not rendered" is not an authorization check.
 *
 * A target, not a limit. Nothing anywhere refuses an extraction past it —
 * see the note on the column in schema.prisma. The number exists so a team of
 * four dividing a hundred papers can see "18 of 25" instead of "18", which is
 * the difference between a count and a progress report.
 */
export async function setExtractionTarget(
  input: z.input<typeof TargetInput>,
): Promise<ActionResult> {
  const parsed = TargetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That is not a number." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, target } = parsed.data;

  let value: number | null = null;
  if (target !== "") {
    if (!/^\d+$/.test(target)) {
      return { ok: false, error: "Use a whole number of papers, or leave it empty." };
    }
    value = Number(target);
    // Nought is not a target, it is the absence of one, and the field already
    // has a way to say that. Left in, the dashboard would report every member
    // as having exceeded their share before anyone had read anything.
    if (value === 0) value = null;
    if (value !== null && value > 100000) {
      return { ok: false, error: "That is more papers than anyone will read." };
    }
  }

  try {
    await withUserContext(claims, async (tx) => {
      const membership = await tx.projectMember.findFirst({
        where: { projectId, userId: claims.sub, removedAt: null },
        select: { accessRole: true },
      });

      if (membership?.accessRole !== "OWNER" && membership?.accessRole !== "ADMIN") {
        throw new Error("forbidden");
      }

      await tx.project.update({
        where: { id: projectId },
        data: { extractionTarget: value },
      });
    });

    revalidatePath(`/projects/${projectId}/extract`);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return { ok: false, error: "Only an owner or admin can set the target." };
    }
    return { ok: false, error: "Could not save the target." };
  }
}
