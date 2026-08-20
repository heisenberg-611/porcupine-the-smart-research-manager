/**
 * What a message's plaintext actually contains.
 *
 * A reply is a link from one message to another, and the obvious home for it
 * is a `reply_to_id` column. That is the wrong place here. `Channel.nameCt` is
 * ciphertext because "we cannot read your messages but we can read what you
 * called the conversation" is a half-claim the schema refuses — and a reply
 * column is the same half-claim moved: the server would hold the reply graph
 * of every conversation, which message drew six answers, where an argument
 * happened. That is the shape of the work, legible without a plaintext word.
 *
 * So the parent id travels inside the ciphertext, and the client — which
 * already decrypts every message in the channel — resolves the thread in
 * memory.
 */

export interface MessagePayload {
  text: string;
  /** The message this answers, when it answers one. */
  replyTo?: string | undefined;
}

/** Current wire version. Bump only for a change old readers cannot ignore. */
const VERSION = 1;

export function encodeMessage(payload: MessagePayload): string {
  return JSON.stringify({
    v: VERSION,
    text: payload.text,
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
  });
}

/**
 * Read a plaintext message, whatever era it is from.
 *
 * Messages sealed before this format existed are bare strings, and there is no
 * migration that could fix that: the server cannot read them, so nobody can
 * rewrite them. The decoder therefore treats anything that is not a
 * well-formed payload as the message itself.
 *
 * That is also the safe failure for a message from a FUTURE version: showing
 * the raw text of something we only partly understand beats showing nothing,
 * and beats showing a JSON blob to a reader.
 */
export function decodeMessage(plaintext: string): MessagePayload {
  const trimmed = plaintext.trimStart();
  // Cheap guard: anything not starting as an object cannot be a payload, and
  // JSON.parse on a long message body is not free.
  if (!trimmed.startsWith("{")) return { text: plaintext };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // A message that merely begins with a brace. Common enough in a research
    // tool — people paste BibTeX.
    return { text: plaintext };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { text?: unknown }).text !== "string"
  ) {
    return { text: plaintext };
  }

  const payload = parsed as { text: string; replyTo?: unknown };
  return {
    text: payload.text,
    ...(typeof payload.replyTo === "string" ? { replyTo: payload.replyTo } : {}),
  };
}
