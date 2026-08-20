"use server";

import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

/**
 * Channels and messages, as bytes.
 *
 * Nothing here can read anything it stores. Every field that carries meaning
 * is a `bytea` sealed in the browser, and the only things this file
 * understands are ids, epochs and who is asking — which is exactly the set the
 * server needs to enforce membership and no more.
 *
 * The `id`s arrive from the CLIENT. That is unusual and deliberate: both are
 * authenticated as associated data inside the ciphertext they name, so an id
 * minted here afterwards could not be inside the thing it identifies, and the
 * server could then move a ciphertext between rows undetectably.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ChannelRow {
  id: string;
  nameCt: string;
  epoch: number;
}

export interface MessageRow {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  epoch: number;
  ciphertext: string;
  createdAt: string;
}

const CreateChannelInput = z.object({
  projectId: z.uuid(),
  channelId: z.uuid(),
  nameCt: z.base64(),
  epoch: z.number().int().min(1),
});

export async function createChannel(
  input: z.input<typeof CreateChannelInput>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = CreateChannelInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Malformed channel." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, channelId, nameCt, epoch } = parsed.data;

  try {
    await withUserContext(claims, async (tx) => {
      await tx.channel.create({
        data: {
          id: channelId,
          projectId,
          nameCt: Buffer.from(nameCt, "base64"),
          epoch,
          createdBy: claims.sub,
        },
      });
    });
    return { ok: true, data: { id: channelId } };
  } catch {
    // RLS refuses a non-member, and the insert policy refuses a `created_by`
    // that is not the caller. Both arrive here as the same failure, which is
    // the right amount to tell someone who should not be here.
    return { ok: false, error: "Could not create the channel." };
  }
}

const DeleteChannelInput = z.object({
  projectId: z.uuid(),
  channelId: z.uuid(),
});

export async function deleteChannel(
  input: z.input<typeof DeleteChannelInput>,
): Promise<ActionResult<{ deleted: true }>> {
  const parsed = DeleteChannelInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, channelId } = parsed.data;

  try {
    await withUserContext(claims, async (tx) => {
      const me = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: claims.sub } },
        select: { accessRole: true },
      });
      if (!me || (me.accessRole !== "OWNER" && me.accessRole !== "ADMIN")) {
        throw new Error("NOT_AUTHORIZED");
      }

      await tx.channel.delete({
        where: { id: channelId, projectId },
      });
    });
    return { ok: true, data: { deleted: true } };
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_AUTHORIZED") {
      return { ok: false, error: "You do not have permission to delete channels." };
    }
    return { ok: false, error: "Could not delete the channel." };
  }
}

export async function listChannels(
  projectId: string,
): Promise<ActionResult<ChannelRow[]>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };
  if (!z.uuid().safeParse(projectId).success) {
    return { ok: false, error: "Invalid project." };
  }

  try {
    const rows = await withUserContext(claims, (tx) =>
      tx.channel.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
        select: { id: true, nameCt: true, epoch: true },
      }),
    );

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        nameCt: Buffer.from(row.nameCt).toString("base64"),
        epoch: row.epoch,
      })),
    };
  } catch {
    return { ok: false, error: "Could not load channels." };
  }
}

const SendInput = z.object({
  projectId: z.uuid(),
  channelId: z.uuid(),
  messageId: z.uuid(),
  epoch: z.number().int().min(1),
  ciphertext: z.base64(),
});

export async function sendMessage(
  input: z.input<typeof SendInput>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = SendInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Malformed message." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, channelId, messageId, epoch, ciphertext } = parsed.data;

  try {
    await withUserContext(claims, async (tx) => {
      await tx.message.create({
        data: {
          id: messageId,
          projectId,
          channelId,
          // Never from the input. The insert policy requires it to equal the
          // caller anyway, so accepting it as a parameter would be a field
          // that can only ever be right or rejected — and one day, wrong.
          authorId: claims.sub,
          epoch,
          ciphertext: Buffer.from(ciphertext, "base64"),
        },
      });
    });
    return { ok: true, data: { id: messageId } };
  } catch {
    return { ok: false, error: "Could not send the message." };
  }
}

export async function listMessages(
  projectId: string,
  channelId: string,
): Promise<ActionResult<MessageRow[]>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(channelId).success) {
    return { ok: false, error: "Invalid channel." };
  }

  try {
    const rows = await withUserContext(claims, (tx) =>
      tx.message.findMany({
        where: { projectId, channelId },
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          channelId: true,
          authorId: true,
          epoch: true,
          ciphertext: true,
          createdAt: true,
          author: { select: { displayName: true } },
        },
      }),
    );

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        channelId: row.channelId,
        authorId: row.authorId,
        authorName: row.author?.displayName ?? "Unknown",
        epoch: row.epoch,
        ciphertext: Buffer.from(row.ciphertext).toString("base64"),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  } catch {
    return { ok: false, error: "Could not load messages." };
  }
}

/*
 * ── Reactions ───────────────────────────────────────────────────────────────
 *
 * Encrypted like the messages they sit on: "Alice 👍 the message about the
 * null result" is sentiment and social graph, and the server holds neither.
 * See docs/14-messaging-ui-plan.md §2.
 */

export interface ReactionRow {
  id: string;
  messageId: string;
  authorId: string;
  authorName: string;
  epoch: number;
  /** base64 of the sealed emoji. */
  ciphertext: string;
}

const ReactInput = z.object({
  projectId: z.uuid(),
  messageId: z.uuid(),
  epoch: z.number().int().min(0),
  // Short by construction: this seals a single emoji, and a "reaction" the
  // size of a paragraph is somebody using the wrong feature.
  ciphertext: z.string().min(1).max(2048),
});

/**
 * Set — or replace — this person's reaction to a message.
 *
 * An upsert on `(message_id, author_id)`, which is the only uniqueness the
 * server can express: a constraint including the emoji would require the
 * server to see the emoji. So one reaction per person per message, and
 * reacting again replaces it. Removing is `clearReaction`.
 */
export async function setReaction(
  input: z.input<typeof ReactInput>,
): Promise<ActionResult<{ set: true }>> {
  const parsed = ReactInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Malformed reaction." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, messageId, epoch, ciphertext } = parsed.data;

  try {
    await withUserContext(claims, async (tx) => {
      const sealed = Buffer.from(ciphertext, "base64");

      /*
       * Find-then-write rather than `upsert`.
       *
       * Prisma compiles `upsert` to INSERT ... ON CONFLICT DO UPDATE, and the
       * proposed row is checked against the INSERT policy even when the
       * conflict path is taken — the same trap the extraction draft hit in
       * Phase 2. Explicit is also clearer about which policy each branch is
       * relying on: insert_own for the first, update_own for the rest.
       */
      const existing = await tx.messageReaction.findFirst({
        where: { messageId, authorId: claims.sub },
        select: { id: true },
      });

      if (existing) {
        await tx.messageReaction.update({
          where: { id: existing.id },
          data: { epoch, ciphertext: sealed },
        });
        return;
      }

      await tx.messageReaction.create({
        data: {
          projectId,
          messageId,
          // Never from the input: the policy requires it to equal the caller,
          // so a parameter here could only ever be right or rejected.
          authorId: claims.sub,
          epoch,
          ciphertext: sealed,
        },
      });
    });
    return { ok: true, data: { set: true } };
  } catch {
    return { ok: false, error: "Could not save that reaction." };
  }
}

/** Withdraw this person's reaction. Theirs only — the policy sees to that. */
export async function clearReaction(
  projectId: string,
  messageId: string,
): Promise<ActionResult<{ cleared: true }>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(messageId).success) {
    return { ok: false, error: "Invalid message." };
  }

  try {
    await withUserContext(claims, (tx) =>
      // deleteMany, not delete: a second click, or two tabs, must not throw a
      // record-not-found at somebody for removing something already removed.
      tx.messageReaction.deleteMany({
        where: { projectId, messageId, authorId: claims.sub },
      }),
    );
    return { ok: true, data: { cleared: true } };
  } catch {
    return { ok: false, error: "Could not remove that reaction." };
  }
}

/** Every reaction in a channel, for the client to decrypt and group. */
export async function listReactions(
  projectId: string,
  channelId: string,
): Promise<ActionResult<ReactionRow[]>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(channelId).success) {
    return { ok: false, error: "Invalid channel." };
  }

  try {
    const rows = await withUserContext(claims, (tx) =>
      tx.messageReaction.findMany({
        // Scoped through the message's channel, so one call serves the whole
        // conversation rather than one per message on screen.
        where: { projectId, message: { channelId } },
        select: {
          id: true,
          messageId: true,
          authorId: true,
          epoch: true,
          ciphertext: true,
          author: { select: { displayName: true } },
        },
      }),
    );

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        messageId: row.messageId,
        authorId: row.authorId,
        authorName: row.author?.displayName ?? "Unknown",
        epoch: row.epoch,
        ciphertext: Buffer.from(row.ciphertext).toString("base64"),
      })),
    };
  } catch {
    return { ok: false, error: "Could not load reactions." };
  }
}
