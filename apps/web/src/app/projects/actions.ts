"use server";

import { PROJECT_KINDS } from "@Porcupine/shared";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { prisma, withUserContext } from "@/server/db";

const CreateProjectInput = z.object({
  title: z.string().trim().min(1, "Give the project a title.").max(200),
  description: z.string().trim().max(2000).optional(),
  kind: z.enum(PROJECT_KINDS),
});

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

function slugify(title: string) {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "project"}-${Math.random().toString(36).slice(2, 8)}`;
}

import {
  createProjectFolder,
  shareGoogleFile,
  getAdminToken,
  getGoogleEmail,
} from "@/lib/google";

export async function createProject(
  input: z.infer<typeof CreateProjectInput>,
): Promise<ActionResult<{ id: string }>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const parsed = CreateProjectInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { title, description, kind } = parsed.data;

  try {
    const project = await withUserContext(claims, async (tx) => {
      const created = await tx.project.create({
        data: {
          slug: slugify(title),
          title,
          ...(description ? { description } : {}),
          kind,
          createdBy: claims.sub,
        },
        select: { id: true },
      });

      await tx.projectMember.create({
        data: {
          projectId: created.id,
          userId: claims.sub,
          accessRole: "OWNER",
          joinedAt: new Date(),
        },
      });

      return created;
    });

    revalidatePath("/projects");
    return { ok: true, data: { id: project.id } };
  } catch {
    return { ok: false, error: "Could not create the project." };
  }
}

const InviteMemberInput = z.object({
  projectId: z.uuid(),
  email: z.email("Enter a valid email address."),
  accessRole: z.enum(["ADMIN", "CONTRIBUTOR", "REVIEWER", "OBSERVER"]),
  historyAccess: z.enum(["ALL_HISTORY", "FROM_JOIN"]),
});

export async function inviteMember(
  input: z.infer<typeof InviteMemberInput>,
): Promise<ActionResult> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const parsed = InviteMemberInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { projectId, email, accessRole, historyAccess } = parsed.data;

  try {
    // We must use the global `prisma` client to look up the invitee by email.
    // RLS restricts `tx.user` visibility to self and co-members, which means
    // we would never be able to invite a stranger because their row would be invisible.
    const invitee = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!invitee) {
      return {
        ok: false as const,
        error: "No Porcupine account for that address yet.",
      };
    }

    return await withUserContext(claims, async (tx) => {
      const existing = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: invitee.id } },
        select: { id: true, removedAt: true },
      });

      if (existing && !existing.removedAt) {
        return { ok: false as const, error: "They are already on this project." };
      }

      if (existing) {
        await tx.projectMember.update({
          where: { id: existing.id },
          data: {
            removedAt: null,
            accessRole,
            historyAccess,
            joinedAt: new Date(),
            invitedBy: claims.sub,
            ...(historyAccess === "FROM_JOIN" ? { historyFrom: new Date() } : {}),
          },
        });
      } else {
        await tx.projectMember.create({
          data: {
            projectId,
            userId: invitee.id,
            accessRole,
            historyAccess,
            invitedBy: claims.sub,
            joinedAt: new Date(),
            ...(historyAccess === "FROM_JOIN" ? { historyFrom: new Date() } : {}),
          },
        });
      }

      // Check if project has a Google Drive folder and we have a token
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { driveFolderId: true },
      });

      const cookieStore = await cookies();
      const providerToken = cookieStore.get("google_provider_token")?.value;

      if (project?.driveFolderId && providerToken && accessRole === "OBSERVER") {
        try {
          await shareGoogleFile(providerToken, project.driveFolderId, email, "reader");
        } catch (e) {
          console.error(`Failed to automatically share folder with ${email}`, e);
        }
      }

      revalidatePath(`/projects/${projectId}`);
      return { ok: true as const };
    });
  } catch {
    // The most likely cause is the RLS policy rejecting the insert, i.e. the
    // caller is not an owner or admin. Do not distinguish that from other
    // failures in the message.
    return { ok: false, error: "Could not add that member." };
  }
}

const UpdateMemberRoleInput = z.object({
  projectId: z.uuid(),
  userId: z.uuid(),
  accessRole: z.enum(["ADMIN", "CONTRIBUTOR", "REVIEWER", "OBSERVER"]),
});

export async function updateMemberRole(
  input: z.infer<typeof UpdateMemberRoleInput>,
): Promise<ActionResult> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const parsed = UpdateMemberRoleInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input." };
  }
  const { projectId, userId, accessRole } = parsed.data;

  try {
    return await withUserContext(claims, async (tx) => {
      const existing = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        include: { user: true },
      });

      if (!existing || existing.removedAt) {
        return { ok: false, error: "Member not found." };
      }

      await tx.projectMember.update({
        where: { id: existing.id },
        data: { accessRole },
      });

      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { driveFolderId: true, googleRefreshToken: true },
      });

      if (project?.driveFolderId && project.googleRefreshToken && existing.user.email) {
        const { shareGoogleFile, getAdminToken } = await import("@/lib/google");
        const adminToken = await getAdminToken(project.googleRefreshToken);
        if (adminToken) {
          let role: "writer" | "commenter" | "reader" = "reader";
          if (["OWNER", "ADMIN", "CONTRIBUTOR"].includes(accessRole)) role = "writer";
          else if (["REVIEWER"].includes(accessRole)) role = "commenter";

          try {
            await shareGoogleFile(
              adminToken,
              project.driveFolderId,
              existing.user.email,
              role,
            );
          } catch (e) {
            console.error(
              `Failed to update google access role for ${existing.user.email}`,
              e,
            );
          }
        }
      }

      revalidatePath(`/projects/${projectId}`);
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not update the member." };
  }
}

const RemoveMemberInput = z.object({
  projectId: z.uuid(),
  userId: z.uuid(),
});

export async function removeMember(
  input: z.infer<typeof RemoveMemberInput>,
): Promise<ActionResult> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const parsed = RemoveMemberInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input." };
  }
  const { projectId, userId } = parsed.data;

  try {
    return await withUserContext(claims, async (tx) => {
      const existing = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        include: { user: true },
      });

      if (!existing || existing.removedAt) {
        return { ok: false, error: "Member not found." };
      }

      await tx.projectMember.update({
        where: { id: existing.id },
        data: { removedAt: new Date() },
      });

      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { driveFolderId: true, googleRefreshToken: true },
      });

      if (project?.driveFolderId && project.googleRefreshToken && existing.user.email) {
        const { revokeGoogleFileAccess, getAdminToken } = await import("@/lib/google");
        const adminToken = await getAdminToken(project.googleRefreshToken);
        if (adminToken) {
          try {
            await revokeGoogleFileAccess(
              adminToken,
              project.driveFolderId,
              existing.user.email,
            );
          } catch (e) {
            console.error(`Failed to revoke access for ${existing.user.email}`, e);
          }
        }
      }

      revalidatePath(`/projects/${projectId}`);
      return { ok: true };
    });
  } catch {
    return { ok: false, error: "Could not remove the member." };
  }
}

export async function provisionSharedDriveFolder(
  projectId: string,
): Promise<ActionResult> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const cookieStore = await cookies();
  const providerToken = cookieStore.get("google_provider_token")?.value;
  const refreshToken = cookieStore.get("google_provider_refresh_token")?.value;

  if (!providerToken) {
    return { ok: false, error: "Google account not connected." };
  }

  try {
    return await withUserContext(claims, async (tx) => {
      // Must be an admin/owner to create it. We can rely on RLS, but Prisma
      // doesn't fully enforce RLS on updates, so we check membership manually.
      const me = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: claims.sub } },
      });
      if (!me || (me.accessRole !== "OWNER" && me.accessRole !== "ADMIN")) {
        return { ok: false, error: "Only project admins can connect Google Workspace." };
      }

      const project = await tx.project.findUnique({
        where: { id: projectId },
      });

      if (!project) return { ok: false, error: "Project not found." };
      if (project.driveFolderId) {
        return { ok: false, error: "Google Drive folder already exists." };
      }

      const googleEmail = await getGoogleEmail(providerToken);
      const userRecord = await tx.user.findUnique({
        where: { id: claims.sub },
        select: { email: true },
      });

      if (googleEmail?.toLowerCase() !== userRecord?.email?.toLowerCase()) {
        return {
          ok: false,
          error:
            "Account Mismatch: The Google account you connected does not match your Porcupine login email. Please disconnect your Google account below and try again with the correct account.",
        };
      }

      let driveFolderId: string | undefined | null;
      try {
        driveFolderId = await createProjectFolder(providerToken, project.title);
      } catch (e: unknown) {
        console.error("createProjectFolder failed", e);
        if (
          e instanceof Error &&
          e.message.includes("insufficient authentication scopes")
        ) {
          return {
            ok: false,
            error:
              "Missing Google Drive permissions. Please reconnect your account and make sure to CHECK ALL BOXES on the Google consent screen.",
          };
        }
        return { ok: false, error: "Failed to create Google Drive folder." };
      }

      if (!driveFolderId) {
        return { ok: false, error: "Failed to create Google Drive folder." };
      }

      await tx.project.update({
        where: { id: projectId },
        data: {
          driveFolderId,
          ...(refreshToken ? { googleRefreshToken: refreshToken } : {}),
        },
      });

      // Grant permissions to existing members automatically ONLY for OBSERVER (Viewer).
      // Other roles will get access when they connect their Google Account.
      const members = await tx.projectMember.findMany({
        where: { projectId },
        include: { user: true },
      });

      for (const member of members) {
        if (!member.user.email) continue;
        if (member.accessRole !== "OBSERVER") continue; // only Viewers get auto-sharing

        try {
          await shareGoogleFile(
            providerToken,
            driveFolderId,
            member.user.email,
            "reader",
          );
        } catch (e) {
          console.error(`Failed to share folder with ${member.user.email}`, e);
        }
      }

      revalidatePath(`/projects/${projectId}`);
      return { ok: true };
    });
  } catch (e: unknown) {
    console.error("provisionSharedDriveFolder failed:", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "An unexpected error occurred.",
    };
  }
}

export async function registerGoogleAccount(projectId: string): Promise<ActionResult> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const cookieStore = await cookies();
  const providerToken = cookieStore.get("google_provider_token")?.value;

  if (!providerToken) {
    return { ok: false, error: "Google account not connected." };
  }

  try {
    return await withUserContext(claims, async (tx) => {
      const me = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: claims.sub } },
      });
      if (!me) return { ok: false, error: "Not a project member." };

      // Observers are already invited automatically upon creation/joining
      if (me.accessRole === "OBSERVER") return { ok: true };

      const project = await tx.project.findUnique({
        where: { id: projectId },
      });

      if (!project || !project.driveFolderId) {
        return { ok: false, error: "Project folder not found." };
      }

      if (!project.googleRefreshToken) {
        return {
          ok: false,
          error:
            "Admin has not enabled automated sharing. Please ask the admin to share the folder manually.",
        };
      }

      const googleEmail = await getGoogleEmail(providerToken);
      if (!googleEmail) {
        return { ok: false, error: "Could not retrieve your Google email address." };
      }

      const userRecord = await tx.user.findUnique({
        where: { id: claims.sub },
        select: { email: true },
      });

      if (googleEmail?.toLowerCase() !== userRecord?.email?.toLowerCase()) {
        return {
          ok: false,
          error:
            "Account Mismatch: The Google account you connected does not match your Porcupine login email. Please disconnect your Google account below and try again with the correct account.",
        };
      }

      const adminToken = await getAdminToken(project.googleRefreshToken);
      if (!adminToken) {
        return { ok: false, error: "Admin token expired. Automated sharing failed." };
      }

      let role: "writer" | "commenter" | "reader" = "reader";
      if (["OWNER", "ADMIN", "CONTRIBUTOR"].includes(me.accessRole)) role = "writer";
      else if (["REVIEWER"].includes(me.accessRole)) role = "commenter";

      try {
        await shareGoogleFile(adminToken, project.driveFolderId, googleEmail, role);
      } catch (e) {
        console.error(`Failed to register google account for ${googleEmail}`, e);
        return { ok: false, error: "Google Drive API failed to grant access." };
      }

      return { ok: true };
    });
  } catch (e: unknown) {
    console.error("registerGoogleAccount failed:", e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "An unexpected error occurred.",
    };
  }
}

export async function checkGoogleConnection() {
  const cookieStore = await cookies();
  const providerToken = cookieStore.get("google_provider_token")?.value;
  if (!providerToken) return { connected: false, scopes: [] as string[] };

  try {
    const res = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${providerToken}`,
    );
    if (!res.ok) return { connected: false, scopes: [] as string[] };
    const data = await res.json();
    const scopes: string[] = (data.scope || "").split(" ");
    return { connected: true, scopes };
  } catch {
    return { connected: false, scopes: [] as string[] };
  }
}

export async function disconnectGoogleAccount() {
  console.log("[disconnectGoogleAccount] Start");
  const cookieStore = await cookies();
  cookieStore.delete("google_provider_token");
  cookieStore.delete("google_provider_refresh_token");

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  console.log(`[disconnectGoogleAccount] User: ${user?.email}`);

  if (user && user.identities) {
    const googleIdentity = user.identities.find((id) => id.provider === "google");
    // Only unlink if they have more than 1 identity to prevent them from being completely signed out of Porcupine
    if (googleIdentity && user.identities.length > 1) {
      try {
        await supabase.auth.unlinkIdentity(googleIdentity);
        console.log("[disconnectGoogleAccount] Unlinked google identity");
      } catch (e) {
        console.error("Failed to unlink identity:", e);
      }
    } else if (googleIdentity && user.identities.length === 1) {
      console.log(
        "[disconnectGoogleAccount] Skipped unlinking Google identity because it is their only login method. Retaining session.",
      );
    } else {
      console.log(
        "[disconnectGoogleAccount] No google identity found in user.identities",
      );
    }

    if (user.email) {
      try {
        const memberProjects = await prisma.projectMember.findMany({
          where: { userId: user.id, removedAt: null },
          include: { project: true },
        });

        console.log(
          `[disconnectGoogleAccount] Found ${memberProjects.length} projects for user`,
        );

        const { revokeGoogleFileAccess, getAdminToken } = await import("@/lib/google");

        for (const mp of memberProjects) {
          console.log(
            `[disconnectGoogleAccount] Processing project ${mp.project.id}, driveFolderId=${mp.project.driveFolderId}, hasRefreshToken=${!!mp.project.googleRefreshToken}`,
          );
          if (mp.project.driveFolderId && mp.project.googleRefreshToken) {
            // Check if the user is the admin (owner) of this project. If they are the owner, they own the folder.
            // We shouldn't revoke their access, but we should remove the refresh token so the project loses automation capabilities!
            if (mp.accessRole === "OWNER" || mp.accessRole === "ADMIN") {
              console.log(
                `[disconnectGoogleAccount] User is OWNER/ADMIN of project ${mp.project.id}. Removing project.googleRefreshToken instead of revoking file access.`,
              );
              await prisma.project.update({
                where: { id: mp.project.id },
                data: { googleRefreshToken: null },
              });
              continue;
            }

            const adminToken = await getAdminToken(mp.project.googleRefreshToken);
            if (adminToken) {
              console.log(
                `[disconnectGoogleAccount] Calling revokeGoogleFileAccess for ${user.email} on folder ${mp.project.driveFolderId}`,
              );
              await revokeGoogleFileAccess(
                adminToken,
                mp.project.driveFolderId,
                user.email,
              ).catch((e) => {
                console.error(
                  `Failed to revoke access for ${user.email} on project ${mp.project.id}`,
                  e,
                );
              });
            } else {
              console.log(
                `[disconnectGoogleAccount] Failed to get admin token for project ${mp.project.id}`,
              );
            }
          }
        }
      } catch (e) {
        console.error("Failed to revoke google file access on disconnect:", e);
      }
    }
  }
  console.log("[disconnectGoogleAccount] Done");
  return { ok: true };
}

const DeleteProjectInput = z.object({
  projectId: z.string().uuid(),
});

export async function deleteProject(
  input: z.infer<typeof DeleteProjectInput>,
): Promise<ActionResult> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const parsed = DeleteProjectInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input." };
  }
  const { projectId } = parsed.data;

  try {
    return await withUserContext(claims, async (tx) => {
      const me = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: claims.sub } },
      });

      if (!me || me.accessRole !== "OWNER") {
        return { ok: false, error: "Only project owners can delete projects." };
      }

      await tx.project.delete({
        where: { id: projectId },
      });

      // We don't redirect here because the action is called from a dialog which
      // handles client-side redirection after a successful response.
      // We do need to revalidate the projects list.
      revalidatePath("/projects");
      return { ok: true };
    });
  } catch (e: unknown) {
    console.error("deleteProject failed:", e);
    return { ok: false, error: "Could not delete the project." };
  }
}
