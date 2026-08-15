"use client";

import { fromBase64, openMessage, sealMessage, toBase64 } from "@porcupine/crypto";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Banner, Button, Card, Field, Input } from "@/components/ui";
import { useCryptoSession } from "@/lib/crypto/session";
import { useProjectKeys } from "@/lib/crypto/use-project-keys";

import {
  createChannel,
  listChannels,
  listMessages,
  sendMessage,
  type ChannelRow,
} from "./actions";

interface OpenedChannel {
  id: string;
  name: string;
  epoch: number;
}

interface OpenedMessage {
  id: string;
  authorName: string;
  createdAt: string;
  /** Null when no key for its epoch is held — said, never rendered as blank. */
  text: string | null;
}

/**
 * The first conversation in the product, and the first thing to prove the
 * whole chain: unlock → master key → project key → message.
 *
 * Everything readable here is decrypted in this component. A message whose
 * epoch key is missing is shown AS missing rather than as an empty line: a
 * blank message and an unreadable one look identical, and only one of them is
 * a problem.
 */
export function MessagesClient({ projectId }: { projectId: string }) {
  const { unlocked } = useCryptoSession();
  const pathname = usePathname();
  const keys = useProjectKeys(projectId);

  const [channels, setChannels] = useState<OpenedChannel[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<OpenedMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [newChannel, setNewChannel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const currentKey = keys.byEpoch.get(keys.currentEpoch);

  const loadChannels = useCallback(async () => {
    if (keys.byEpoch.size === 0) return;

    const result = await listChannels(projectId);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const opened: OpenedChannel[] = [];
    for (const row of result.data as ChannelRow[]) {
      const key = keys.byEpoch.get(row.epoch);
      if (!key) continue;
      try {
        opened.push({
          id: row.id,
          epoch: row.epoch,
          name: await openMessage(await fromBase64(row.nameCt), key, {
            channelId: row.id,
            messageId: row.id,
            epoch: row.epoch,
          }),
        });
      } catch {
        opened.push({ id: row.id, epoch: row.epoch, name: "(unreadable)" });
      }
    }

    setChannels(opened);
    setSelected((current) => current ?? opened[0]?.id ?? null);
  }, [projectId, keys.byEpoch]);

  const loadMessages = useCallback(async () => {
    if (!selected || keys.byEpoch.size === 0) return;

    const result = await listMessages(projectId, selected);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    const opened: OpenedMessage[] = [];
    for (const row of result.data) {
      const key = keys.byEpoch.get(row.epoch);
      let text: string | null = null;
      if (key) {
        try {
          text = await openMessage(await fromBase64(row.ciphertext), key, {
            channelId: row.channelId,
            messageId: row.id,
            epoch: row.epoch,
          });
        } catch {
          text = null;
        }
      }
      opened.push({
        id: row.id,
        authorName: row.authorName,
        createdAt: row.createdAt,
        text,
      });
    }
    setMessages(opened);
  }, [projectId, selected, keys.byEpoch]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  /*
   * Refetch when the tab comes back to the front.
   *
   * There is no live delivery here, and that is a deliberate gap rather than
   * an oversight. Supabase Realtime bills per delivered message PER
   * SUBSCRIBER — the v6 replan found that and it is why presence and read
   * receipts were deferred on cost — so a socket held open per member per
   * channel is the most expensive thing this product could switch on. Polling
   * is the same bill in a different shape.
   *
   * Refocus plus an explicit Refresh covers the case that actually happens
   * (you were reading something else, you come back) without a subscription.
   * Live delivery arrives when someone has decided what it is worth.
   */
  useEffect(() => {
    const onFocus = () => void loadMessages();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadMessages]);

  async function addChannel(event: React.FormEvent) {
    event.preventDefault();
    if (!currentKey || newChannel.trim() === "") return;
    setPending(true);
    setError(null);

    try {
      // The id is minted here because it is authenticated inside the name's
      // own ciphertext. A database-assigned id could not be.
      const channelId = crypto.randomUUID();
      const nameCt = await sealMessage(newChannel.trim(), currentKey, {
        channelId,
        messageId: channelId,
        epoch: keys.currentEpoch,
      });

      const result = await createChannel({
        projectId,
        channelId,
        nameCt: await toBase64(nameCt),
        epoch: keys.currentEpoch,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setNewChannel("");
      setSelected(channelId);
      await loadChannels();
    } catch {
      setError("Could not create the channel.");
    } finally {
      setPending(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!currentKey || !selected || draft.trim() === "") return;
    setPending(true);
    setError(null);

    try {
      const messageId = crypto.randomUUID();
      const ciphertext = await sealMessage(draft.trim(), currentKey, {
        channelId: selected,
        messageId,
        epoch: keys.currentEpoch,
      });

      const result = await sendMessage({
        projectId,
        channelId: selected,
        messageId,
        epoch: keys.currentEpoch,
        ciphertext: await toBase64(ciphertext),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setDraft("");
      await loadMessages();
    } catch {
      setError("Could not send the message.");
    } finally {
      setPending(false);
    }
  }

  if (!unlocked) {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-ink text-ui">
          Messages are encrypted with a key only members hold. Unlock yours to read them.
        </p>
        <Link
          href={`/unlock?next=${encodeURIComponent(pathname ?? "/projects")}`}
          className="text-accent text-ui underline underline-offset-4"
        >
          Unlock your keys
        </Link>
      </Card>
    );
  }

  if (keys.loading) return <p className="text-muted text-ui">Opening your keys…</p>;

  if (keys.byEpoch.size === 0) {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-ink text-ui">
          This project has no content key yet, so there is nothing to encrypt messages
          with.
        </p>
        <Link
          href={`/projects/${projectId}/keys`}
          className="text-accent text-ui underline underline-offset-4"
        >
          Set up encryption
        </Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Banner tone="danger">{error}</Banner>}
      {keys.rejected > 0 && (
        <Banner tone="danger">
          {keys.rejected} project {keys.rejected === 1 ? "key" : "keys"} did not verify
          and {keys.rejected === 1 ? "was" : "were"} ignored. That should not happen —
          someone should look.
        </Banner>
      )}

      <form onSubmit={addChannel} className="flex flex-wrap items-end gap-2">
        <Field label="New channel" id="channel-name">
          <Input
            id="channel-name"
            value={newChannel}
            onChange={(e) => setNewChannel(e.target.value)}
            placeholder="screening-questions"
          />
        </Field>
        <Button type="submit" disabled={pending || newChannel.trim() === ""}>
          Create
        </Button>
      </form>

      {channels.length > 0 && (
        <nav aria-label="Channels" className="flex flex-wrap gap-2">
          {channels.map((channel) => (
            <Button
              key={channel.id}
              variant={channel.id === selected ? "primary" : "ghost"}
              className="border-border border"
              onClick={() => setSelected(channel.id)}
            >
              {channel.name}
            </Button>
          ))}
        </nav>
      )}

      {selected && (
        <>
          <ul className="border-border divide-border divide-y rounded-lg border">
            {messages.length === 0 && (
              <li className="text-muted text-ui p-4">Nothing said here yet.</li>
            )}
            {messages.map((message) => (
              <li key={message.id} className="p-4">
                <p className="text-muted text-fine">
                  {message.authorName} ·{" "}
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString()}
                  </time>
                </p>
                <p className="text-ink text-ui mt-1 text-pretty">
                  {message.text ?? (
                    // Never rendered as an empty line: a blank message and an
                    // unreadable one look identical, and only one is a problem.
                    <span className="text-muted italic">
                      Encrypted under a key you do not hold.
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>

          <form onSubmit={send} className="flex flex-wrap items-end gap-2">
            {/* Explicit, because nothing pushes. See the refocus effect above
                for why there is no subscription. */}
            <Field label="Message" id="message-body">
              <Input
                id="message-body"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="min-w-[18rem]"
              />
            </Field>
            <Button type="submit" disabled={pending || draft.trim() === ""}>
              Send
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="border-border border"
              onClick={() => void loadMessages()}
              disabled={pending}
            >
              Refresh
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
