import sodium from "libsodium-wrappers-sumo";

/**
 * Identity key generation (ADR-001, ADR-009).
 *
 * Every user gets an identity keypair at signup from Phase 0, even though
 * nothing is encrypted until Phase 3. Public keys for early users must
 * already exist when the crypto features land, or the whole population needs
 * a re-enrollment flow — which, for keys, means a trust-on-first-use moment
 * you only get to spend once.
 *
 * ═══ The password problem ═══
 *
 * We authenticate with email OTP and OAuth, so there is no password to derive
 * a key-encryption key from. The private bundle is therefore wrapped under a
 * KEK derived from a **recovery passphrase** the system generates and shows
 * once. That is ADR-009's "recovery codes mandatory at signup" doing double
 * duty: it is both the account recovery mechanism and the only thing standing
 * between the server and the private keys.
 *
 * Consequence, stated plainly: a user who loses the passphrase loses access
 * to encrypted content. That is what end-to-end encryption means, and the UI
 * must say so at the moment the passphrase is shown — not in a help article.
 *
 * ═══ Where this runs ═══
 *
 * Browser only. The server never sees a private key or the passphrase; it
 * receives public halves and an opaque wrapped blob. Argon2id is deliberately
 * expensive, so Phase 3 should move these calls into a Web Worker to keep the
 * main thread responsive. At Phase 0 it runs once, at signup, behind a
 * spinner — acceptable, and noted so it does not get forgotten.
 */

let ready: Promise<void> | null = null;

/** libsodium loads WASM asynchronously; every entry point must await this. */
export async function initCrypto(): Promise<void> {
  ready ??= sodium.ready;
  await ready;
}

export interface IdentityBundle {
  /** X25519 public key — sealed-box key wrapping. Stored server-side. */
  identityPubKey: Uint8Array;
  /** Ed25519 public key — signing key wraps. Stored server-side. */
  signingPubKey: Uint8Array;
  /** Private keys, encrypted under the KEK. Opaque to the server. */
  wrappedBundle: Uint8Array;
  /** Argon2id salt. Not secret; needed to re-derive the KEK. */
  kdfSalt: Uint8Array;
  /** Shown to the user exactly once. Never transmitted. */
  recoveryPassphrase: string;
}

/**
 * Argon2id parameters.
 *
 * INTERACTIVE is ~64 MB and a few hundred milliseconds in a browser.
 * MODERATE would be stronger but costs ~256 MB, which a mid-range tablet
 * cannot spare while also holding a PDF and a search index (C-13). Revisit
 * with real device telemetry, and record any change here — the parameters
 * are part of the ciphertext's compatibility surface.
 *
 * Read at call time, never at module load: libsodium populates its constants
 * during `ready`, so capturing them at import gives you `undefined`.
 */
function argon2Params() {
  return {
    opslimit: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    memlimit: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
  };
}

/** Bundle format version, so parameters can change without silent breakage. */
const BUNDLE_VERSION = 1;

/**
 * A recovery passphrase with ~128 bits of entropy, formatted for a human to
 * copy accurately. Crockford base32 — no I, L, O, or U, so there is no
 * 1/l/I or 0/O confusion and no accidental profanity.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateRecoveryPassphrase(groups = 6, groupLen = 5): string {
  const total = groups * groupLen;
  const bytes = sodium.randombytes_buf(total);
  let out = "";
  for (let i = 0; i < total; i++) {
    if (i > 0 && i % groupLen === 0) out += "-";
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Derives the key-encryption key from the recovery passphrase. */
function deriveKek(passphrase: string, salt: Uint8Array): Uint8Array {
  const { opslimit, memlimit } = argon2Params();
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    passphrase.normalize("NFKC"),
    salt,
    opslimit,
    memlimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

/**
 * Generates a fresh identity and wraps the private halves under a
 * newly-generated recovery passphrase.
 *
 * The caller must show `recoveryPassphrase` to the user once and then drop
 * it. Everything else in the returned object is safe to persist.
 */
export async function createIdentity(): Promise<IdentityBundle> {
  await initCrypto();

  const boxKeys = sodium.crypto_box_keypair(); // X25519
  const signKeys = sodium.crypto_sign_keypair(); // Ed25519

  const recoveryPassphrase = generateRecoveryPassphrase();
  const kdfSalt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const kek = deriveKek(recoveryPassphrase, kdfSalt);

  // Length-prefixed so the format survives key sizes changing later.
  const plaintext = encodePrivateBundle(boxKeys.privateKey, signKeys.privateKey);

  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, kek);

  sodium.memzero(kek);
  sodium.memzero(plaintext);

  // version ‖ nonce ‖ ciphertext
  const wrappedBundle = new Uint8Array(1 + nonce.length + ciphertext.length);
  wrappedBundle[0] = BUNDLE_VERSION;
  wrappedBundle.set(nonce, 1);
  wrappedBundle.set(ciphertext, 1 + nonce.length);

  return {
    identityPubKey: boxKeys.publicKey,
    signingPubKey: signKeys.publicKey,
    wrappedBundle,
    kdfSalt,
    recoveryPassphrase,
  };
}

export interface UnwrappedIdentity {
  identityPrivKey: Uint8Array;
  signingPrivKey: Uint8Array;
}

/**
 * Re-derives the private keys from the wrapped bundle and the passphrase.
 * Throws if the passphrase is wrong — the AEAD tag fails, which is exactly
 * the signal we want and the only one the server could not have forged.
 */
export async function unwrapIdentity(
  wrappedBundle: Uint8Array,
  kdfSalt: Uint8Array,
  passphrase: string,
): Promise<UnwrappedIdentity> {
  await initCrypto();

  const version = wrappedBundle[0];
  if (version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported key bundle version: ${String(version)}`);
  }

  const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
  const nonce = wrappedBundle.subarray(1, 1 + nonceLen);
  const ciphertext = wrappedBundle.subarray(1 + nonceLen);

  const kek = deriveKek(passphrase, kdfSalt);
  let plaintext: Uint8Array;
  try {
    plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, kek);
  } catch {
    throw new Error("Incorrect recovery passphrase");
  } finally {
    sodium.memzero(kek);
  }

  return decodePrivateBundle(plaintext);
}

// ── Bundle encoding: [u16 len ‖ bytes] per key ──────────────────────────────

function encodePrivateBundle(boxPriv: Uint8Array, signPriv: Uint8Array) {
  const out = new Uint8Array(2 + boxPriv.length + 2 + signPriv.length);
  const view = new DataView(out.buffer);
  let off = 0;
  view.setUint16(off, boxPriv.length, false);
  out.set(boxPriv, off + 2);
  off += 2 + boxPriv.length;
  view.setUint16(off, signPriv.length, false);
  out.set(signPriv, off + 2);
  return out;
}

function decodePrivateBundle(buf: Uint8Array): UnwrappedIdentity {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  const boxLen = view.getUint16(off, false);
  const identityPrivKey = buf.slice(off + 2, off + 2 + boxLen);
  off += 2 + boxLen;
  const signLen = view.getUint16(off, false);
  const signingPrivKey = buf.slice(off + 2, off + 2 + signLen);
  return { identityPrivKey, signingPrivKey };
}

/**
 * A short, comparable fingerprint of an identity key — the "safety number"
 * two users read to each other to confirm nobody is in the middle.
 * Phase 3 surfaces this; it lives here because it must match the key format.
 */
export async function keyFingerprint(identityPubKey: Uint8Array): Promise<string> {
  await initCrypto();
  const hash = sodium.crypto_generichash(16, identityPubKey, null);
  return Array.from(hash.slice(0, 10))
    .map((b) => ALPHABET[b % ALPHABET.length])
    .join("")
    .replace(/(.{5})(?=.)/g, "$1-");
}
