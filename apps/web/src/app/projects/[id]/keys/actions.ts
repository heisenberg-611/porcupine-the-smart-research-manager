"use server";

import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

/**
 * Project key provisioning.
 *
 * Everything cryptographic happens in the browser. This file moves opaque
 * bytes and enforces nothing about them — RLS does that, and
 * `13_project_keys.sql` is what says so:
 *
 *   * a wrap can only be inserted by a project member
 *   * `wrapped_by` must be the caller, so a wrap cannot claim someone else
 *     made it
 *   * there is no UPDATE or DELETE policy, so the table is append-only and a
 *     rotation adds an epoch rather than editing one
 *
 * The signature over each wrap is verified by the RECIPIENT, in the browser,
 * against the wrapper's public signing key. Verifying it here would prove
 * nothing to anyone who does not already trust this server.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface MemberKey {
  userId: string;
  displayName: string;
  identityPubKey: string;
  signingPubKey: string;
  /**
   * Which of these is the caller.
   *
   * From the session on the server rather than worked out in the browser: the
   * client has a private key, not a user id, and deriving "which member am I"
   * by comparing keys would be a needless second answer to a question the
   * server has already answered.
   */
  isMe: boolean;
}

/**
 * The public keys of everyone who should hold this project's key.
 *
 * Members without identity keys are returned too, flagged by empty strings, so
 * the caller can say "three of four members can be given the key" rather than
 * silently provisioning a subset. Someone who never finished enrolment is a
 * person to chase, not a row to skip quietly.
 */
export async function getMemberKeys(
  projectId: string,
): Promise<ActionResult<MemberKey[]>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };
  if (!z.uuid().safeParse(projectId).success) {
    return { ok: false, error: "Invalid project." };
  }

  try {
    const members = await withUserContext(claims, async (tx) => {
      const rows = await tx.projectMember.findMany({
        where: { projectId, removedAt: null },
        select: {
          userId: true,
          user: {
            select: { displayName: true, identityPubKey: true, signingPubKey: true },
          },
        },
      });

      return rows.map((row) => ({
        userId: row.userId,
        isMe: row.userId === claims.sub,
        displayName: row.user?.displayName ?? "Unknown",
        identityPubKey: row.user?.identityPubKey
          ? Buffer.from(row.user.identityPubKey).toString("base64")
          : "",
        signingPubKey: row.user?.signingPubKey
          ? Buffer.from(row.user.signingPubKey).toString("base64")
          : "",
      }));
    });

    return { ok: true, data: members };
  } catch {
    return { ok: false, error: "Could not load member keys." };
  }
}

const WrapInput = z.object({
  userId: z.uuid(),
  wrappedKey: z.base64(),
  signature: z.base64(),
});

const ProvisionInput = z.object({
  projectId: z.uuid(),
  epoch: z.number().int().min(1),
  wraps: z.array(WrapInput).min(1),
});

/**
 * Write one epoch's wraps.
 *
 * All of them in one transaction, because a half-provisioned epoch is worse
 * than none: `current_key_epoch` would advance while some members hold no key
 * for it, and they would silently stop being able to read new content.
 *
 * Rotation and first provisioning are the same operation deliberately. The
 * only difference is which epoch number is being written, and having one code
 * path means the rotation case cannot be the one nobody exercised.
 */
export async function provisionProjectKey(
  input: z.input<typeof ProvisionInput>,
): Promise<ActionResult<{ epoch: number; wraps: number }>> {
  const parsed = ProvisionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Malformed key wraps." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, epoch, wraps } = parsed.data;

  try {
    await withUserContext(claims, async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { currentKeyEpoch: true },
      });

      // RLS already returns nothing for a project this caller is not in, so a
      // missing row here means "not a member" as much as "not a project".
      if (!project) throw new Error("NO_PROJECT");

      // Exactly current + 1, not merely greater. Two people rotating at once
      // must not both succeed with different numbers, and a client that skipped
      // ahead would leave an epoch nobody holds a key for.
      if (epoch !== project.currentKeyEpoch + 1) throw new Error("STALE_EPOCH");

      await tx.projectKey.createMany({
        data: wraps.map((wrap) => ({
          projectId,
          userId: wrap.userId,
          epoch,
          wrappedKey: Buffer.from(wrap.wrappedKey, "base64"),
          wrappedBy: claims.sub,
          signature: Buffer.from(wrap.signature, "base64"),
        })),
      });

      // Advanced only after every wrap has landed, in the same transaction.
      await tx.project.update({
        where: { id: projectId },
        data: { currentKeyEpoch: epoch },
      });
    });

    return { ok: true, data: { epoch, wraps: wraps.length } };
  } catch (err) {
    if (err instanceof Error && err.message === "NO_PROJECT") {
      return { ok: false, error: "That project does not exist, or you are not in it." };
    }
    if (err instanceof Error && err.message === "STALE_EPOCH") {
      // Two people rotating at once. Both wrote valid wraps; the second is
      // simply late, and retrying with a fresh epoch is the right response.
      return {
        ok: false,
        error: "Someone else rotated the key first. Reload and try again.",
      };
    }
    return { ok: false, error: "Could not store the project key." };
  }
}

export interface KeyState {
  /** 0 means no key has ever been provisioned. */
  currentEpoch: number;
  /** What the next provisioning must write. Always current + 1. */
  nextEpoch: number;
  myWraps: MyWrap[];
}

/**
 * What epoch to sign, and what I already hold.
 *
 * The epoch is decided HERE rather than in the browser because it goes inside
 * the signed context of every wrap — get it wrong and the recipient sees a
 * forgery, which is the right failure and a baffling one. The client asks,
 * signs what it is told, and the server checks it got the same answer.
 */
export async function getKeyState(projectId: string): Promise<ActionResult<KeyState>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };
  if (!z.uuid().safeParse(projectId).success) {
    return { ok: false, error: "Invalid project." };
  }

  try {
    const state = await withUserContext(claims, async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { currentKeyEpoch: true },
      });
      if (!project) throw new Error("NO_PROJECT");

      const rows = await tx.projectKey.findMany({
        where: { projectId },
        orderBy: { epoch: "desc" },
        select: { epoch: true, wrappedKey: true, signature: true, wrappedBy: true },
      });

      const currentEpoch = project.currentKeyEpoch;
      return {
        currentEpoch,
        nextEpoch: currentEpoch + 1,
        myWraps: rows.map((row) => ({
          epoch: row.epoch,
          wrappedKey: Buffer.from(row.wrappedKey).toString("base64"),
          signature: Buffer.from(row.signature).toString("base64"),
          wrappedBy: row.wrappedBy,
        })),
      };
    });

    return { ok: true, data: state };
  } catch (err) {
    if (err instanceof Error && err.message === "NO_PROJECT") {
      return { ok: false, error: "That project does not exist, or you are not in it." };
    }
    return { ok: false, error: "Could not load the key state." };
  }
}

export interface MyWrap {
  epoch: number;
  wrappedKey: string;
  signature: string;
  wrappedBy: string;
}
