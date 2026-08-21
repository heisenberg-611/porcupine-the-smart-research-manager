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
  accessRole: string;
  isRemoved: boolean;
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
        where: { projectId },
        select: {
          userId: true,
          accessRole: true,
          removedAt: true,
          user: {
            select: { displayName: true, identityPubKey: true, signingPubKey: true },
          },
        },
      });

      return rows.map((row) => ({
        userId: row.userId,
        isMe: row.userId === claims.sub,
        accessRole: row.accessRole,
        isRemoved: row.removedAt !== null,
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

/** A member who cannot read the conversation yet, and why we know. */
export interface KeylessMember {
  userId: string;
  displayName: string;
  /** False when they have not finished enrolling — nothing to seal to yet. */
  enrolled: boolean;
  /** ALL_HISTORY or FROM_JOIN: how much of the past they are entitled to. */
  historyAccess: string;
}

export interface KeyState {
  /** 0 means no key has ever been provisioned. */
  currentEpoch: number;
  /** What the next provisioning must write. Always current + 1. */
  nextEpoch: number;
  myWraps: MyWrap[];
  /**
   * Members holding no wrap for the CURRENT epoch.
   *
   * The single most important thing this state can report, and it was absent:
   * without it a project silently splits into people who can read the
   * conversation and people who cannot, and the only symptom is somebody
   * saying "I can't see your messages".
   */
  keyless: KeylessMember[];
  /**
   * True when someone was removed from this project AFTER the newest key was
   * provisioned — so the current epoch is one a former member still holds.
   *
   * Computed rather than stored, because a stored flag is a thing that can be
   * wrong. The comparison is against the newest `project_keys` row's timestamp,
   * which is the moment the current key came into existence.
   *
   * This is a WINDOW, and naming it is the point. Rotation happens in a
   * browser — the server cannot do it, it holds no key — so between a removal
   * and the next unlocked admin there is a period where new content is still
   * readable by the person who left. Pretending otherwise would be the kind of
   * claim this codebase keeps deleting.
   */
  rotationNeeded: boolean;
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
        where: { projectId, userId: claims.sub },
        orderBy: { epoch: "desc" },
        select: { epoch: true, wrappedKey: true, signature: true, wrappedBy: true },
      });

      const newestKeyAt =
        rows.length > 0
          ? await tx.projectKey.findFirst({
              where: { projectId, userId: claims.sub },
              orderBy: { createdAt: "desc" },
              select: { createdAt: true },
            })
          : null;

      const removedSince = newestKeyAt
        ? await tx.projectMember.count({
            where: { projectId, removedAt: { gt: newestKeyAt.createdAt } },
          })
        : 0;

      const currentEpoch = project.currentKeyEpoch;

      /*
       * Who cannot read the conversation as it stands.
       *
       * Only meaningful once a key exists: before that nobody holds one and
       * everybody is "keyless", which is not a problem to report.
       */
      const keyless =
        currentEpoch === 0
          ? []
          : await tx.projectMember
              .findMany({
                where: {
                  projectId,
                  removedAt: null,
                  user: {
                    projectKeys: { none: { projectId, epoch: currentEpoch } },
                  },
                },
                select: {
                  userId: true,
                  historyAccess: true,
                  user: { select: { displayName: true, identityPubKey: true } },
                },
              })
              .then((rows) =>
                rows.map((row) => ({
                  userId: row.userId,
                  displayName: row.user?.displayName ?? "Unknown",
                  enrolled: (row.user?.identityPubKey?.length ?? 0) > 0,
                  historyAccess: String(row.historyAccess),
                })),
              );

      return {
        currentEpoch,
        nextEpoch: currentEpoch + 1,
        keyless,
        rotationNeeded: removedSince > 0,
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



const ShareInput = z.object({
  projectId: z.uuid(),
  userId: z.uuid(),
  wraps: z
    .array(
      z.object({
        epoch: z.number().int().min(1),
        wrappedKey: z.string().min(1),
        signature: z.string().min(1),
      }),
    )
    .min(1)
    .max(64),
});

/**
 * Give an existing key to a member who does not hold it.
 *
 * This is the operation the product was missing, and its absence is what made
 * adding somebody to a project go wrong. There was exactly one way to put a
 * key in a member's hands — `provisionProjectKey` — and it always mints a NEW
 * key at a NEW epoch. So a member who joined after the key existed was offered
 * "set up encryption", which rotated the project: the history became
 * unreadable to everyone who was not wrapped at the older epochs, and anybody
 * with the old epoch still cached kept writing messages the newcomer could not
 * read. Both sides reported being locked out, and both were right.
 *
 * Sharing is not rotating. Rotation exists for REMOVAL — a departed member
 * must not read what comes next — and it is the wrong shape for arrival, where
 * nothing needs to be kept from anybody.
 *
 * So this writes wraps for epochs that ALREADY EXIST and never touches
 * `current_key_epoch`.
 *
 * How far back is `history_access`, which the schema has carried since Phase 0
 * and nothing consulted: ALL_HISTORY gets every epoch the sharer holds,
 * FROM_JOIN gets the current one only. The caller decides which epochs to seal
 * because only the caller can open them, and the server checks the result.
 */
export async function shareProjectKey(
  input: z.input<typeof ShareInput>,
): Promise<ActionResult<{ epochs: number }>> {
  const parsed = ShareInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Malformed key wraps." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, userId, wraps } = parsed.data;

  try {
    const written = await withUserContext(claims, async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { currentKeyEpoch: true },
      });
      // RLS returns nothing for a project the caller is not in, so a missing
      // row means "not a member" as much as "no such project".
      if (!project) throw new Error("NO_PROJECT");
      if (project.currentKeyEpoch === 0) throw new Error("NO_KEY_YET");

      // The recipient must be a current member. Sealing to somebody who left
      // would hand back exactly what removal-and-rotation took away.
      const recipient = await tx.projectMember.findFirst({
        where: { projectId, userId, removedAt: null },
        select: { historyAccess: true },
      });
      if (!recipient) throw new Error("NOT_A_MEMBER");

      /*
       * Only epochs that already exist, and never beyond the current one.
       *
       * Without this a client could write a wrap for epoch 99 and leave the
       * project with a key nobody else holds and no way to reach it — the same
       * broken state this action exists to repair.
       */
      if (wraps.some((wrap) => wrap.epoch > project.currentKeyEpoch)) {
        throw new Error("FUTURE_EPOCH");
      }

      /*
       * And only epochs the CALLER holds.
       *
       * Anyone can produce a `crypto_box_seal` for a public key, so without
       * this a member could write authentic-looking wraps of a key they never
       * had. They would not open — the signature is checked on unwrap — but
       * the recipient would be left holding rows that fail verification, which
       * reads as corruption rather than as mischief.
       */
      const mine = await tx.projectKey.findMany({
        where: { projectId, userId: claims.sub },
        select: { epoch: true },
      });
      const held = new Set(mine.map((row) => row.epoch));
      if (wraps.some((wrap) => !held.has(wrap.epoch))) throw new Error("NOT_HELD");

      if (recipient.historyAccess === "FROM_JOIN") {
        const beyond = wraps.filter((wrap) => wrap.epoch !== project.currentKeyEpoch);
        if (beyond.length > 0) throw new Error("HISTORY_REFUSED");
      }

      const result = await tx.projectKey.createMany({
        data: wraps.map((wrap) => ({
          projectId,
          userId,
          epoch: wrap.epoch,
          wrappedKey: Buffer.from(wrap.wrappedKey, "base64"),
          wrappedBy: claims.sub,
          signature: Buffer.from(wrap.signature, "base64"),
        })),
        // Sharing twice is not an error; it is somebody clicking twice.
        skipDuplicates: true,
      });

      return result.count;
    });

    return { ok: true, data: { epochs: written } };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "";
    const said: Record<string, string> = {
      NO_PROJECT: "That project does not exist, or you are not in it.",
      NO_KEY_YET: "This project has no key to share yet.",
      NOT_A_MEMBER: "That person is not a member of this project.",
      FUTURE_EPOCH: "That key epoch does not exist yet.",
      NOT_HELD: "You can only share keys you hold yourself.",
      HISTORY_REFUSED:
        "That member joined with access from their join date, so only the current key may be shared.",
    };
    return { ok: false, error: said[reason] ?? "Could not share the key." };
  }
}
