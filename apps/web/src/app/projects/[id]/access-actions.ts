"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isSafeAccessUrl } from "@/components/access-route";
import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "../actions";

/**
 * The project's route to papers the DOI will not open.
 *
 * Owner or admin only, and enforced here rather than only in the form: this
 * value is rendered as a link that every member of the project clicks, which
 * makes it stored input with an audience. The scheme check is the reason —
 * `javascript:` in a field one person types and twenty people click is the
 * oldest trick there is.
 */
const AccessInput = z.object({
  projectId: z.uuid(),
  url: z.string().trim().max(500),
  label: z.string().trim().max(80),
});

export async function setAccessRoute(
  input: z.input<typeof AccessInput>,
): Promise<ActionResult> {
  const parsed = AccessInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Malformed access route." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, url, label } = parsed.data;

  // Empty clears it, which is how someone removes a resolver that turned out
  // to be wrong — and a wrong one is worse than none, because it fails
  // silently and reads as the paper being unavailable.
  if (url !== "" && !isSafeAccessUrl(url)) {
    return { ok: false, error: "That must be a full http:// or https:// address." };
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
        data: {
          accessHelpUrl: url === "" ? null : url,
          accessHelpLabel: url === "" || label === "" ? null : label,
        },
      });
    });

    // Every paper surface shows this, so all of them are stale.
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") {
      return { ok: false, error: "Only an owner or admin can set this." };
    }
    return { ok: false, error: "Could not save the access route." };
  }
}
