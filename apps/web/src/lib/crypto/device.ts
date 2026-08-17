"use client";

/**
 * The device key — what removes the re-unlock.
 *
 * Until now an unlocked identity lived in memory and nowhere else, so a reload
 * or a second tab meant typing the recovery passphrase again. The fix is the
 * reason week 1 put a Master Key in the middle of the hierarchy: the same 32
 * bytes can be sealed to several keys independently, so a device is one more
 * wrap rather than a second copy of the private bundle.
 *
 * ═══ Why WebCrypto and not libsodium ═══
 *
 * libsodium is used everywhere else in this codebase and is not used here, for
 * one reason: WebCrypto can hold a key the page cannot read.
 * `generateKey(..., extractable: false, ...)` returns a `CryptoKey` that
 * JavaScript can USE and cannot EXPORT, and IndexedDB can store the handle
 * itself. libsodium keys are `Uint8Array`s — any script on the page can read
 * one and send it anywhere.
 *
 * ═══ What that buys, precisely ═══
 *
 * It does NOT make this device safe from a compromised page. Script running in
 * this origin can ask the browser to decrypt with the key, and it will.
 *
 * What it prevents is EXFILTRATION. An injected script can abuse the key while
 * the tab is open; it cannot take a copy away and keep using it afterwards,
 * and it cannot post the key to a server. Storing a passphrase-wrapped bundle
 * in `localStorage` would give an attacker something to walk off with and
 * grind offline. That difference is the whole design, and overstating it would
 * be worse than not doing it.
 *
 * ═══ Revocation is real ═══
 *
 * The wrapped master key lives on the SERVER, in `devices.wrapped_master_key`.
 * Deleting that row is genuine revocation: the device still holds a key and no
 * longer has anything to open with it. Keeping the ciphertext locally would
 * have made revoke a suggestion.
 *
 * ECDH-P256 → HKDF-SHA256 → AES-GCM, all standard WebCrypto. The device's
 * private half is non-extractable; the ephemeral half used at registration is
 * discarded immediately after.
 */

const DB_NAME = "Porcupine-device";
const STORE = "keys";
const KEY_ID = "device-ecdh";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not open the device store"));
  });
}

async function idb<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(new Error("Device store operation failed"));
    });
  } finally {
    db.close();
  }
}

export interface DeviceKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

/**
 * This browser's device keypair, created on first use.
 *
 * The private half is generated with `extractable: false` and never leaves the
 * browser's key store — not even to this module, which only ever holds a
 * handle to it.
 */
export async function getOrCreateDeviceKey(): Promise<DeviceKey> {
  const existing = await idb<DeviceKey | undefined>("readonly", (store) =>
    store.get(KEY_ID),
  );
  if (existing) return existing;

  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    // The whole point. A `true` here would make everything above decoration.
    false,
    ["deriveKey"],
  );

  const value: DeviceKey = { privateKey: pair.privateKey, publicKey: pair.publicKey };
  await idb("readwrite", (store) => store.put(value, KEY_ID));
  return value;
}

/** Whether this browser has ever registered. Cheap, and does not create one. */
export async function hasDeviceKey(): Promise<boolean> {
  if (!maybeRegistered()) return false;
  try {
    return (
      (await idb<DeviceKey | undefined>("readonly", (s) => s.get(KEY_ID))) !== undefined
    );
  } catch {
    return false;
  }
}

/**
 * A synchronous "has this browser ever registered" marker.
 *
 * `localStorage`, holding the string "1" and nothing else. Not a secret and not
 * a key — it reveals only that this browser registered a device, which is
 * already obvious from the fact that it unlocks without a passphrase.
 *
 * It exists because the alternative was opening IndexedDB in the app shell on
 * every page load, for every user, the overwhelming majority of whom have never
 * registered anything. That async work delayed hydration enough to be visible:
 * under a parallel test run seven specs across the suite began failing with
 * duplicated DOM while a page was still streaming. Doing nothing at all in the
 * common case is both the fix and the obviously right behaviour.
 */
const MARKER = "Porcupine.device";

export function maybeRegistered(): boolean {
  try {
    return globalThis.localStorage?.getItem(MARKER) === "1";
  } catch {
    // Storage can be denied outright. Falling back to trying is correct if
    // slower, rather than silently never restoring a session.
    return true;
  }
}

/** Forget this browser's key. Used when its server row is revoked. */
export async function forgetDeviceKey(): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(MARKER);
  } catch {
    // The marker is an optimisation; failing to clear it costs one wasted
    // IndexedDB read on the next load and nothing else.
  }
  await idb("readwrite", (store) => store.delete(KEY_ID));
}

/** Record that this browser now has a device row. Called after registering. */
export function markRegistered(): void {
  try {
    globalThis.localStorage?.setItem(MARKER, "1");
  } catch {
    // See `maybeRegistered`: without the marker the probe simply runs.
  }
}

export async function exportDevicePublicKey(key: DeviceKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("spki", key.publicKey));
}

/** ECDH + HKDF, both halves of every wrap. One function so they cannot drift. */
async function deriveAesKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "HKDF", hash: "SHA-256" } as unknown as AlgorithmIdentifier,
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      // Domain separation: this key is for wrapping a master key on a device
      // and nothing else, so a future use of the same ECDH pair cannot
      // accidentally derive the same bytes.
      info: new TextEncoder().encode("Porcupine/device-master-key/v1"),
    },
    shared,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Seal the master key to this device.
 *
 * Returns `ephemeralPublicKey ‖ iv ‖ ciphertext`. The ephemeral key is
 * generated here and dropped: only the device's own private half can derive
 * the same secret again.
 */
export async function wrapMasterKeyForDevice(
  masterKey: Uint8Array,
  device: DeviceKey,
): Promise<Uint8Array> {
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );

  const aes = await deriveAesKey(ephemeral.privateKey, device.publicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, new Uint8Array(masterKey)),
  );
  const ephemeralPub = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeral.publicKey),
  );

  const out = new Uint8Array(2 + ephemeralPub.length + iv.length + ciphertext.length);
  new DataView(out.buffer).setUint16(0, ephemeralPub.length, false);
  out.set(ephemeralPub, 2);
  out.set(iv, 2 + ephemeralPub.length);
  out.set(ciphertext, 2 + ephemeralPub.length + iv.length);
  return out;
}

export async function unwrapMasterKeyFromDevice(
  wrapped: Uint8Array,
  device: DeviceKey,
): Promise<Uint8Array> {
  const view = new DataView(wrapped.buffer, wrapped.byteOffset, wrapped.byteLength);
  const pubLen = view.getUint16(0, false);

  // Length-checked before slicing, for the same reason the identity bundle is:
  // a truncated blob otherwise fails as an AEAD error that blames the wrong
  // thing.
  if (wrapped.length < 2 + pubLen + 12 + 16) {
    throw new Error("This device wrap is malformed.");
  }

  // Copied, not `subarray`. TypeScript distinguishes an ArrayBuffer-backed
  // view from one over an ArrayBufferLike, and WebCrypto wants the former —
  // but the copy is worth having anyway: it hands the crypto layer bytes that
  // cannot be mutated underneath it by anything still holding the original.
  const ephemeralPub = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(wrapped.subarray(2, 2 + pubLen)),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const aes = await deriveAesKey(device.privateKey, ephemeralPub);
  const iv = new Uint8Array(wrapped.subarray(2 + pubLen, 2 + pubLen + 12));
  const ciphertext = new Uint8Array(wrapped.subarray(2 + pubLen + 12));

  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, ciphertext),
    );
  } catch {
    throw new Error("This device cannot open that master key.");
  }
}
