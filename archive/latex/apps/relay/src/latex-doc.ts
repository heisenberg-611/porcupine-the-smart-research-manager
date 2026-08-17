import type { ClientMessage, ServerMessage } from "@Porcupine/shared";

interface Attachment {
  userId: string;
  epoch: number;
}

/**
 * One Durable Object per LaTeX file.
 *
 * It is a relay and an append-only log, and deliberately nothing more. It
 * cannot decrypt Yjs operations — LaTeX sources are E2EE — so it performs no
 * CRDT merge, no parsing, and no conflict resolution. Every payload is an
 * opaque base64 blob.
 *
 * Two channels:
 *   • awareness — cursors and selections. Fanned out, never stored. Dropped
 *     on hibernation, which is correct: presence has no history.
 *   • update    — encrypted Yjs ops. Appended to SQLite, replayed to late
 *     joiners, and rejected outright if the epoch does not match (ADR-021).
 *
 * WebSocket Hibernation is what makes idle documents free: the object is
 * evicted from memory while sockets stay open, and `state.getWebSockets()`
 * plus the serialized attachment restores context on wake.
 */
export class LatexDoc implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly sql: SqlStorage;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.sql = state.storage.sql;

    // blockConcurrencyWhile keeps requests queued until the schema exists,
    // so a cold start cannot race the first insert.
    void state.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS updates (
          seq   INTEGER PRIMARY KEY AUTOINCREMENT,
          epoch INTEGER NOT NULL,
          author TEXT   NOT NULL,
          data  TEXT    NOT NULL,
          ts    INTEGER NOT NULL
        );
      `);
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL
        );
      `);
    });
  }

  /** Current document epoch. Bumped only by a completed pull (ADR-021). */
  private currentEpoch(): number {
    const rows = [...this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k='epoch'")];
    return rows.length > 0 ? Number(rows[0]!.v) : 0;
  }

  private setEpoch(epoch: number): void {
    this.sql.exec(
      "INSERT INTO meta (k, v) VALUES ('epoch', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      String(epoch),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get("X-Claim-User") ?? "";
    const ticketEpoch = Number(request.headers.get("X-Claim-Epoch") ?? "0");

    // First connection defines the epoch; afterwards the stored value wins.
    const stored = this.currentEpoch();
    if (stored === 0 && ticketEpoch > 0) this.setEpoch(ticketEpoch);
    const epoch = this.currentEpoch() || ticketEpoch;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // acceptWebSocket (not server.accept()) is what enables hibernation.
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ userId, epoch: ticketEpoch } satisfies Attachment);

    if (ticketEpoch !== epoch) {
      // A client arriving with a stale epoch has been offline across a pull.
      // It must not send ops — its work goes through Git as a branch instead.
      this.send(server, { t: "epoch-stale", current: epoch });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) {
      this.send(ws, { t: "error", reason: "no_attachment" });
      return;
    }

    if (typeof raw !== "string") {
      this.send(ws, { t: "error", reason: "binary_unsupported" });
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send(ws, { t: "error", reason: "bad_json" });
      return;
    }

    switch (msg.t) {
      case "awareness":
        // Ephemeral: fan out, never store. This is the high-frequency channel
        // and the reason Supabase Realtime was the wrong shape (R-21).
        this.broadcast({ t: "awareness", d: msg.d, from: attachment.userId }, ws);
        return;

      case "update": {
        const epoch = this.currentEpoch();
        if (msg.epoch !== epoch) {
          // ADR-021: Yjs ops are valid only within their epoch. Rejecting here
          // is what makes a stale client's operations unreachable rather than
          // silently interleaved.
          this.send(ws, { t: "epoch-stale", current: epoch });
          return;
        }

        const cursor = this.sql.exec<{ seq: number }>(
          "INSERT INTO updates (epoch, author, data, ts) VALUES (?, ?, ?, ?) RETURNING seq",
          epoch,
          attachment.userId,
          msg.d,
          Date.now(),
        );
        const seq = [...cursor][0]!.seq;

        this.broadcast({ t: "update", d: msg.d, seq, from: attachment.userId }, ws);
        return;
      }

      case "sync": {
        // Replay for a late joiner or a client that reconnected after the DO
        // restarted. This is why a DO eviction is transparent to Yjs.
        const epoch = this.currentEpoch();
        const rows = this.sql.exec<{ seq: number; data: string; author: string }>(
          "SELECT seq, data, author FROM updates WHERE epoch = ? AND seq > ? ORDER BY seq",
          epoch,
          msg.since,
        );

        let last = msg.since;
        for (const row of rows) {
          this.send(ws, {
            t: "update",
            d: row.data,
            seq: row.seq,
            from: row.author,
          });
          last = row.seq;
        }
        this.send(ws, { t: "synced", seq: last });
        return;
      }

      default:
        this.send(ws, { t: "error", reason: "unknown_type" });
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    // 1006 is an abnormal close; calling close() again on it throws.
    if (code !== 1006) {
      try {
        ws.close(code, "closing");
      } catch {
        // Already closed. Nothing to do.
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket died between selection and send. The close handler cleans up.
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    const payload = JSON.stringify(msg);
    // getWebSockets() survives hibernation — this is the list, not an
    // in-memory Set that would be empty after eviction.
    for (const socket of this.state.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(payload);
      } catch {
        // Ignore; the close handler will remove it.
      }
    }
  }
}
