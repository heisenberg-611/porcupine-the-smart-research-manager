import { verifyRelayTicket, importVerifyingKey } from "@porcupine/shared";

import { LatexDoc } from "./latex-doc";

export { LatexDoc };

export interface Env {
  LATEX_DOC: DurableObjectNamespace;
  RELAY_PUBLIC_KEY: string;
  ALLOWED_ORIGINS: string;
}

/**
 * Porcupine collaboration relay (ADR-020).
 *
 * Vercel cannot hold an inbound WebSocket, so this Worker does — and nothing
 * else. It hosts no application, renders no pages, and holds no database
 * credentials. Because LaTeX sources are E2EE it also cannot decrypt anything
 * passing through it: every payload is opaque ciphertext, which is why a
 * relay compromise yields nothing and why its CPU cost per message is
 * negligible enough to fit the free tier.
 *
 *   GET /doc/:fileId?ticket=<ed25519-jwt>   → WebSocket upgrade
 *   GET /health                             → liveness
 */

// Importing the key is a few hundred microseconds, but it happens on every
// connection, so cache it per isolate.
let cachedKey: { raw: string; key: CryptoKey } | null = null;

async function verifyingKey(env: Env): Promise<CryptoKey> {
  if (cachedKey?.raw === env.RELAY_PUBLIC_KEY) return cachedKey.key;
  const key = await importVerifyingKey(env.RELAY_PUBLIC_KEY);
  cachedKey = { raw: env.RELAY_PUBLIC_KEY, key };
  return key;
}

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  // Non-browser clients (the test harness) send no Origin. The ticket is the
  // real authorization; this check only blocks drive-by browser connections
  // from other sites.
  if (!origin) return true;
  return env.ALLOWED_ORIGINS.split(",")
    .map((o) => o.trim())
    .includes(origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    const match = /^\/doc\/([0-9a-fA-F-]{36})$/.exec(url.pathname);
    if (!match) return new Response("Not found", { status: 404 });

    const fileId = match[1]!;

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    if (!originAllowed(request, env)) {
      return new Response("Origin not allowed", { status: 403 });
    }
    if (!env.RELAY_PUBLIC_KEY) {
      // Fail closed. A relay with no key configured must reject everything
      // rather than fall back to trusting the ticket payload.
      return new Response("Relay not configured", { status: 503 });
    }

    const ticket = url.searchParams.get("ticket");
    if (!ticket) return new Response("Missing ticket", { status: 401 });

    const verification = await verifyRelayTicket(ticket, await verifyingKey(env), fileId);

    if (!verification.ok) {
      // The reason goes in a header for debugging, never in the body — the
      // body is what a curious browser console displays.
      return new Response("Unauthorized", {
        status: 401,
        headers: { "X-Relay-Reject": verification.reason },
      });
    }

    // idFromName maps a file to exactly one actor, globally. That single
    // coordination point is the entire reason for using a Durable Object
    // rather than a fan-out broadcast service.
    const id = env.LATEX_DOC.idFromName(fileId);
    const stub = env.LATEX_DOC.get(id);

    // Claims travel to the DO in headers, already verified. The DO trusts
    // them because nothing else can reach it.
    const forwarded = new Request(request.url, request);
    forwarded.headers.set("X-Claim-User", verification.claims.userId);
    forwarded.headers.set("X-Claim-Project", verification.claims.projectId);
    forwarded.headers.set("X-Claim-Epoch", String(verification.claims.docEpoch));

    return stub.fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
