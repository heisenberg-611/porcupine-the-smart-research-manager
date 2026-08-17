import "server-only";

import { importSigningKey, signRelayTicket } from "@Porcupine/shared";

/**
 * Mints relay tickets (ADR-020).
 *
 * This is the half of the handshake that owns the database. The relay never
 * queries Supabase; it trusts a ticket only because this code checked
 * membership before signing one.
 *
 * The private key exists only here. Never expose it, never ship it to the
 * browser, and never hand a ticket to a client that has not passed
 * `is_project_member` — a valid ticket is full read/write access to a
 * document's op stream for its lifetime.
 */

let cached: { raw: string; key: CryptoKey } | null = null;

async function signingKey(): Promise<CryptoKey> {
  const raw = process.env.RELAY_PRIVATE_KEY;
  if (!raw) throw new Error("RELAY_PRIVATE_KEY is not set");
  if (cached?.raw === raw) return cached.key;
  const key = await importSigningKey(raw);
  cached = { raw, key };
  return key;
}

export interface MintTicketArgs {
  fileId: string;
  userId: string;
  projectId: string;
  docEpoch: number;
}

/**
 * Signs a 60-second ticket bound to one file.
 *
 * Callers MUST have verified project membership first. This function
 * deliberately performs no authorization of its own: a helper that
 * sometimes checks and sometimes doesn't is worse than one that never does,
 * because the caller stops thinking about it.
 */
export async function mintRelayTicket(args: MintTicketArgs): Promise<string> {
  return signRelayTicket(args, await signingKey());
}

/** The URL a client should open, ticket included. */
export function relayUrl(fileId: string, ticket: string): string {
  const base = process.env.NEXT_PUBLIC_RELAY_URL;
  if (!base) throw new Error("NEXT_PUBLIC_RELAY_URL is not set");
  return `${base}/doc/${fileId}?ticket=${encodeURIComponent(ticket)}`;
}
