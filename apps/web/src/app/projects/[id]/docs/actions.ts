"use server";

import { cookies } from "next/headers";

import type { DriveFile } from "./drive-file";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";
import {
  createGoogleDoc,
  createGoogleSheet,
  createGoogleSlide,
  listFolderFiles,
  shareGoogleFile,
} from "@/lib/google";
import type { ActionResult } from "../../actions";

const CreateFileInput = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required").max(100),
  type: z.enum(["doc", "sheet", "slide"]),
});

const ShareFileInput = z.object({
  fileId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["reader", "commenter", "writer"]),
});

export async function shareFileAction(
  input: z.infer<typeof ShareFileInput>,
): Promise<ActionResult> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const parsed = ShareFileInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input." };
  }
  const { fileId, email, role } = parsed.data;

  const cookieStore = await cookies();
  const providerToken = cookieStore.get("google_provider_token")?.value;

  if (!providerToken) {
    return { ok: false, error: "Google account not connected." };
  }

  try {
    await shareGoogleFile(providerToken, fileId, email, role);
    return { ok: true };
  } catch (e: unknown) {
    console.error("shareFileAction failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Failed to share file." };
  }
}

export async function createCollaborationFile(
  input: z.infer<typeof CreateFileInput>,
): Promise<ActionResult<{ url: string | null; isFallback?: boolean }>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const parsed = CreateFileInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { projectId, title, type } = parsed.data;

  const cookieStore = await cookies();
  const providerToken = cookieStore.get("google_provider_token")?.value;

  if (!providerToken) {
    return { ok: false, error: "Google account not connected. Please connect it first." };
  }

  try {
    return await withUserContext(claims, async (tx) => {
      const me = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: claims.sub } },
      });
      if (!me) {
        return { ok: false, error: "You are not a member of this project." };
      }

      // Let Google Drive API be the ultimate source of truth for write permissions.
      // If they don't have permission (either due to role or Google Drive bugs),
      // the API will throw a 403, which automatically triggers the personal drive fallback.

      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { driveFolderId: true, title: true },
      });

      const targetFolderId = project?.driveFolderId || undefined;

      let result;
      let isFallback = false;
      try {
        if (type === "doc") {
          result = await createGoogleDoc(providerToken, title, projectId, targetFolderId);
        } else if (type === "slide") {
          result = await createGoogleSlide(
            providerToken,
            title,
            projectId,
            targetFolderId,
          );
        } else {
          result = await createGoogleSheet(
            providerToken,
            title,
            projectId,
            targetFolderId,
          );
        }
      } catch (e: unknown) {
        const err = e as { status?: number; code?: number; message?: string } | undefined;
        const isPermissionError =
          err?.status === 403 ||
          err?.code === 403 ||
          err?.message?.toLowerCase().includes("permission") ||
          err?.message?.toLowerCase().includes("forbidden");

        if (isPermissionError) {
          console.warn("Failed to create in shared folder, falling back to personal folder", e);
          const { ensurePersonalFallbackFolder } = await import("@/lib/google");
          
          try {
             const fallbackFolderId = await ensurePersonalFallbackFolder(
               providerToken,
               projectId,
               project?.title || "Project"
             );
             isFallback = true;
             
             if (type === "doc") {
               result = await createGoogleDoc(providerToken, title, projectId, fallbackFolderId);
             } else if (type === "slide") {
               result = await createGoogleSlide(providerToken, title, projectId, fallbackFolderId);
             } else {
               result = await createGoogleSheet(providerToken, title, projectId, fallbackFolderId);
             }
          } catch (fallbackErr) {
             console.error("Fallback creation failed", fallbackErr);
             return {
               ok: false,
               error: "Failed to create file in both shared and personal drives. Check your permissions.",
             };
          }
        } else {
          console.error("Failed to create file", e);
          return {
            ok: false,
            error:
              "Failed to create file in Google Drive. Ensure your Google account is connected.",
          };
        }
      }

      revalidatePath(`/projects/${projectId}/docs`);
      return { ok: true, data: { url: result.webViewLink ?? null, isFallback } };
    });
  } catch (e: unknown) {
    console.error("createCollaborationFile failed:", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create file. Check permissions.",
    };
  }
}

/*
 * The return type is a Drive entry, not `any[]`.
 *
 * It was `any[]` behind an `eslint-disable-next-line`, and the directive was
 * on the wrong line — it covered the `export async function` and not the
 * `any` three lines below it, so ESLint reported both an unused directive and
 * the error it was meant to suppress. `DriveFile` is the shape the client was
 * already assuming; see `drive-file.ts` for why it is declared there rather
 * than in either of the two files that use it.
 */
export async function fetchFolderContents(
  folderId: string,
): Promise<ActionResult<DriveFile[]>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const cookieStore = await cookies();
  const providerToken = cookieStore.get("google_provider_token")?.value;

  if (!providerToken) {
    return { ok: false, error: "Google account not connected. Please connect it first." };
  }

  try {
    const files = await listFolderFiles(providerToken, folderId);
    return { ok: true, data: files };
  } catch (e: unknown) {
    console.error("fetchFolderContents failed:", e);
    return { ok: false, error: "Failed to fetch folder contents. Check permissions." };
  }
}
