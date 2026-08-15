import sodium from "libsodium-wrappers-sumo";

import { initCrypto } from "./identity";

/**
 * Project keys — the thing project content is actually encrypted under.
 *
 * One 32-byte key per project per EPOCH, sealed separately to every member.
 * The server stores the sealed copies and never sees the key: `project_keys`
 * holds `(project_id, user_id, epoch, wrapped_key, wrapped_by, signature)`,
 * which has been in the schema since Phase 0 with nothing writing to it.
 *
 * ═══ Why a signature, when the box is already sealed ═══
 *
 * `crypto_box_seal` is ANONYMOUS. Anyone holding a member's public key can
 * produce a sealed box that member can open — including the server, which
 * holds every public key by definition. Without a signature the server could
 * hand a member a project key of its own choosing, that member would encrypt
 * their next message under it, and the server would read it. The seal protects
 * confidentiality in transit and proves nothing about origin.
 *
 * So every wrap is signed by the member who made it, with their Ed25519 key,
 * and `unwrapProjectKey` REFUSES a wrap whose signature does not verify. A
 * signature that is checked only when convenient is not a signature.
 *
 * ═══ What the signature covers ═══
 *
 * Not just the ciphertext. The ciphertext plus the context it belongs to:
 * project, recipient, epoch. Signing the bytes alone would let a valid wrap be
 * REPLAYED — moved to a different epoch row, or to a different member's row,
 * by whoever stores it. Both are rows the server controls.
 *
 * Version-prefixed, because the day this format changes the old rows still
 * have to verify.
 */

const WRAP_VERSION = 1;
const PROJECT_KEY_BYTES = 32;

export interface ProjectKeyWrap {
  /** `crypto_box_seal` ciphertext — opens only with the member's private key. */
  wrappedKey: Uint8Array;
  /** Detached Ed25519 signature over version ‖ context ‖ wrappedKey. */
  signature: Uint8Array;
}

export interface WrapContext {
  projectId: string;
  /** The member this wrap is FOR. */
  userId: string;
  epoch: number;
}

/** A fresh project key. Never leaves the client in the clear. */
export async function createProjectKey(): Promise<Uint8Array> {
  await initCrypto();
  return sodium.randombytes_buf(PROJECT_KEY_BYTES);
}

/**
 * The exact bytes a signature covers.
 *
 * Length-prefixed rather than concatenated. `a|b` and `ab|` are the same string
 * under naive concatenation, so an attacker who controls where one field ends
 * can move a byte from one field to the next and keep the signature valid.
 * uuids and integers make that hard to exploit here; doing it properly costs
 * four bytes per field and removes the argument entirely.
 */
function signedPayload(context: WrapContext, wrappedKey: Uint8Array): Uint8Array {
  // `sodium.from_string`, not `TextEncoder`: this package's tsconfig has no DOM
  // lib, and widening it for one call would invite DOM use into code whose
  // whole point is that it is pure. libsodium is already a dependency and its
  // UTF-8 conversion is the same conversion.
  const parts = [
    sodium.from_string(context.projectId),
    sodium.from_string(context.userId),
    sodium.from_string(String(context.epoch)),
    wrappedKey,
  ];

  const size = 1 + parts.reduce((n, p) => n + 4 + p.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);

  out[0] = WRAP_VERSION;
  let off = 1;
  for (const part of parts) {
    view.setUint32(off, part.length, false);
    out.set(part, off + 4);
    off += 4 + part.length;
  }
  return out;
}

/**
 * Seal a project key to one member, and sign the result.
 *
 * `recipientPubKey` is the member's X25519 identity key, which the server
 * holds and serves. That is fine: the seal is anonymous and the signature is
 * what makes it trustworthy.
 */
export async function wrapProjectKeyFor(
  projectKey: Uint8Array,
  recipientPubKey: Uint8Array,
  signingPrivKey: Uint8Array,
  context: WrapContext,
): Promise<ProjectKeyWrap> {
  await initCrypto();

  const wrappedKey = sodium.crypto_box_seal(projectKey, recipientPubKey);
  const signature = sodium.crypto_sign_detached(
    signedPayload(context, wrappedKey),
    signingPrivKey,
  );

  return { wrappedKey, signature };
}

/**
 * Open a wrap addressed to me, having first checked who made it.
 *
 * The signature is verified BEFORE the box is opened. Verifying afterwards
 * would still be correct, but it means the decrypt runs on attacker-supplied
 * bytes for no reason — and it makes it far too easy for someone later to
 * "optimise" the check into a branch that is skipped when it fails.
 *
 * Throws rather than returning null. A wrap that does not verify is not a
 * missing key, it is someone trying something, and the difference should be
 * impossible to swallow with `?? null`.
 */
export async function unwrapProjectKey(
  wrap: ProjectKeyWrap,
  context: WrapContext,
  wrapperSigningPubKey: Uint8Array,
  myIdentityPubKey: Uint8Array,
  myIdentityPrivKey: Uint8Array,
): Promise<Uint8Array> {
  await initCrypto();

  const ok = sodium.crypto_sign_verify_detached(
    wrap.signature,
    signedPayload(context, wrap.wrappedKey),
    wrapperSigningPubKey,
  );

  if (!ok) {
    throw new Error(
      "This project key was not signed by the member it claims to be from.",
    );
  }

  try {
    return sodium.crypto_box_seal_open(
      wrap.wrappedKey,
      myIdentityPubKey,
      myIdentityPrivKey,
    );
  } catch {
    throw new Error("This project key was not sealed to you.");
  }
}
