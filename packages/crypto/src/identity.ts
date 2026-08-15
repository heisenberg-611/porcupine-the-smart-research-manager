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
/**
 * Bundle format versions.
 *
 * v1: identity private halves sealed DIRECTLY under the Argon2id KEK.
 * v2: a 32-byte Master Key sealed under the KEK, identity privates sealed
 *     under the Master Key.
 *
 * The difference is the whole of Phase 3 week 1, and it is not cosmetic. v1
 * has exactly one way in, so no second unwrap path can ever be added without
 * the recovery passphrase: registering a device would need it every time, and
 * org escrow could not be added to an existing account at all. The Master Key
 * exists to be the ONE thing that many keys wrap — the recovery passphrase
 * today, a device key or an escrow key later — and `devices.wrapped_master_key`
 * has been a column with nothing to put in it since the schema was written.
 *
 * v1 still opens, and re-wraps to v2 on first unlock. There are no v1 rows
 * outside a developer's laptop, and the path is written anyway: "there were no
 * users when we skipped it" is how a migration becomes impossible.
 */
const BUNDLE_V1 = 1;
const BUNDLE_V2 = 2;
export const CURRENT_BUNDLE_VERSION = BUNDLE_V2;

/** 32 bytes, the size of a secretbox key. */
const MASTER_KEY_BYTES = 32;

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
 * Seal bytes under a symmetric key. Returns `nonce ‖ ciphertext`.
 *
 * Its own function because it is used three times and will be used more: the
 * Master Key under the KEK, the identity bundle under the Master Key, and —
 * once devices exist — the Master Key under a device key. A second unwrap path
 * should be a row, not a rewrite.
 */
function seal(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.length);
  return out;
}

/** Open `nonce ‖ ciphertext`. Throws on a wrong key or a tampered blob. */
function open(sealed: Uint8Array, key: Uint8Array): Uint8Array {
  const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
  return sodium.crypto_secretbox_open_easy(
    sealed.subarray(nonceLen),
    sealed.subarray(0, nonceLen),
    key,
  );
}

/**
 * Wrap the Master Key so a new route can open it.
 *
 * Exported because week 2 needs it for devices: the point of the Master Key is
 * that the same 32 bytes can be sealed to several keys independently, so
 * adding a device does not re-encrypt the private bundle and does not need the
 * recovery passphrase.
 */
export async function wrapMasterKey(
  masterKey: Uint8Array,
  wrappingKey: Uint8Array,
): Promise<Uint8Array> {
  await initCrypto();
  return seal(masterKey, wrappingKey);
}

export async function unwrapMasterKey(
  wrapped: Uint8Array,
  wrappingKey: Uint8Array,
): Promise<Uint8Array> {
  await initCrypto();
  try {
    return open(wrapped, wrappingKey);
  } catch {
    throw new Error("Could not unwrap the master key");
  }
}

/**
 * Generates a fresh identity.
 *
 * The private halves are sealed under a Master Key, and the Master Key is
 * sealed under a KEK derived from a newly-generated recovery passphrase.
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

  const masterKey = sodium.randombytes_buf(MASTER_KEY_BYTES);

  // Length-prefixed so the format survives key sizes changing later.
  const plaintext = encodePrivateBundle(boxKeys.privateKey, signKeys.privateKey);

  const wrappedBundle = encodeV2(seal(masterKey, kek), seal(plaintext, masterKey));

  sodium.memzero(kek);
  sodium.memzero(plaintext);
  sodium.memzero(masterKey);

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
  /**
   * The Master Key, returned because the caller needs it.
   *
   * Week 2 wraps project keys to it and week 4 wraps it to devices. A v1
   * bundle has no Master Key stored, so one is MINTED on unwrap — see
   * `unwrapIdentity`. That is what makes the v1 → v2 migration possible
   * without asking anyone to re-enrol.
   */
  masterKey: Uint8Array;
  /**
   * True when this bundle is not the current format and should be re-wrapped.
   * The caller decides when: unwrapping happens in places where a write is not
   * always wanted.
   */
  needsRewrap: boolean;
}

/**
 * Re-derives the private keys from the wrapped bundle and the passphrase.
 *
 * Throws if the passphrase is wrong — the AEAD tag fails, which is exactly the
 * signal we want and the only one the server could not have forged.
 *
 * Opens BOTH formats. A v1 bundle has no Master Key in it, so one is minted
 * here and returned with `needsRewrap`; the caller re-wraps to v2 and writes
 * it back. The identity keypairs are unchanged by that, so nobody re-enrols
 * and no public key moves — which matters, because a public key changing is
 * indistinguishable from an attack to anyone who compared a safety number.
 */
export async function unwrapIdentity(
  wrappedBundle: Uint8Array,
  kdfSalt: Uint8Array,
  passphrase: string,
): Promise<UnwrappedIdentity> {
  await initCrypto();

  const version = wrappedBundle[0];
  const kek = deriveKek(passphrase, kdfSalt);

  try {
    if (version === BUNDLE_V1) {
      const plaintext = openOrThrow(wrappedBundle.subarray(1), kek);
      const identity = decodePrivateBundle(plaintext);
      sodium.memzero(plaintext);
      return {
        ...identity,
        masterKey: sodium.randombytes_buf(MASTER_KEY_BYTES),
        needsRewrap: true,
      };
    }

    if (version === BUNDLE_V2) {
      const { mkWrap, idWrap } = decodeV2(wrappedBundle);
      const masterKey = openOrThrow(mkWrap, kek);
      const plaintext = openOrThrow(idWrap, masterKey);
      const identity = decodePrivateBundle(plaintext);
      sodium.memzero(plaintext);
      return { ...identity, masterKey, needsRewrap: false };
    }

    throw new Error(`Unsupported key bundle version: ${String(version)}`);
  } finally {
    sodium.memzero(kek);
  }
}

/** Every failure to open under a passphrase-derived key means one thing. */
function openOrThrow(sealed: Uint8Array, key: Uint8Array): Uint8Array {
  try {
    return open(sealed, key);
  } catch {
    throw new Error("Incorrect recovery passphrase");
  }
}

/**
 * Re-wrap an already-unwrapped identity into the current format.
 *
 * Takes the passphrase again rather than the KEK: deriving it twice costs
 * another Argon2id pass, and keeping a KEK alive across an await to save that
 * is the kind of economy that leaves key material in a heap snapshot.
 */
export async function rewrapIdentity(
  identity: UnwrappedIdentity,
  kdfSalt: Uint8Array,
  passphrase: string,
): Promise<Uint8Array> {
  await initCrypto();

  const kek = deriveKek(passphrase, kdfSalt);
  const plaintext = encodePrivateBundle(
    identity.identityPrivKey,
    identity.signingPrivKey,
  );

  const wrapped = encodeV2(
    seal(identity.masterKey, kek),
    seal(plaintext, identity.masterKey),
  );

  sodium.memzero(kek);
  sodium.memzero(plaintext);
  return wrapped;
}

// ── v2 framing: version ‖ [u16 len ‖ sealed] × 2 ────────────────────────────

function encodeV2(mkWrap: Uint8Array, idWrap: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 2 + mkWrap.length + 2 + idWrap.length);
  const view = new DataView(out.buffer);
  out[0] = BUNDLE_V2;
  view.setUint16(1, mkWrap.length, false);
  out.set(mkWrap, 3);
  view.setUint16(3 + mkWrap.length, idWrap.length, false);
  out.set(idWrap, 5 + mkWrap.length);
  return out;
}

function decodeV2(buf: Uint8Array): { mkWrap: Uint8Array; idWrap: Uint8Array } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const mkLen = view.getUint16(1, false);
  const idLen = view.getUint16(3 + mkLen, false);

  // Length-prefixed framing is only a safety property if the lengths are
  // checked. A truncated blob otherwise yields a short subarray and a
  // confusing AEAD failure rather than an honest one.
  if (5 + mkLen + idLen !== buf.length) {
    throw new Error("Malformed key bundle");
  }

  return {
    mkWrap: buf.subarray(3, 3 + mkLen),
    idWrap: buf.subarray(5 + mkLen, 5 + mkLen + idLen),
  };
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

/** Just the keypairs. The Master Key and version live outside this frame. */
function decodePrivateBundle(
  buf: Uint8Array,
): Pick<UnwrappedIdentity, "identityPrivKey" | "signingPrivKey"> {
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
