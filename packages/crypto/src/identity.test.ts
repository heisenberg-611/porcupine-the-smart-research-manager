import { describe, expect, it, vi } from "vitest";

import {
  createIdentity,
  CURRENT_BUNDLE_VERSION,
  generateRecoveryPassphrase,
  initCrypto,
  keyFingerprint,
  rewrapIdentity,
  unwrapIdentity,
  unwrapMasterKey,
  wrapMasterKey,
} from "./identity";

// Argon2id is deliberately slow. These are seconds, not milliseconds.
const TIMEOUT = 30_000;

/**
 * Hex without Buffer. This package must stay browser-only — pulling in
 * @types/node here would let Node APIs leak into source, and the whole
 * premise is that this code runs on the user's device.
 */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("identity", () => {
  it(
    "round-trips private keys through the wrapped bundle",
    async () => {
      const identity = await createIdentity();

      const unwrapped = await unwrapIdentity(
        identity.wrappedBundle,
        identity.kdfSalt,
        identity.recoveryPassphrase,
      );

      // X25519 and Ed25519 private key sizes.
      expect(unwrapped.identityPrivKey).toHaveLength(32);
      expect(unwrapped.signingPrivKey).toHaveLength(64);
    },
    TIMEOUT,
  );

  it(
    "rejects a wrong passphrase rather than returning garbage",
    async () => {
      const identity = await createIdentity();

      // The AEAD tag fails — the one signal a malicious server cannot forge.
      await expect(
        unwrapIdentity(identity.wrappedBundle, identity.kdfSalt, "WRONG-PASSPHRASE"),
      ).rejects.toThrow(/Incorrect recovery passphrase/);
    },
    TIMEOUT,
  );

  it(
    "never puts private key material in the wrapped bundle in cleartext",
    async () => {
      const identity = await createIdentity();
      const unwrapped = await unwrapIdentity(
        identity.wrappedBundle,
        identity.kdfSalt,
        identity.recoveryPassphrase,
      );

      // The blob the server stores must not contain the plaintext key.
      const haystack = hex(identity.wrappedBundle);
      const boxNeedle = hex(unwrapped.identityPrivKey);
      const signNeedle = hex(unwrapped.signingPrivKey);

      expect(haystack).not.toContain(boxNeedle);
      expect(haystack).not.toContain(signNeedle);
    },
    TIMEOUT,
  );

  it(
    "produces a distinct identity every time",
    async () => {
      const [a, b] = await Promise.all([createIdentity(), createIdentity()]);
      expect(hex(a.identityPubKey)).not.toEqual(hex(b.identityPubKey));
      expect(a.recoveryPassphrase).not.toEqual(b.recoveryPassphrase);
      expect(hex(a.kdfSalt)).not.toEqual(hex(b.kdfSalt));
    },
    TIMEOUT,
  );
});

describe("recovery passphrase", () => {
  it("avoids ambiguous characters", async () => {
    await initCrypto();
    // No I, L, O, or U: no 1/l/I or 0/O confusion, and no accidental words.
    for (let i = 0; i < 50; i++) {
      expect(generateRecoveryPassphrase()).not.toMatch(/[ILOU]/);
    }
  });

  it("carries at least 128 bits of entropy", async () => {
    await initCrypto();
    const passphrase = generateRecoveryPassphrase();
    const symbols = passphrase.replace(/-/g, "").length;
    // 32-symbol alphabet = 5 bits each.
    expect(symbols * 5).toBeGreaterThanOrEqual(128);
  });

  it("is stable in shape, so the UI can lay it out", async () => {
    await initCrypto();
    expect(generateRecoveryPassphrase()).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){5}$/);
  });
});

describe("key fingerprint", () => {
  it(
    "is deterministic for a key and differs across keys",
    async () => {
      const a = await createIdentity();
      const b = await createIdentity();

      expect(await keyFingerprint(a.identityPubKey)).toBe(
        await keyFingerprint(a.identityPubKey),
      );
      expect(await keyFingerprint(a.identityPubKey)).not.toBe(
        await keyFingerprint(b.identityPubKey),
      );
    },
    TIMEOUT,
  );
});

describe("the master key layer (Phase 3 week 1)", () => {
  // Every case here derives a KEK at least twice, and Argon2id is deliberately
  // expensive. Seconds, not milliseconds.
  vi.setConfig({ testTimeout: 120_000 });

  /**
   * v1 sealed the identity private halves DIRECTLY under the Argon2id KEK, so
   * there was exactly one way in and no second unwrap path could ever be added
   * without the recovery passphrase. `devices.wrapped_master_key` has been a
   * column with nothing to put in it since the schema was written.
   *
   * These build a genuine v1 bundle by hand rather than trusting a fixture,
   * because the migration is the half that cannot be assumed: if v1 stops
   * opening, the failure is silent until someone with an old account signs in.
   */
  async function makeV1Bundle(passphrase: string) {
    await initCrypto();
    const sodium = (await import("libsodium-wrappers-sumo")).default;

    const boxKeys = sodium.crypto_box_keypair();
    const signKeys = sodium.crypto_sign_keypair();
    const kdfSalt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    const kek = sodium.crypto_pwhash(
      sodium.crypto_secretbox_KEYBYTES,
      passphrase.normalize("NFKC"),
      kdfSalt,
      sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );

    // The v1 private-bundle frame: [u16 len ‖ bytes] per key.
    const bp = boxKeys.privateKey;
    const sp = signKeys.privateKey;
    const plain = new Uint8Array(2 + bp.length + 2 + sp.length);
    const pv = new DataView(plain.buffer);
    pv.setUint16(0, bp.length, false);
    plain.set(bp, 2);
    pv.setUint16(2 + bp.length, sp.length, false);
    plain.set(sp, 4 + bp.length);

    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ct = sodium.crypto_secretbox_easy(plain, nonce, kek);
    const wrapped = new Uint8Array(1 + nonce.length + ct.length);
    wrapped[0] = 1;
    wrapped.set(nonce, 1);
    wrapped.set(ct, 1 + nonce.length);

    return { wrapped, kdfSalt, identityPrivKey: bp, signingPrivKey: sp };
  }

  it("still opens a v1 bundle, and asks to be re-wrapped", async () => {
    const passphrase = "TEST1-TEST2-TEST3-TEST4-TEST5-TEST6";
    const v1 = await makeV1Bundle(passphrase);

    const opened = await unwrapIdentity(v1.wrapped, v1.kdfSalt, passphrase);

    expect(opened.identityPrivKey).toEqual(v1.identityPrivKey);
    expect(opened.signingPrivKey).toEqual(v1.signingPrivKey);
    expect(opened.needsRewrap).toBe(true);
    // Minted, not stored — a v1 bundle has no master key in it.
    expect(opened.masterKey).toHaveLength(32);
  });

  it("re-wraps a v1 bundle to v2 without changing the keypairs", async () => {
    // The keypairs must survive untouched. A public key that changes is
    // indistinguishable from an attack to anyone who compared a safety number.
    const passphrase = "TEST1-TEST2-TEST3-TEST4-TEST5-TEST6";
    const v1 = await makeV1Bundle(passphrase);

    const opened = await unwrapIdentity(v1.wrapped, v1.kdfSalt, passphrase);
    const v2 = await rewrapIdentity(opened, v1.kdfSalt, passphrase);
    expect(v2[0]).toBe(CURRENT_BUNDLE_VERSION);

    const reopened = await unwrapIdentity(v2, v1.kdfSalt, passphrase);
    expect(reopened.identityPrivKey).toEqual(v1.identityPrivKey);
    expect(reopened.signingPrivKey).toEqual(v1.signingPrivKey);
    expect(reopened.masterKey).toEqual(opened.masterKey);
    expect(reopened.needsRewrap).toBe(false);
  });

  it("makes a v2 bundle by default, and returns a master key", async () => {
    const identity = await createIdentity();
    expect(identity.wrappedBundle[0]).toBe(CURRENT_BUNDLE_VERSION);

    const opened = await unwrapIdentity(
      identity.wrappedBundle,
      identity.kdfSalt,
      identity.recoveryPassphrase,
    );
    expect(opened.masterKey).toHaveLength(32);
    expect(opened.needsRewrap).toBe(false);
  });

  it("refuses a wrong passphrase against v2", async () => {
    const identity = await createIdentity();
    await expect(
      unwrapIdentity(identity.wrappedBundle, identity.kdfSalt, "WRONG-PASSPHRASE"),
    ).rejects.toThrow(/passphrase/i);
  });

  it("refuses a tampered bundle rather than returning wrong keys", async () => {
    const identity = await createIdentity();
    const tampered = new Uint8Array(identity.wrappedBundle);
    // Flip a byte inside the identity wrap's ciphertext. `noUncheckedIndexedAccess`
    // is right to insist the read could be undefined, so it is not read blind.
    const at = tampered.length - 5;
    tampered[at] = (tampered[at] ?? 0) ^ 0xff;

    await expect(
      unwrapIdentity(tampered, identity.kdfSalt, identity.recoveryPassphrase),
    ).rejects.toThrow();
  });

  it("refuses a truncated bundle instead of failing confusingly", async () => {
    // Length-prefixed framing is only a safety property if the lengths are
    // checked; otherwise a short blob yields a subarray and an AEAD error that
    // blames the passphrase.
    const identity = await createIdentity();
    const truncated = identity.wrappedBundle.subarray(
      0,
      identity.wrappedBundle.length - 10,
    );

    await expect(
      unwrapIdentity(truncated, identity.kdfSalt, identity.recoveryPassphrase),
    ).rejects.toThrow(/malformed/i);
  });

  it("wraps and unwraps the master key on its own", async () => {
    // The reason the layer exists: the same 32 bytes sealed to another key,
    // without re-encrypting the private bundle and without the passphrase.
    const identity = await createIdentity();
    const opened = await unwrapIdentity(
      identity.wrappedBundle,
      identity.kdfSalt,
      identity.recoveryPassphrase,
    );

    const deviceKey = new Uint8Array(32).fill(7);
    const wrapped = await wrapMasterKey(opened.masterKey, deviceKey);
    expect(await unwrapMasterKey(wrapped, deviceKey)).toEqual(opened.masterKey);

    const wrongKey = new Uint8Array(32).fill(8);
    await expect(unwrapMasterKey(wrapped, wrongKey)).rejects.toThrow();
  });
});
