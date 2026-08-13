import sodium from "libsodium-wrappers-sumo";

import { initCrypto } from "./identity";

/**
 * Binary ⇄ base64 for transport. Server actions serialize arguments, and a
 * Uint8Array does not survive that intact, so keys cross the boundary as
 * base64 and are converted back to `bytea` server-side.
 */
export async function toBase64(bytes: Uint8Array): Promise<string> {
  await initCrypto();
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export async function fromBase64(value: string): Promise<Uint8Array> {
  await initCrypto();
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}
