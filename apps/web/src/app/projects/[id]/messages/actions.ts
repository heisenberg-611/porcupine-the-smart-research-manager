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
