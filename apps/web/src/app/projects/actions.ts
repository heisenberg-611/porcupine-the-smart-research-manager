"use server";

import { PROJECT_KINDS } from "@porcupine/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

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
  // Titles collide across users and the unique index is (orgId, slug), where
  // orgId is NULL for personal projects — so uniqueness is not guaranteed by
  // the title alone.
  return `${base || "project"}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates a project and the creator's OWNER membership in one transaction.
 *
 * This must be atomic. The `projects_insert_self` policy lets anyone create a
 * project, but `projects_select_member` means a project with no members is
 * invisible to everyone including its creator — so a half-completed create
 * would leak an orphan row that nobody can see or delete. The transaction is
 * the thing that makes the permissive insert policy safe.
 */
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
  // ADR-006: prompted at add time rather than assumed. Supervisors usually
  // join mid-thesis, and a partial view produces confusing empty screens.
  historyAccess: z.enum(["ALL_HISTORY", "FROM_JOIN"]),
});

/**
 * Adds an existing user to a project.
 *
 * Phase 0 requires the invitee to already have an account — email invitations
 * for strangers need a token table and a transactional email provider, which
 * is Phase 1 work (G-01). Authorization is entirely RLS's job: the
 * `project_members_insert_admin_or_bootstrap` policy rejects the insert
 * unless this caller is an OWNER or ADMIN, so there is no permission check
 * in this function and there should not be one.
 */
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
    return await withUserContext(claims, async (tx) => {
      const invitee = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });

      // RLS on `users` restricts visibility to self and co-members, so a
      // stranger's row is genuinely not found here. That is the right
      // behaviour and it doubles as not confirming whether an address has an
      // account — the message is the same either way.
      if (!invitee) {
        return {
          ok: false as const,
          error: "No Porcupine account for that address yet.",
        };
      }

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
