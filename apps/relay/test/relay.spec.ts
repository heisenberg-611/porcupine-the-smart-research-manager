import { spawn, type ChildProcess } from "node:child_process";

import {
  importSigningKey,
  signRelayTicket,
  type ClientMessage,
  type ServerMessage,
} from "@porcupine/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

/**
 * R-21 acceptance criteria (docs/05-resolution-plan.md).
 *
 * Runs against a real `wrangler dev` — workerd, real Durable Objects, real
 * WebSockets. An in-process mock would prove nothing about the thing that is
 * actually uncertain, which is whether the DO model holds up under
 * concurrent editing and restarts.
 */

const PORT = 8788;
const BASE = `ws://127.0.0.1:${PORT}`;
const FILE_ID = "3f1a7c1e-4b6d-4c2a-9f8e-2b7d5a1c0e93";
const PROJECT_ID = "9c2e1a44-77bb-4d31-8f10-52a3c6b7d8e1";

let signingKey: CryptoKey;
let wrangler: ChildProcess;

/** Generates the keypair the relay will trust for this run. */
async function makeKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  // exportKey is typed as returning ArrayBuffer | JsonWebKey; "pkcs8" and
  // "raw" always yield the former.
  const pkcs8 = new Uint8Array(
    (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer,
  );
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );

  const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

  return { privateKey: b64url(pkcs8), publicKey: b64url(raw) };
}

async function ticket(
  overrides: Partial<{
    fileId: string;
    userId: string;
    projectId: string;
    docEpoch: number;
    now: number;
  }> = {},
) {
  return signRelayTicket(
    {
      fileId: overrides.fileId ?? FILE_ID,
      userId: overrides.userId ?? "user-a",
      projectId: overrides.projectId ?? PROJECT_ID,
      docEpoch: overrides.docEpoch ?? 1,
    },
    signingKey,
    overrides.now,
  );
}

/** A connected client with a message queue and helpers. */
class Client {
  readonly received: ServerMessage[] = [];
  private readonly waiters: Array<(m: ServerMessage) => void> = [];

  private constructor(readonly ws: WebSocket) {}

  static async connect(token: string, fileId = FILE_ID): Promise<Client> {
    const ws = new WebSocket(`${BASE}/doc/${fileId}?ticket=${encodeURIComponent(token)}`);
    const client = new Client(ws);

    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      const waiter = client.waiters.shift();
      if (waiter) waiter(msg);
      else client.received.push(msg);
    });

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return client;
  }

  send(msg: ClientMessage) {
    this.ws.send(JSON.stringify(msg));
  }

  next(timeoutMs = 5000): Promise<ServerMessage> {
    const queued = this.received.shift();
    if (queued) return Promise.resolve(queued);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for message")),
        timeoutMs,
      );
      this.waiters.push((m) => {
        clearTimeout(timer);
        resolve(m);
      });
    });
  }

  close() {
    this.ws.close();
  }
}

/** Attempts a connection and resolves with the HTTP status on rejection. */
function expectRejection(token: string, fileId = FILE_ID): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}/doc/${fileId}?ticket=${encodeURIComponent(token)}`);
    ws.once("unexpected-response", (_req, res) => {
      ws.terminate();
      resolve(res.statusCode ?? 0);
    });
    ws.once("open", () => {
      ws.close();
      reject(new Error("connection was accepted but should have been rejected"));
    });
    ws.once("error", (err) => {
      if (!/Unexpected server response/.test(err.message)) reject(err);
    });
  });
}

beforeAll(async () => {
  const keys = await makeKeys();
  signingKey = await importSigningKey(keys.privateKey);

  wrangler = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      String(PORT),
      "--local",
      "--var",
      `RELAY_PUBLIC_KEY:${keys.publicKey}`,
      "--var",
      "ALLOWED_ORIGINS:http://127.0.0.1:3000",
    ],
    { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" },
  );

  // Wait for the health endpoint rather than sleeping a fixed interval.
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("wrangler dev did not start");
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) break;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}, 120_000);

afterAll(() => {
  wrangler?.kill("SIGTERM");
});

describe("ticket authorization", () => {
  it("rejects an upgrade with no ticket", async () => {
    // Node's fetch refuses to send an Upgrade header, so this has to go
    // through a real socket.
    expect(await expectRejection("")).toBe(401);
  });

  it("refuses a plain GET that is not an upgrade", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/doc/${FILE_ID}`);
    expect(res.status).toBe(426);
  });

  it("serves health without a ticket", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    expect(res.status).toBe(200);
  });

  it("rejects a forged signature", async () => {
    const valid = await ticket();
    const parts = valid.split(".");

    // Flip a bit in the decoded signature, not in its base64url text.
    //
    // Editing the last character does not reliably forge anything: a 64-byte
    // signature is 512 bits but 86 base64url characters carry 516, so the
    // final character holds 2 meaningful bits and 4 of padding. Real
    // signatures therefore end only in A, Q, g or w, and swapping a trailing
    // "A" for "B" changes nothing but padding — it decodes to identical
    // bytes, the signature verifies, and the test fails about one run in four.
    const sig = Buffer.from(parts[2]!, "base64url");
    sig[0] ^= 0x01;
    const tampered = `${parts[0]}.${parts[1]}.${sig.toString("base64url")}`;

    expect(await expectRejection(tampered)).toBe(401);
  });

  it("rejects a ticket whose payload was edited after signing", async () => {
    const valid = await ticket({ userId: "user-a" });
    const parts = valid.split(".");
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as Record<
      string,
      unknown
    >;
    payload.userId = "user-admin";
    const forged = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[2]}`;

    expect(await expectRejection(forged)).toBe(401);
  });

  it("rejects an expired ticket", async () => {
    const stale = await ticket({ now: Math.floor(Date.now() / 1000) - 3600 });
    expect(await expectRejection(stale)).toBe(401);
  });

  it("rejects a ticket minted for a different file", async () => {
    // Cryptographically valid, but bound elsewhere — the attack the binding
    // exists to stop.
    const other = "11111111-2222-3333-4444-555555555555";
    const wrongFile = await ticket({ fileId: other });
    expect(await expectRejection(wrongFile, FILE_ID)).toBe(401);
  });

  it("accepts a well-formed ticket", async () => {
    const client = await Client.connect(await ticket());
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    client.close();
  });
});

describe("collaboration", () => {
  it("fans out awareness to peers but not the sender", async () => {
    const [a, b, c] = await Promise.all([
      Client.connect(await ticket({ userId: "a" })),
      Client.connect(await ticket({ userId: "b" })),
      Client.connect(await ticket({ userId: "c" })),
    ]);

    a.send({ t: "awareness", d: "cursor-payload" });

    const fromB = await b.next();
    const fromC = await c.next();
    expect(fromB).toMatchObject({ t: "awareness", d: "cursor-payload", from: "a" });
    expect(fromC).toMatchObject({ t: "awareness", from: "a" });

    // The sender already knows where its own cursor is.
    expect(a.received).toHaveLength(0);

    [a, b, c].forEach((x) => x.close());
  });

  it("persists updates and replays them to a late joiner", async () => {
    const a = await Client.connect(await ticket({ userId: "a" }));
    a.send({ t: "update", d: "op-1", epoch: 1 });
    a.send({ t: "update", d: "op-2", epoch: 1 });
    await new Promise((r) => setTimeout(r, 300));

    const late = await Client.connect(await ticket({ userId: "late" }));
    late.send({ t: "sync", since: 0 });

    const seen: string[] = [];
    for (;;) {
      const msg = await late.next();
      if (msg.t === "synced") break;
      if (msg.t === "update") seen.push(msg.d);
    }

    expect(seen).toContain("op-1");
    expect(seen).toContain("op-2");

    a.close();
    late.close();
  });

  it("rejects an update from a stale epoch (ADR-021)", async () => {
    // A client that was offline across a pull. Its ops must not interleave —
    // they go through Git as a branch instead.
    const stale = await Client.connect(await ticket({ userId: "offline", docEpoch: 0 }));

    // It is told on connect that its epoch is behind.
    const greeting = await stale.next();
    expect(greeting).toMatchObject({ t: "epoch-stale" });

    stale.send({ t: "update", d: "stale-op", epoch: 0 });
    const rejection = await stale.next();
    expect(rejection).toMatchObject({ t: "epoch-stale", current: 1 });

    // And the op was not stored: a fresh client syncing from 0 never sees it.
    const fresh = await Client.connect(await ticket({ userId: "fresh" }));
    fresh.send({ t: "sync", since: 0 });
    const seen: string[] = [];
    for (;;) {
      const msg = await fresh.next();
      if (msg.t === "synced") break;
      if (msg.t === "update") seen.push(msg.d);
    }
    expect(seen).not.toContain("stale-op");

    stale.close();
    fresh.close();
  });
});

describe("latency budget", () => {
  it("keeps p95 remote echo under 150ms with four concurrent editors", async () => {
    const clients = await Promise.all(
      ["a", "b", "c", "d"].map(async (u) => Client.connect(await ticket({ userId: u }))),
    );
    const [sender, ...receivers] = clients as [Client, ...Client[]];

    const samples: number[] = [];
    const ROUNDS = 120;

    for (let i = 0; i < ROUNDS; i++) {
      const started = performance.now();
      sender.send({ t: "awareness", d: `tick-${i}` });
      await Promise.all(receivers.map((r) => r.next(5000)));
      samples.push(performance.now() - started);
    }

    samples.sort((x, y) => x - y);
    const p50 = samples[Math.floor(samples.length * 0.5)]!;
    const p95 = samples[Math.floor(samples.length * 0.95)]!;

    console.log(
      `  fan-out latency over ${ROUNDS} rounds — p50 ${p50.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms`,
    );

    expect(p95).toBeLessThan(150);
    clients.forEach((c) => c.close());
  }, 60_000);
});

describe("durability", () => {
  it("loses no content when every client disconnects and returns", async () => {
    const a = await Client.connect(await ticket({ userId: "a" }));
    a.send({ t: "update", d: "before-restart", epoch: 1 });
    await new Promise((r) => setTimeout(r, 300));
    a.close();

    // All sockets gone: the DO is eligible for eviction. On reconnect the
    // client re-syncs from its last known sequence, which is what makes a
    // restart transparent to Yjs (hazard B-08).
    await new Promise((r) => setTimeout(r, 1000));

    const back = await Client.connect(await ticket({ userId: "a" }));
    back.send({ t: "sync", since: 0 });

    const seen: string[] = [];
    for (;;) {
      const msg = await back.next();
      if (msg.t === "synced") break;
      if (msg.t === "update") seen.push(msg.d);
    }

    expect(seen).toContain("before-restart");
    back.close();
  }, 30_000);
});
