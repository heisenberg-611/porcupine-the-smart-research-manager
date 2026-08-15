"use server";

import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

/**
 * Unlock support.
 *
 * The server's whole role here is to hand back two things it cannot use: an
 * opaque wrapped bundle and a salt. Everything that turns them into keys
 * happens in the browser, and the passphrase never crosses this boundary — if
 * it ever appears as an argument to anything in this file, the encryption
 * claim is void.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface KeyMaterial {
  wrappedBundle: string;
  kdfSalt: string;
  keyBundleVer: number;
}

/**
 * My own wrapped bundle. Only ever my own — there is no user id parameter,
 * deliberately, so there is no version of this function that could be called
 * with someone else's.
 */
export async function getMyKeyMaterial(): Promise<ActionResult<KeyMaterial | null>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  try {
    const material = await withUserContext(claims, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: claims.sub },
        select: { wrappedBundle: true, kdfSalt: true, keyBundleVer: true },
      });

      if (!user?.wrappedBundle || !user.kdfSalt) return null;

      return {
        wrappedBundle: Buffer.from(user.wrappedBundle).toString("base64"),
        kdfSalt: Buffer.from(user.kdfSalt).toString("base64"),
        keyBundleVer: user.keyBundleVer ?? 1,
      };
    });

    return { ok: true, data: material };
  } catch {
    return { ok: false, error: "Could not load your key material." };
  }
}

const RewrapInput = z.object({ wrappedBundle: z.base64() });

/**
 * Store a bundle that has been re-wrapped to the current format.
 *
 * The only write in the app that overwrites `wrappedBundle`, and it is safe
 * precisely because it cannot change what the bundle CONTAINS: the client
 * unwrapped a v1 bundle and re-sealed the same keypairs under the same
 * passphrase. The public keys are untouched and are not writable here at all.
 *
 * The version is read from the blob rather than taken as an argument, for the
 * same reason it is in enrolment: a column that can disagree with the bytes it
 * describes eventually will.
 *
 * Refuses to move backwards. A v2 bundle overwritten by a v1 one is a
 * downgrade, and the only ways to ask for that are a bug and an attack.
 */
export async function storeRewrappedBundle(
  input: z.input<typeof RewrapInput>,
): Promise<ActionResult<{ keyBundleVer: number }>> {
  const parsed = RewrapInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Malformed key bundle." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const bytes = Buffer.from(parsed.data.wrappedBundle, "base64");
  const version = bytes[0];
  if (version !== 2) return { ok: false, error: "Unrecognised key bundle format." };

  try {
    await withUserContext(claims, async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: claims.sub },
        select: { keyBundleVer: true, identityPubKey: true },
      });

      if (!current?.identityPubKey) throw new Error("NOT_ENROLLED");
      if ((current.keyBundleVer ?? 1) >= version) throw new Error("NOT_A_MIGRATION");

      await tx.user.update({
        where: { id: claims.sub },
        data: { wrappedBundle: bytes, keyBundleVer: version },
      });
    });

    return { ok: true, data: { keyBundleVer: version } };
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_ENROLLED") {
      return { ok: false, error: "This account has no identity keys yet." };
    }
    if (err instanceof Error && err.message === "NOT_A_MIGRATION") {
      // Not worth alarming anyone about: two tabs racing the same upgrade is
      // the ordinary way to reach this.
      return { ok: false, error: "Your key bundle is already up to date." };
    }
    return { ok: false, error: "Could not store the re-wrapped bundle." };
  }
}
