"use server";

import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "./actions";

/**
 * Devices.
 *
 * The server stores a public key and an opaque wrap, and can do nothing with
 * either. `devices` RLS is `user_id = current_user_id()` for every command, so
 * a person manages only their own — there is no admin path to someone else's
 * devices, deliberately, because the row IS the access.
 *
 * Revocation is a DELETE, not a flag. The wrapped master key lives here rather
 * than in the browser precisely so that removing the row is real: the device
 * still holds a key it cannot export, and no longer has anything to open with
 * it. A `revoked_at` column that left the ciphertext in place would make
 * revoke a suggestion, so the column stays unused and the row goes.
 */

export interface DeviceRow {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt: string | null;
}

const RegisterInput = z.object({
  label: z.string().min(1).max(80),
  devicePubKey: z.base64(),
  wrappedMasterKey: z.base64(),
});

export async function registerDevice(
  input: z.input<typeof RegisterInput>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = RegisterInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Malformed device registration." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { label, devicePubKey, wrappedMasterKey } = parsed.data;

  try {
    const created = await withUserContext(claims, (tx) =>
      tx.device.create({
        data: {
          userId: claims.sub,
          label,
          devicePubKey: Buffer.from(devicePubKey, "base64"),
          wrappedMasterKey: Buffer.from(wrappedMasterKey, "base64"),
          lastSeenAt: new Date(),
        },
        select: { id: true },
      }),
    );
    return { ok: true, data: created };
  } catch {
    return { ok: false, error: "Could not register this device." };
  }
}

/**
 * The wrap for a device, by its public key.
 *
 * Looked up by the key rather than by an id kept in the browser, because the
 * key is the thing the device actually still has: a browser whose IndexedDB
 * survived but whose localStorage did not should still be able to find its own
 * row.
 */
export async function getDeviceWrap(
  devicePubKey: string,
): Promise<ActionResult<{ wrappedMasterKey: string } | null>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };
  if (!z.base64().safeParse(devicePubKey).success) {
    return { ok: false, error: "Invalid device key." };
  }

  try {
    const row = await withUserContext(claims, async (tx) => {
      const device = await tx.device.findFirst({
        where: { userId: claims.sub, devicePubKey: Buffer.from(devicePubKey, "base64") },
        select: { id: true, wrappedMasterKey: true },
      });
      if (!device) return null;

      await tx.device.update({
        where: { id: device.id },
        data: { lastSeenAt: new Date() },
      });

      return {
        wrappedMasterKey: Buffer.from(device.wrappedMasterKey).toString("base64"),
      };
    });

    return { ok: true, data: row };
  } catch {
    return { ok: false, error: "Could not look up this device." };
  }
}

export async function listDevices(): Promise<ActionResult<DeviceRow[]>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  try {
    const rows = await withUserContext(claims, (tx) =>
      tx.device.findMany({
        where: { userId: claims.sub },
        orderBy: { createdAt: "asc" },
        select: { id: true, label: true, createdAt: true, lastSeenAt: true },
      }),
    );

    return {
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        label: row.label,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      })),
    };
  } catch {
    return { ok: false, error: "Could not load your devices." };
  }
}

export async function revokeDevice(
  deviceId: string,
): Promise<ActionResult<{ id: string }>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };
  if (!z.uuid().safeParse(deviceId).success) {
    return { ok: false, error: "Invalid device." };
  }

  try {
    await withUserContext(claims, async (tx) => {
      // deleteMany, not delete: scoped by userId as well as id, so a wrong id
      // deletes nothing rather than erroring in a way that confirms the row
      // exists. RLS already prevents reaching another user's row; this makes
      // the code say so too.
      const { count } = await tx.device.deleteMany({
        where: { id: deviceId, userId: claims.sub },
      });
      if (count === 0) throw new Error("NOT_FOUND");
    });
    return { ok: true, data: { id: deviceId } };
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return { ok: false, error: "That device is not registered to you." };
    }
    return { ok: false, error: "Could not revoke that device." };
  }
}
