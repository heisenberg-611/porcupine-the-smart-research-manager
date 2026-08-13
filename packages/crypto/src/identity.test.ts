import { describe, expect, it } from "vitest";

import {
  createIdentity,
  generateRecoveryPassphrase,
  initCrypto,
  keyFingerprint,
  unwrapIdentity,
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
