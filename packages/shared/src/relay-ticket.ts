/**
 * Relay tickets (ADR-020).
 *
 * The collaboration relay holds **no database credentials** and never talks to
 * Supabase. Instead, Vercel performs the `is_project_member()` check and mints
 * a short-lived Ed25519-signed ticket; the relay verifies the signature
 * against a public key in its environment and checks the binding.
 *
 * Asymmetric on purpose. With an HMAC the relay would hold a key capable of
 * *minting* tickets, so compromising the relay would mean forging access to
 * any document. With Ed25519 the relay can only verify, and a full compromise
 * yields nothing beyond the ciphertext it was already shuffling.
 *
 * Uses Web Crypto only, so the same code runs on Node 24 and on workerd.
 */

/** Ticket lifetime. Long enough to open a socket, short enough to be useless if leaked. */
export const TICKET_TTL_SECONDS = 60;

export interface RelayTicketClaims {
  /** The LaTeX file this ticket authorizes. Bound — a ticket is not portable. */
  fileId: string;
  /** Who is connecting. Used for awareness attribution and audit. */
  userId: string;
  /** Project the file belongs to, for logging and rate limiting. */
  projectId: string;
  /**
   * ADR-021. The relay refuses updates whose epoch differs, which is what
   * makes a stale offline client's ops unreachable rather than merely wrong.
   */
  docEpoch: number;
  /** Seconds since epoch. */
  exp: number;
  /** Seconds since epoch. Guards against a clock-skewed future ticket. */
  iat: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const HEADER = b64urlEncode(enc.encode(JSON.stringify({ alg: "EdDSA", typ: "PCP" })));

export async function importSigningKey(pkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    b64urlDecode(pkcs8Base64).buffer as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

export async function importVerifyingKey(rawBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    b64urlDecode(rawBase64).buffer as ArrayBuffer,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

/** Mints a ticket. Server-side on Vercel only — never in the browser. */
export async function signRelayTicket(
  claims: Omit<RelayTicketClaims, "exp" | "iat">,
  privateKey: CryptoKey,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: RelayTicketClaims = {
    ...claims,
    iat: now,
    exp: now + TICKET_TTL_SECONDS,
  };

  const body = `${HEADER}.${b64urlEncode(enc.encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    enc.encode(body),
  );

  return `${body}.${b64urlEncode(new Uint8Array(signature))}`;
}

export type TicketVerification =
  { ok: true; claims: RelayTicketClaims } | { ok: false; reason: string };

/**
 * Verifies a ticket and checks it is bound to the file being opened.
 *
 * `expectedFileId` is not optional. A ticket that verifies cryptographically
 * but was minted for a different document is exactly the attack this binding
 * exists to stop, and making the check optional invites forgetting it.
 */
export async function verifyRelayTicket(
  token: string,
  publicKey: CryptoKey,
  expectedFileId: string,
  now = Math.floor(Date.now() / 1000),
): Promise<TicketVerification> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  const [header, payload, signature] = parts as [string, string, string];
  if (header !== HEADER) return { ok: false, reason: "bad_header" };

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      b64urlDecode(signature).buffer as ArrayBuffer,
      enc.encode(`${header}.${payload}`),
    );
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  let claims: RelayTicketClaims;
  try {
    claims = JSON.parse(dec.decode(b64urlDecode(payload))) as RelayTicketClaims;
  } catch {
    return { ok: false, reason: "bad_payload" };
  }

  if (typeof claims.exp !== "number" || claims.exp <= now) {
    return { ok: false, reason: "expired" };
  }
  // A ticket issued in the future means clock skew or a forged payload.
  // 30s of tolerance covers the former without meaningfully helping the latter.
  if (typeof claims.iat !== "number" || claims.iat > now + 30) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (claims.fileId !== expectedFileId) {
    return { ok: false, reason: "wrong_file" };
  }
  if (typeof claims.docEpoch !== "number" || claims.docEpoch < 0) {
    return { ok: false, reason: "bad_epoch" };
  }

  return { ok: true, claims };
}

// ── Wire protocol ───────────────────────────────────────────────────────────
//
// Two channels on one socket. Awareness is ephemeral and dropped on hibernate;
// updates are persisted and replayed to late joiners. Keeping them distinct is
// what stops cursor traffic from bloating document history.

export type ClientMessage =
  | { t: "awareness"; d: string }
  | { t: "update"; d: string; epoch: number }
  | { t: "sync"; since: number };

export type ServerMessage =
  | { t: "awareness"; d: string; from: string }
  | { t: "update"; d: string; seq: number; from: string }
  | { t: "synced"; seq: number }
  | { t: "epoch-stale"; current: number }
  | { t: "error"; reason: string };
