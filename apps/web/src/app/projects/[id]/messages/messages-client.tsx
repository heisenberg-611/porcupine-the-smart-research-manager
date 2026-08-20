"use client";

import { fromBase64, openMessage, sealMessage, toBase64 } from "@Porcupine/crypto";
import { decodeMessage, encodeMessage } from "@Porcupine/shared";

// The same rule the PDF annotations use, so a person is one colour everywhere
// in the product rather than one colour per feature.
import { colourFor } from "@/lib/annotation-colour";
import { linkify } from "@/lib/linkify";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useProjectActivity } from "@/lib/use-project-activity";

import { InlineUnlock } from "@/components/inline-unlock";
import { SetUpEncryption } from "@/components/set-up-encryption";
import { Banner, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { useCryptoSession } from "@/lib/crypto/session";
import { useProjectKeys } from "@/lib/crypto/use-project-keys";

import { getKeyState, getMemberKeys, type KeylessMember } from "../keys/actions";
import {
  createChannel,
  deleteChannel,
  listChannels,
  clearReaction,
  listMessages,
  listReactions,
  setReaction,
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
  authorId: string;
  authorName: string;
  createdAt: string;
  /** Null when no key for its epoch is held — said, never rendered as blank. */
  text: string | null;
  /**
   * The message this answers, from INSIDE the ciphertext.
   *
   * Not a column: the server holding a reply graph would know which message
   * drew six answers and where an argument happened — the shape of the work,
   * legible without a plaintext word, which is the same half-claim the
   * encrypted channel name exists to refuse. See docs/14 §1.
   */
  replyTo?: string | undefined;
}

/** One person's reaction, after decryption. */
interface OpenedReaction {
  messageId: string;
  authorId: string;
  authorName: string;
  /** Null when sealed under an epoch key this reader does not hold. */
  emoji: string | null;
}

/** What the picker offers. Anything can be sent; these are the quick ones. */
const QUICK_REACTIONS = ["👍", "🎯", "❓", "⚠️", "🎉", "👀"] as const;

/** Consecutive messages from one person inside this window share a header. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

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
  const [reactions, setReactions] = useState<OpenedReaction[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  /** Members with no key for the current epoch — see the banner below. */
  const [keyless, setKeyless] = useState<KeylessMember[]>([]);
  const [draft, setDraft] = useState("");
  const [newChannel, setNewChannel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const logRef = useRef<HTMLUListElement>(null);
  /*
   * Tickets, so a slow fetch cannot overwrite a fast one that started later.
   *
   * Several things ask for a reload — sending, the realtime signal, focus,
   * the Refresh button — and nothing serialised them. Two overlapping calls
   * resolve in whatever order the network returns them, and the OLDER
   * snapshot, taken before the message was inserted, would win. The message
   * then stayed missing, because nothing triggers another load once the
   * signal has already fired.
   *
   * It was rare until reactions doubled the number of requests in flight, at
   * which point the full test suite reproduced it every run.
   */
  const messageLoad = useRef(0);
  const reactionLoad = useRef(0);
  /** Whose messages are "mine", and whose reaction the picker toggles. */
  const [me, setMe] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const currentKey = keys.byEpoch.get(keys.currentEpoch);

  useEffect(() => {
    void (async () => {
      const members = await getMemberKeys(projectId);
      if (members.ok) {
        const mine = members.data.find((m) => m.isMe);
        setMe(mine?.userId ?? null);
        setIsAdmin(mine?.accessRole === "OWNER" || mine?.accessRole === "ADMIN");
      }
    })();
  }, [projectId]);

  useEffect(() => {
    void (async () => {
      const state = await getKeyState(projectId);
      if (state.ok) setKeyless(state.data.keyless);
    })();
  }, [projectId, keys.currentEpoch, keys.byEpoch]);

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

    const ticket = ++messageLoad.current;
    const result = await listMessages(projectId, selected);
    if (ticket !== messageLoad.current) return;
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
      // The payload carries the reply link; a message from before the format
      // existed decodes as its own text. Neither needs a migration.
      const payload = text === null ? null : decodeMessage(text);

      // Checked again after the awaits above: decrypting a long channel takes
      // long enough for a newer load to have finished while this one worked.
      if (ticket !== messageLoad.current) return;

      opened.push({
        id: row.id,
        authorId: row.authorId,
        authorName: row.authorName,
        createdAt: row.createdAt,
        text: payload?.text ?? null,
        ...(payload?.replyTo ? { replyTo: payload.replyTo } : {}),
      });
    }
    setMessages(opened);
  }, [projectId, selected, keys.byEpoch]);

  const loadReactions = useCallback(async () => {
    if (!selected || keys.byEpoch.size === 0) return;

    const ticket = ++reactionLoad.current;
    const result = await listReactions(projectId, selected);
    if (ticket !== reactionLoad.current) return;
    if (!result.ok) return;

    const opened: OpenedReaction[] = [];
    for (const row of result.data) {
      const key = keys.byEpoch.get(row.epoch);
      let emoji: string | null = null;
      if (key) {
        try {
          emoji = await openMessage(await fromBase64(row.ciphertext), key, {
            channelId: selected,
            messageId: row.messageId,
            epoch: row.epoch,
          });
        } catch {
          emoji = null;
        }
      }
      if (ticket !== reactionLoad.current) return;

      opened.push({
        messageId: row.messageId,
        authorId: row.authorId,
        authorName: row.authorName,
        emoji,
      });
    }
    setReactions(opened);
  }, [projectId, selected, keys.byEpoch]);

  /*
   * Messages then reactions, in that order, never at the same time.
   *
   * Firing both server actions concurrently from one page is what broke the
   * refresh: several things ask for a reload — sending, the realtime signal,
   * focus, the button — and doubling the requests in flight made the full test
   * suite fail every run, with a refresh simply never landing.
   *
   * Sequential is also the honest order: reactions are drawn against messages,
   * so arriving first buys nothing.
   */
  const reload = useCallback(async () => {
    await loadMessages();
    await loadReactions();
  }, [loadMessages, loadReactions]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    setConfirmDelete(false);
    setReplyTo(null);
    void reload();
  }, [reload, selected]);

  /*
   * Escape closes the reaction picker, and so does clicking anywhere else.
   *
   * A menu you can only leave by choosing from it is a trap — and this one
   * appears on hover, so it is easy to open without meaning to.
   */
  useEffect(() => {
    if (!picking) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicking(null);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      // Not when the click is on the picker itself, or the reaction lands and
      // closes it in the same gesture.
      if (target?.closest("[data-reaction-picker]")) return;
      setPicking(null);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [picking]);

  /*
   * Stay at the newest message, unless the reader has gone looking.
   *
   * Jumping to the bottom while somebody is reading back through a
   * conversation is worse than not scrolling at all, so this only follows when
   * they were already near the end.
   */
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const distance = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (distance < 120) log.scrollTop = log.scrollHeight;
  }, [messages]);

  /*
   * Refetch when the tab comes back to the front.
   *
   * Kept alongside the subscription below rather than replaced by it: the
   * realtime container is optional — CI runs without it — and coming back to
   * a tab is the case that has to work everywhere.
   */
  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  /*
   * And live, now, at a cost that was worth paying.
   *
   * This was deliberately absent, and the reason was money: Supabase Realtime
   * bills per delivered message PER SUBSCRIBER, so a socket per member per
   * channel with one delivery per message is the most expensive thing this
   * product could switch on. That objection was right about per-message
   * delivery and does not apply to what this subscribes to.
   *
   * The signal is one row per project per kind, UPDATED rather than appended,
   * and the hook debounces to one wake-up per second. A channel arguing about
   * a paper for ten minutes at conversational speed costs a few dozen events,
   * not one per message per reader. What arrives carries no content — it
   * cannot, the table has three columns and none of them is a message — so
   * this refetches through `loadMessages`, which decrypts in the browser as
   * it always has.
   */
  // A reaction bumps the same signal a message does — one row per project per
  // kind, so this costs no extra deliveries.
  /*
   * Keys too, not just messages.
   *
   * A member who is handed the key had no way to notice: this refetched
   * messages, which stayed unreadable, while the wrap that would open them sat
   * in the database until somebody reloaded the page. The signal is one row
   * per project per kind and already debounced, so re-checking the keys on it
   * costs nothing and makes "they gave me the key and nothing happened"
   * impossible.
   */
  useProjectActivity(projectId, "messages", () => {
    void reload();
    keys.reload();
  });

  async function addChannel(event: React.FormEvent) {
    event.preventDefault();
    await createNamed(newChannel);
  }

  /** One path for both the form and the "start with #general" shortcut. */
  async function createNamed(rawName: string) {
    const name = rawName.trim();
    if (!currentKey || name === "") return;

    // The server only sees ciphertext, so it cannot enforce uniqueness. We must
    // do it here on the decrypted names.
    if (channels.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setError(`A channel named "${name}" already exists.`);
      return;
    }

    setPending(true);
    setError(null);

    try {
      // The id is minted here because it is authenticated inside the name's
      // own ciphertext. A database-assigned id could not be.
      const channelId = crypto.randomUUID();
      const nameCt = await sealMessage(name, currentKey, {
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

  async function removeChannel() {
    if (!selected) return;
    setPending(true);
    setError(null);

    try {
      const result = await deleteChannel({ projectId, channelId: selected });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(null);
      await loadChannels();
    } catch {
      setError("Could not delete the channel.");
    } finally {
      setPending(false);
      setConfirmDelete(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();

    /*
     * Say why, rather than doing nothing.
     *
     * This used to `return` silently on all three conditions, and a Send
     * button that quietly discards a message is the worst possible failure for
     * a chat client — the text stays in the box, so it looks like the click
     * missed. It also hid a real bug for a whole afternoon.
     */
    if (draft.trim() === "") return;
    if (!selected) {
      setError("Choose a channel first.");
      return;
    }
    if (!currentKey) {
      setError(
        `No key for the current epoch (${keys.currentEpoch}) — unlock, or ask an admin to re-share the project key.`,
      );
      return;
    }
    setPending(true);
    setError(null);

    try {
      const messageId = crypto.randomUUID();
      const plaintext = encodeMessage({
        text: draft.trim(),
        ...(replyTo ? { replyTo } : {}),
      });
      const ciphertext = await sealMessage(plaintext, currentKey, {
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
      setReplyTo(null);
      await reload();
    } catch {
      setError("Could not send the message.");
    } finally {
      setPending(false);
    }
  }

  /**
   * Set, replace, or withdraw this person's reaction.
   *
   * One per person per message, which is not a preference: the uniqueness the
   * server can enforce is `(message, author)`, because a constraint including
   * the emoji would require the server to see the emoji. So choosing the same
   * one again withdraws it, and choosing another replaces it.
   */
  async function react(messageId: string, emoji: string) {
    if (!currentKey) return;
    setPicking(null);

    const mine = reactions.find((r) => r.messageId === messageId && r.authorId === me);

    try {
      if (mine?.emoji === emoji) {
        const result = await clearReaction(projectId, messageId);
        if (!result.ok) setError(result.error);
      } else {
        const sealed = await sealMessage(emoji, currentKey, {
          channelId: selected!,
          messageId,
          epoch: keys.currentEpoch,
        });
        const result = await setReaction({
          projectId,
          messageId,
          epoch: keys.currentEpoch,
          ciphertext: await toBase64(sealed),
        });
        if (!result.ok) setError(result.error);
      }
      await reload();
    } catch {
      setError("Could not save that reaction.");
    }
  }

  /*
   * Setup happens HERE, not somewhere else.
   *
   * This used to be a link to /unlock, which returned you to a page that then
   * linked to /projects/[id]/keys, which returned you here to make a channel:
   * five screens and three concepts — recovery passphrase, project key with an
   * epoch, channel — before anyone said a word. Each step was a full
   * navigation away from the thing being attempted.
   *
   * The concepts are still real and still named. They just no longer cost a
   * journey each.
   */
  if (!unlocked) {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-ink text-ui">
          Messages here are encrypted in your browser, so the server cannot read them —
          and neither can we. Your passphrase is what opens them.
        </p>
        <InlineUnlock />
        <p className="text-muted text-fine">
          Lost it?{" "}
          <Link
            href={`/unlock?next=${encodeURIComponent(pathname ?? "/projects")}`}
            className="text-accent underline underline-offset-4"
          >
            Manage your keys and devices
          </Link>
          .
        </p>
      </Card>
    );
  }

  if (keys.loading) return <p className="text-muted text-ui">Opening your keys…</p>;

  /*
   * Holding no key is not the same as the project having none.
   *
   * This branch used to say "This project has no content key yet" and offer a
   * button that MINTED ONE — to anybody who happened to hold no wrap. A member
   * who joined after the key existed was therefore invited to rotate the
   * project: the history became unreadable to whoever was not wrapped at the
   * older epochs, and anyone still holding the previous epoch kept writing
   * messages the newcomer could not read. Both sides reported being locked
   * out, and both were right.
   *
   * The two states are now distinct, and only one of them offers to create
   * anything.
   */
  if (keys.byEpoch.size === 0) {
    if (keys.currentEpoch > 0) {
      return (
        <Card className="flex flex-col gap-3">
          <p className="text-ink text-ui">
            <strong>Waiting for the key.</strong> This project already has one, and it has
            not been shared with you yet. Anyone in the project who holds it can hand it
            over from{" "}
            <Link
              href={`/projects/${projectId}/keys`}
              className="underline underline-offset-2"
            >
              Keys &amp; members
            </Link>
            .
          </p>
          <p className="text-muted text-fine">
            Nobody can do this for you from the server — it cannot read the key either.
            That is the point of the encryption, and the cost of it.
          </p>
          <div>
            <Button variant="ghost" onClick={keys.reload} disabled={keys.loading}>
              {keys.loading ? "Checking…" : "Check again"}
            </Button>
          </div>
        </Card>
      );
    }

    return (
      <Card className="flex flex-col gap-3">
        <p className="text-ink text-ui">
          This project has no content key yet. One key is created for the project and
          sealed to each member, so everyone can read the conversation and nobody else
          can.
        </p>
        <SetUpEncryption projectId={projectId} onReady={keys.reload} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1">
      {error && <Banner tone="danger">{error}</Banner>}
      {keys.rejected > 0 && (
        <Banner tone="danger">
          {keys.rejected} project {keys.rejected === 1 ? "key" : "keys"} did not verify
          and {keys.rejected === 1 ? "was" : "were"} ignored. That should not happen —
          someone should look.
        </Banner>
      )}

      <div className="from-ui/5 to-surface ring-border relative rounded-xl border-t border-white/5 bg-gradient-to-br p-4 shadow-sm ring-1">
        <form
          onSubmit={addChannel}
          className="relative z-10 flex flex-wrap items-end gap-2"
        >
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
      </div>

      {channels.length === 0 && (
        // The end of setup should be a place to type, not another empty form
        // asking you to invent a name for something you have not used yet.
        <Card className="flex flex-col gap-3">
          <p className="text-ink text-ui">
            Encryption is set up. Messages live in channels — one per topic, or just one
            for everything.
          </p>
          <div>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => void createNamed("general")}
            >
              Start with a #general channel
            </Button>
          </div>
        </Card>
      )}

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
        <div className="flex flex-col lg:min-h-0 lg:flex-1">
          {/*
            Who cannot read this conversation, said where it is being written.

            A project can split silently into people holding the current key
            and people who do not: everyone sees a working conversation, and
            the only symptom is somebody eventually saying "I can't see your
            messages". The sender is the one who can fix it, so the sender is
            told.
          */}
          {keyless.length > 0 && (
            <Banner tone="danger">
              <strong>
                {keyless.length === 1
                  ? `${keyless[0]!.displayName} cannot read this conversation.`
                  : `${keyless.length} members cannot read this conversation.`}
              </strong>{" "}
              They hold no key for the current epoch, so everything written here is
              unreadable to them.{" "}
              <Link
                href={`/projects/${projectId}/keys`}
                className="underline underline-offset-2"
              >
                Give them the key
              </Link>
              {keyless.some((k) => !k.enrolled) &&
                " — anyone shown as still setting up has to finish that first."}
            </Banner>
          )}

          {/*
            A header for the conversation, outside the scrolling log.

            The delete control used to be the first row INSIDE the message
            list, where it scrolled away with the messages and sat where a
            message would be. Refresh belongs here too: the realtime signal is
            optional — the container is not present in CI — so an explicit
            refetch has to stay reachable, not be assumed away.
          */}
          <div className="border-border bg-raised flex flex-wrap items-center justify-between gap-2 rounded-t-xl border border-b-0 px-4 py-2.5">
            <p className="text-ink text-ui font-medium">
              {channels.find((c) => c.id === selected)?.name ?? "Conversation"}
            </p>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                className="text-fine"
                onClick={() => void reload()}
                disabled={pending}
              >
                Refresh
              </Button>

              {isAdmin &&
                (confirmDelete ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-danger text-fine">
                      Delete this channel and every message in it?
                    </span>
                    <Button variant="danger" disabled={pending} onClick={removeChannel}>
                      Yes, delete
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setConfirmDelete(true)}
                    className="text-danger text-fine"
                  >
                    Delete channel
                  </Button>
                ))}
            </div>
          </div>

          <ul
            ref={logRef}
            data-testid="message-log"
            /*
              Grows with the conversation up to a cap, rather than always
              standing at 62vh.
              A fixed height left a short channel as a tall empty box, and on a
              small window it pushed the composer past the fold — so the page
              scrolled AND the log scrolled, which is two scrollbars for one
              list and the reason this felt wrong to use.
            */
            /*
              The only thing on this page that scrolls.

              It takes whatever height is left after the header, the banner and
              the composer, so the page never grows past the column the project
              shell gave it — which is what used to scroll the sidebar along
              with the conversation. `min-h-0` is the load-bearing half:
              without it a flex child refuses to shrink below its content and
              the overflow moves straight back up to the page.

              The `max-h` is the small-screen fallback, where the shell has no
              fixed height to fill.
            */
            className="bg-surface/40 border-border flex max-h-[62vh] min-h-40 flex-col overflow-y-auto overscroll-contain border-x px-1 py-2 shadow-inner lg:max-h-none lg:min-h-0 lg:flex-1"
          >
            {messages.length === 0 && (
              <li className="text-muted text-ui p-6 text-center">
                Nothing said here yet.
              </li>
            )}

            {messages.map((message, index) => {
              /*
               * Grouped by author.
               *
               * Repeating "Alice · 14:32" above every line is most of why this
               * read as a log rather than a conversation. Consecutive messages
               * from one person within a few minutes share one header — and a
               * reply always starts a group, because its quote needs the
               * context a header gives.
               */
              const previous = messages[index - 1];
              const sameAuthor = previous?.authorId === message.authorId;
              const soonAfter =
                previous !== undefined &&
                new Date(message.createdAt).getTime() -
                  new Date(previous.createdAt).getTime() <
                  GROUP_WINDOW_MS;
              const grouped = sameAuthor && soonAfter && !message.replyTo;

              const parent = message.replyTo
                ? messages.find((m) => m.id === message.replyTo)
                : undefined;
              const colour = colourFor(message.authorId);
              const mine = reactions.filter((r) => r.messageId === message.id);

              // Grouped by emoji, so "👍 3" rather than three separate chips.
              const grouping = new Map<string, OpenedReaction[]>();
              for (const reaction of mine) {
                if (!reaction.emoji) continue;
                grouping.set(reaction.emoji, [
                  ...(grouping.get(reaction.emoji) ?? []),
                  reaction,
                ]);
              }

              return (
                <li
                  key={message.id}
                  className={`group hover:bg-surface/70 relative rounded-lg px-3 transition-colors ${
                    grouped ? "py-0.5" : "mt-1 pt-2 pb-1.5"
                  }`}
                >
                  {!grouped && (
                    <p className="mb-0.5 flex items-baseline gap-2">
                      <span
                        aria-hidden="true"
                        className="inline-block size-2.5 shrink-0 rounded-full"
                        style={{ background: colour.solid }}
                      />
                      <span className="text-ink text-ui font-medium">
                        {message.authorName}
                        {message.authorId === me && (
                          <span className="text-muted font-normal"> (you)</span>
                        )}
                      </span>
                      <time
                        dateTime={message.createdAt}
                        className="text-muted text-fine tabular-nums"
                      >
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </p>
                  )}

                  {/*
                    The quote, when this answers something.
                    A parent that cannot be read is SAID so rather than left
                    dangling: it may be sealed under an epoch key this reader
                    does not hold, and a reply to nothing is worse than a reply
                    to something unreadable.
                  */}
                  {message.replyTo && (
                    <p className="text-muted text-fine border-border mb-1 ml-[1.125rem] truncate border-l-2 pl-2 italic">
                      {parent ? (
                        <>
                          <span className="font-medium">{parent.authorName}</span>{" "}
                          {parent.text ?? "message you cannot read"}
                        </>
                      ) : (
                        "replying to a message that is not in view"
                      )}
                    </p>
                  )}

                  <p className="text-ink text-ui ml-[1.125rem] text-pretty break-words">
                    {message.text !== null ? (
                      /*
                        Rendered as PARTS, never as markup. The message is
                        written by a member and decrypted here, and the server
                        cannot sanitise what it cannot read — so everything
                        goes through React as text and only what `linkify`
                        recognised becomes an anchor.
                      */
                      linkify(message.text).map((part, at) =>
                        part.kind === "link" ? (
                          <a
                            key={at}
                            href={part.href}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-accent underline underline-offset-2 hover:opacity-80"
                          >
                            {part.value}
                          </a>
                        ) : (
                          <span key={at}>{part.value}</span>
                        ),
                      )
                    ) : (
                      // Never rendered as an empty line: a blank message and an
                      // unreadable one look identical, and only one is a problem.
                      <span className="text-muted italic">
                        Encrypted under a key you do not hold.
                      </span>
                    )}
                  </p>

                  {grouping.size > 0 && (
                    <ul className="mt-1 ml-[1.125rem] flex flex-wrap gap-1">
                      {[...grouping.entries()].map(([emoji, who]) => (
                        <li key={emoji}>
                          <button
                            type="button"
                            onClick={() => void react(message.id, emoji)}
                            // Who reacted, on hover — the count alone tells you
                            // how many agreed but not who, which in a review is
                            // the part that matters.
                            title={who.map((r) => r.authorName).join(", ")}
                            className={`text-fine flex min-h-7 items-center gap-1 rounded-full border px-2 tabular-nums ${
                              who.some((r) => r.authorId === me)
                                ? "border-accent bg-accent-soft text-ink"
                                : "border-border text-muted hover:bg-surface"
                            }`}
                          >
                            <span aria-hidden="true">{emoji}</span>
                            <span className="sr-only">
                              {emoji} from {who.map((r) => r.authorName).join(", ")}
                            </span>
                            {who.length}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/*
                    Actions on hover, and on focus — a control that only appears
                    for a mouse is a control a keyboard cannot reach.
                  */}
                  <div
                    data-reaction-picker
                    className={`bg-raised border-border absolute -top-2 right-3 flex items-center gap-0.5 rounded-lg border p-0.5 shadow-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 ${
                      picking === message.id ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    {picking === message.id ? (
                      <>
                        {QUICK_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => void react(message.id, emoji)}
                            aria-label={`React ${emoji}`}
                            className="hover:bg-surface min-h-7 rounded px-1.5"
                          >
                            {emoji}
                          </button>
                        ))}
                        {/*
                          A way out.
                          Opening the picker replaced the React and Reply
                          buttons with six emoji and nothing else, so the only
                          way to leave was to react — which is the one thing
                          somebody who opened it by accident does not want.
                          Escape and a click elsewhere close it too.
                        */}
                        <button
                          type="button"
                          onClick={() => setPicking(null)}
                          aria-label="Close the reaction picker"
                          className="text-muted hover:bg-surface hover:text-ink border-border ml-0.5 min-h-7 rounded border-l pr-1 pl-1.5"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setPicking(message.id)}
                          aria-label="Add a reaction"
                          className="text-muted hover:bg-surface hover:text-ink text-fine min-h-7 rounded px-2"
                        >
                          React
                        </button>
                        <button
                          type="button"
                          onClick={() => setReplyTo(message.id)}
                          aria-label="Reply to this message"
                          className="text-muted hover:bg-surface hover:text-ink text-fine min-h-7 rounded px-2"
                        >
                          Reply
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <form
            onSubmit={send}
            className="border-border bg-raised flex flex-col gap-2 rounded-b-xl border border-t-0 p-3 shadow-sm"
          >
            {/*
              What you are answering, and a way out of it.
              Without this the reply is invisible until it is sent, and the
              only way to discover you were still in one is to send the wrong
              message into a thread.
            */}
            {replyTo && (
              <div className="border-accent/40 bg-surface text-fine flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
                <p className="text-muted min-w-0 truncate">
                  Replying to{" "}
                  <span className="text-ink font-medium">
                    {messages.find((m) => m.id === replyTo)?.authorName ?? "a message"}
                  </span>
                  {": "}
                  {messages.find((m) => m.id === replyTo)?.text ?? "…"}
                </p>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="text-muted hover:text-ink shrink-0 underline underline-offset-2"
                >
                  Cancel
                </button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <label htmlFor="message-body" className="sr-only">
                Message
              </label>
              <Textarea
                id="message-body"
                value={draft}
                rows={1}
                placeholder="Write a message…"
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setDraft(event.target.value)
                }
                /*
                 * Enter sends, Shift+Enter breaks the line.
                 *
                 * The convention every chat client uses, and the reason this is
                 * a textarea rather than an input: a message about a paper is
                 * often two paragraphs, and an input cannot hold the second.
                 */
                onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  if (draft.trim() !== "" && !pending) void send(event);
                }}
                className="max-h-40 min-h-11 flex-1 resize-y py-2.5"
              />
              <Button type="submit" disabled={pending || draft.trim() === ""}>
                Send
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
