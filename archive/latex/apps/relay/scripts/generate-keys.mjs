#!/usr/bin/env node
/**
 * Generates the Ed25519 keypair for relay tickets (ADR-020).
 *
 *   node apps/relay/scripts/generate-keys.mjs
 *
 * The private key goes to Vercel (RELAY_PRIVATE_KEY) and signs tickets.
 * The public key goes to Cloudflare (RELAY_PUBLIC_KEY) and only verifies
 * them — which is the point of using an asymmetric scheme. A compromised
 * relay cannot mint access to anything.
 *
 * Generate a distinct pair per environment. Rotating is safe: tickets live
 * 60 seconds, so deploy the new public key, then the new private key, and
 * the overlap costs at most one minute of failed connections.
 */
const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]);

const b64url = (buf) => Buffer.from(new Uint8Array(buf)).toString("base64url");

const privateKey = b64url(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
const publicKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));

console.log(`
# ── Vercel (signs tickets — SECRET) ──────────────────────────────────────
RELAY_PRIVATE_KEY="${privateKey}"

# ── Cloudflare relay (verifies only — safe to expose) ────────────────────
# wrangler secret put RELAY_PUBLIC_KEY
${publicKey}
`);
