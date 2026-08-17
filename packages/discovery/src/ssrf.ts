/**
 * SSRF-safe outbound fetch.
 *
 * Users paste URLs and the server fetches them — DOI resolution, OA PDF
 * retrieval, Zotero import. That makes this the highest-risk server surface
 * in the product.
 *
 * These controls are LOAD-BEARING, not defence-in-depth. Under ADR-011 the
 * app ran on workerd, which egressed through Cloudflare's edge with no VPC
 * and no cloud metadata endpoint, so the `169.254.169.254` credential-theft
 * class did not exist at all. ADR-019 moved hosting to Vercel, which runs on
 * AWS Lambda, where that endpoint does exist. The move was right for many
 * other reasons, but it gave back this specific mitigation and these checks
 * are now the only thing standing in its place. See docs/02-security-and-e2ee.md §7.
 *
 * Two attacks drive the design:
 *
 *   1. DNS rebinding — a hostname that looks fine resolves to 169.254.169.254.
 *      Checking the hostname string is useless; the resolved ADDRESS is what
 *      matters, so we resolve first and check every address returned.
 *
 *   2. Redirect-to-metadata — a public URL 302s to a private one. Checking
 *      only the first URL misses it, so redirects are followed manually and
 *      every hop is revalidated.
 *
 * Both are closed: addresses are validated before connecting, and the
 * connection is PINNED to a validated address so DNS cannot be consulted a
 * second time. Residual risk is listed at SSRF_KNOWN_GAPS at the bottom.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

export interface SafeFetchOptions {
  /** Abandon the request after this long, redirects included. */
  timeoutMs?: number;
  /** Refuse a body larger than this. Applied while streaming, not after. */
  maxBytes?: number;
  /** How many redirects to follow before giving up. */
  maxRedirects?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 10 * 1024 * 1024,
  maxRedirects: 5,
} as const;

export class SsrfError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "SsrfError";
  }
}

// ── Address classification ───────────────────────────────────────────────────

/** Parse dotted-quad IPv4 into a 32-bit unsigned integer. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    // Reject "01", "1e2", "+1" and friends: Number() is far too permissive,
    // and a non-canonical form is a signal of evasion rather than a typo.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** CIDR blocks that must never be reachable from a user-supplied URL. */
const BLOCKED_V4: ReadonlyArray<readonly [string, number, string]> = [
  ["0.0.0.0", 8, "this network"],
  ["10.0.0.0", 8, "RFC1918 private"],
  ["100.64.0.0", 10, "CGNAT"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local — cloud metadata lives here"],
  ["172.16.0.0", 12, "RFC1918 private"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "TEST-NET-1"],
  ["192.168.0.0", 16, "RFC1918 private"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "TEST-NET-2"],
  ["203.0.113.0", 24, "TEST-NET-3"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
];

function classifyV4(ip: string): string | null {
  const value = ipv4ToInt(ip);
  if (value === null) return "unparseable IPv4 address";

  for (const [base, bits, label] of BLOCKED_V4) {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) continue;
    // A /0 mask would shift by 32, which is a no-op in JS. No entry uses it,
    // but the guard keeps that from becoming a silent hole if one is added.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((value & mask) >>> 0 === (baseInt & mask) >>> 0) return label;
  }
  return null;
}

function classifyV6(raw: string): string | null {
  const ip = raw.toLowerCase().split("%")[0] ?? raw.toLowerCase();

  if (ip === "::1") return "IPv6 loopback";
  if (ip === "::") return "IPv6 unspecified";

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: unwrap and apply the
  // IPv4 rules, or ::ffff:169.254.169.254 walks straight through.
  const mapped =
    /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip) ?? /^::(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) {
    const inner = classifyV4(mapped[1]);
    return inner ? `IPv4-mapped ${inner}` : null;
  }

  const head = parseInt(ip.split(":")[0] || "0", 16);

  // fc00::/7 unique-local, fe80::/10 link-local.
  if ((head & 0xfe00) === 0xfc00) return "IPv6 unique-local";
  if ((head & 0xffc0) === 0xfe80) return "IPv6 link-local";

  // 2002::/16 (6to4) and 64:ff9b::/96 (NAT64) both embed an IPv4 address,
  // and both are usable to reach a private one. We do not need either.
  if (head === 0x2002) return "6to4 (embeds an IPv4 address)";
  if (ip.startsWith("64:ff9b:")) return "NAT64 (embeds an IPv4 address)";

  return null;
}

/**
 * Returns a human-readable reason when an address must not be contacted, or
 * null when it is a normal public address.
 */
export function classifyAddress(ip: string): string | null {
  const version = isIP(ip);
  if (version === 4) return classifyV4(ip);
  if (version === 6) return classifyV6(ip);
  return "not an IP address";
}

// ── URL validation ───────────────────────────────────────────────────────────

/**
 * Resolve a URL's hostname and confirm every address it maps to is public.
 *
 * EVERY address is checked, not just the first: a hostname with both a public
 * and a private A record would otherwise pass validation and then connect to
 * whichever the resolver happened to hand the socket.
 */
export async function assertPublicUrl(input: string): Promise<URL> {
  return (await resolveAndValidate(input)).url;
}

/**
 * The same validation, but also returning the addresses it approved.
 *
 * `safeFetch` needs them: connecting to a validated ADDRESS rather than
 * re-resolving the name is what closes the rebinding window. See
 * `pinnedAgent`.
 */
export async function resolveAndValidate(
  input: string,
): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SsrfError("not a valid URL", input);
  }

  if (url.protocol !== "https:") {
    throw new SsrfError(`refusing ${url.protocol} — https only`, input);
  }

  // Credentials in a URL are only ever an attempt to smuggle something past
  // a naive parser, or to leak them to us. Neither is wanted.
  if (url.username || url.password) {
    throw new SsrfError("refusing a URL containing credentials", input);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");

  // A literal address needs no DNS, but needs the same check.
  if (isIP(host)) {
    const reason = classifyAddress(host);
    if (reason) throw new SsrfError(`refusing address ${host}: ${reason}`, input);
    return { url, addresses: [host] };
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new SsrfError(`could not resolve ${host}`, input);
  }

  if (addresses.length === 0) {
    throw new SsrfError(`${host} resolved to no addresses`, input);
  }

  for (const { address } of addresses) {
    const reason = classifyAddress(address);
    if (reason) {
      throw new SsrfError(`${host} resolves to ${address}: ${reason}`, input);
    }
  }

  return { url, addresses: addresses.map((a) => a.address) };
}

// ── Pinning the validated address ────────────────────────────────────────────

/**
 * A dispatcher that connects to `address` and refuses to consult DNS again.
 *
 * This is what closes the rebinding window. Without it the sequence is:
 *
 *   1. we resolve example.com   -> 93.184.216.34   (public, allowed)
 *   2. fetch resolves it again  -> 169.254.169.254 (attacker swapped it)
 *
 * The validation in step 1 is then worthless, because nothing connects to
 * what it checked. Overriding `lookup` makes the socket go to the address we
 * actually approved.
 *
 * The Host header and TLS SNI still carry the original hostname, because the
 * URL is unchanged — so certificate verification is unaffected and virtual
 * hosts still resolve correctly. Only the IP is pinned.
 */
function pinnedAgent(addresses: readonly string[]): Agent {
  const targets = orderedTargets(addresses);

  return new Agent({
    connect: {
      // Node's LookupFunction is overloaded on `options.all`, and the two
      // shapes cannot both be expressed in one implementation signature.
      // The cast is confined to this one function.
      lookup: ((
        _hostname: string,
        options: { all?: boolean },
        callback: (
          err: Error | null,
          address: string | Array<{ address: string; family: number }>,
          family?: number,
        ) => void,
      ) => {
        const first = targets[0];
        if (!first) {
          // Unreachable via resolveAndValidate, which never returns an empty
          // or non-IP list. Reported rather than thrown: this runs inside a
          // socket callback, where a throw is an unhandled exception.
          callback(new Error("no validated address to connect to"), []);
          return;
        }
        // `all: true` is the shape Node asks for when autoSelectFamily is on
        // (the default since Node 20), and it is the one that matters: handing
        // back every validated address is what lets the socket fail over.
        if (options.all) callback(null, [...targets]);
        else callback(null, first.address, first.family);
      }) as never,
    },
  });
}

/**
 * Every validated address, IPv4 first.
 *
 * Two separate things, both learned the hard way when federated search started
 * reporting every provider as failed on a machine with no IPv6 route:
 *
 *   1. ALL of them. This used to pin to `addresses[0]` alone, which meant one
 *      unreachable address was a dead request even though DNS had handed us a
 *      working alternative. Passing the whole list restores Node's own
 *      connection failover (Happy Eyeballs). It costs nothing in safety —
 *      resolveAndValidate has already classified every address in this array,
 *      and an address absent from it can still never be connected to.
 *
 *   2. IPv4 FIRST. Happy Eyeballs races the families with a 250 ms head start,
 *      which recovers from a blackholed AAAA in a quarter of a second — but
 *      only when the stack actually attempts both. Leading with the reachable
 *      family means the common case never pays even that, and the ordering is
 *      the part that is cheap to be sure of.
 *
 * A non-IP string would sort to the front (isIP returns 0), so it is dropped
 * instead: it cannot be a validated address, and silently preferring it would
 * hand the socket something nothing checked.
 */
function orderedTargets(
  addresses: readonly string[],
): Array<{ address: string; family: number }> {
  return addresses
    .map((address) => ({ address, family: isIP(address) }))
    .filter((t) => t.family !== 0)
    .sort((a, b) => a.family - b.family);
}

// ── The fetch itself ─────────────────────────────────────────────────────────

/**
 * Fetch a user-influenced URL with every hop validated.
 *
 * Redirects are followed by hand (`redirect: "manual"`) because the built-in
 * follower validates nothing — one 302 to 169.254.169.254 and the checks
 * above would have been theatre.
 *
 * No ambient credentials are ever attached. If a caller passes an
 * Authorization header it is dropped at the first cross-origin redirect,
 * because a redirect can send it to a host that was never meant to see it.
 */
export async function safeFetch(
  input: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    let validated = await resolveAndValidate(input);
    let origin = validated.url.origin;
    let headers = { ...options.headers };

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const { url: current, addresses } = validated;

      // Connect to the addresses we just approved rather than re-resolving.
      const agent = pinnedAgent(addresses);

      try {
        const response = await undiciFetch(current.href, {
          redirect: "manual",
          signal: controller.signal,
          dispatcher: agent,
          headers: {
            // Identify ourselves. OpenAlex and Crossref give a faster "polite
            // pool" to requests that do, and it is basic courtesy to free APIs.
            "user-agent": userAgent(),
            accept: "application/json",
            ...headers,
          },
        });

        const location = response.headers.get("location");
        const isRedirect = response.status >= 300 && response.status <= 399 && location;

        if (!isRedirect) {
          // Body is buffered here, while the agent is still open.
          return await enforceSize(response, maxBytes, current.href);
        }

        // Nothing useful in a redirect body, and leaving it unread keeps the
        // socket from being held open by the pool we are about to destroy.
        await response.body?.cancel();

        validated = await resolveAndValidate(new URL(location, current).href);

        // Cross-origin: drop anything that could be a credential.
        if (validated.url.origin !== origin) {
          const { authorization: _a, cookie: _c, ...rest } = lowercaseKeys(headers);
          headers = rest;
          origin = validated.url.origin;
        }
      } finally {
        // One agent per hop; each is pinned to a different address.
        void agent.close().catch(() => {
          /* already torn down */
        });
      }
    }

    throw new SsrfError(`more than ${maxRedirects} redirects`, input);
  } finally {
    clearTimeout(timer);
  }
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
}

/**
 * Enforce the size cap while streaming.
 *
 * Content-Length is a claim, not a fact, so the body is counted as it arrives
 * and the connection is dropped the moment it goes over. Reading the whole
 * body and then measuring it is how a 10 GB response becomes an outage.
 */
async function enforceSize(
  response: UndiciResponse,
  maxBytes: number,
  url: string,
): Promise<Response> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel();
    throw new SsrfError(`response declares ${declared} bytes, cap is ${maxBytes}`, url);
  }

  if (!response.body) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers] as Array<[string, string]>,
    });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (; ;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      void reader.cancel();
      throw new SsrfError(`response exceeded ${maxBytes} bytes`, url);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  // Rebuilt as a platform Response so callers never see an undici type.
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers] as Array<[string, string]>,
  });
}

/**
 * The polite-pool identifier. OpenAlex and Crossref both ask for a contact
 * address and give faster service to requests that supply one.
 */
export function userAgent(): string {
  const contact = process.env.POLITE_POOL_EMAIL;
  return contact
    ? `Porcupine/0.1 (https://Porcupine.app; mailto:${contact})`
    : "Porcupine/0.1 (https://Porcupine.app)";
}

/**
 * Residual risk, kept current.
 *
 * The DNS-rebinding TOCTOU window that used to be listed here is CLOSED:
 * `safeFetch` connects through `pinnedAgent`, which overrides the socket's
 * `lookup` so the connection goes to the address that was validated rather
 * than to whatever DNS returns a second time. Every redirect hop is
 * revalidated and pinned independently.
 *
 * What remains, honestly:
 *
 *   * A host that is public at validation time and becomes attacker-controlled
 *     later is out of scope for any client-side control. That is a BGP or
 *     domain-hijack scenario, not an SSRF one.
 *
 *   * We do not pin the certificate. TLS verification still applies against
 *     the original hostname, so an attacker needs a valid certificate for the
 *     name — pinning would add little and break ordinary rotation.
 */
/** Exposed so a test can prove the pin actually redirects the socket. */
export const __testing = { pinnedAgent, orderedTargets };

/**
 * Empty, and the tests enforce that it stays honest rather than merely empty:
 * `ssrf.spec.ts` asserts no rebinding entry has reappeared, which would mean
 * the pin was removed.
 *
 * The failover gap that used to be listed here is closed — `pinnedAgent` now
 * hands the socket every validated address rather than the first.
 */
export const SSRF_KNOWN_GAPS: readonly string[] = [];
