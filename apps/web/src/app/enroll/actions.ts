"use server";

import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

/**
 * Stores the public halves of a user's identity and the opaque wrapped
 * bundle of their private halves.
 *
 * The server never receives the recovery passphrase or any private key —
 * `wrappedBundle` is ciphertext it cannot open. `kdfSalt` is not secret; it
 * is needed to re-derive the KEK on another device.
 *
 * Runs under `withUserContext`, so RLS decides whether this user may write
 * this row. There is no service-role path here on purpose: if the policy is
 * wrong this must fail, not succeed with elevated rights.
 */
const StoreKeysInput = z.object({
  identityPubKey: z.base64(),
  signingPubKey: z.base64(),
  wrappedBundle: z.base64(),
  kdfSalt: z.base64(),
});

export type StoreKeysResult = { ok: true } | { ok: false; error: string };

export async function storeIdentityKeys(
  input: z.infer<typeof StoreKeysInput>,
): Promise<StoreKeysResult> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const parsed = StoreKeysInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Malformed key material." };

  const { identityPubKey, signingPubKey, wrappedBundle, kdfSalt } = parsed.data;

  /*
   * The version comes from the BLOB, not from the client and not from a
   * constant here.
   *
   * This was `keyBundleVer: 1`, hard-coded, which was true for exactly as long
   * as there was one format. `createIdentity` now produces v2 — a master key
   * sealed under the KEK, identity keys sealed under the master key — and a
   * column that says 1 about a v2 blob is worse than no column: the migration
   * path reads it to decide what to re-wrap.
   *
   * Taking it from the first byte means the two cannot disagree. Trusting a
   * separate client-supplied field would just move the same problem.
   */
  const bundleBytes = Buffer.from(wrappedBundle, "base64");
  const keyBundleVer = bundleBytes[0];

  if (keyBundleVer !== 1 && keyBundleVer !== 2) {
    return { ok: false, error: "Unrecognised key bundle format." };
  }

  try {
    await withUserContext(claims, async (tx) => {
      // Enrollment is once-only. Overwriting an existing bundle would strand
      // every ciphertext already wrapped to the old key, so refuse instead —
      // key rotation is a separate, deliberate flow (Phase 3).
      const existing = await tx.user.findUnique({
        where: { id: claims.sub },
        select: { identityPubKey: true },
      });

      if (existing?.identityPubKey) throw new Error("ALREADY_ENROLLED");

      await tx.user.update({
        where: { id: claims.sub },
        data: {
          identityPubKey: Buffer.from(identityPubKey, "base64"),
          signingPubKey: Buffer.from(signingPubKey, "base64"),
          wrappedBundle: bundleBytes,
          kdfSalt: Buffer.from(kdfSalt, "base64"),
          keyBundleVer,
        },
      });
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message === "ALREADY_ENROLLED") {
      return { ok: false, error: "This account already has identity keys." };
    }
    return { ok: false, error: "Could not store identity keys." };
  }
}

/** Whether the signed-in user still needs enrollment. */
export async function needsEnrollment(): Promise<boolean> {
  const claims = await getUserClaims();
  if (!claims) return false;

  return withUserContext(claims, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: claims.sub },
      select: { identityPubKey: true },
    });
    return !user?.identityPubKey;
  });
}
