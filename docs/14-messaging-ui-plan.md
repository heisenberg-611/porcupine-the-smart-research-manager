# Messaging — a conversation you would actually use

The encryption works. The chain it proves — unlock → master key → project key →
message — is the hard part and it is done. What sits on top is a `<ul>`: every
message carries its author's name and a timestamp whether or not the previous
one did, there is no way to answer a particular message, no way to agree with
one without typing "agreed", and the composer is a box under a list.

This is the presentation half, plus the two things a conversation needs before
it stops being a log.

---

## 1. Where a reply can live

A reply is a link from one message to another. The obvious home is a
`reply_to_id` column — and it is the wrong one here.

`Channel.nameCt` is ciphertext, and the schema says why:

> A server that could read channel names would know the shape of the work even
> without the messages, and "we cannot read your messages but we can read what
> you called the conversation" is the kind of half-claim this schema keeps out.

A reply column is the same half-claim in a different place. The server would
hold the full reply graph of every conversation: who answers whom, which
message drew six responses, where an argument happened. That is the shape of
the work again, and it is legible without a single plaintext word.

**So the parent id goes inside the ciphertext.** The plaintext becomes a small
JSON payload rather than a bare string:

    { "v": 1, "text": "...", "replyTo": "<message id>" }

The client already decrypts every message in the channel, so resolving a reply
to its parent is a lookup in memory. The server keeps a table of opaque blobs
and learns nothing new.

**Existing messages are bare strings**, sealed before this format existed. The
decoder therefore accepts both: parse as JSON and use it when it has the
expected shape, otherwise treat what came out as the whole message. No
migration, and no epoch of unreadable history.

---

## 2. Reactions

Their own table, because they are their own rows with their own lifetime — a
reaction arrives and leaves independently of the message it is on.

Encrypted, for the reason above: "Alice 👍 the message about the null result"
is sentiment and social graph, and storing it in the clear next to a table we
went to some trouble to encrypt would be the same half-claim a third time.

**One reaction per person per message.** This is a product decision forced by
the encryption and worth stating rather than discovering: the uniqueness
constraint has to be `(message_id, author_id)`, because a constraint on the
emoji would require the server to see the emoji. Reacting again replaces your
reaction; reacting with what you already chose removes it.

**Reactions are mutable, and messages are not.** `messages` has no UPDATE or
DELETE policy on purpose — an edited ciphertext is indistinguishable from a
substituted one, so the transcript is append-only. A reaction is not part of
the transcript. It is a current opinion about a line in it, and an opinion you
cannot withdraw is not worth recording. The author may change or remove their
own; nobody may touch anyone else's.

---

## 3. Live, without a new bill

Reactions and replies ride the signal that already exists. `project_activity`
carries one row per project per kind, updated rather than appended, debounced
to one wake-up a second — which is why realtime here costs a few dozen events
per conversation rather than one per message per reader. A trigger on
`message_reactions` bumps the same `messages` kind, so a reaction wakes the
same refetch a message does.

---

## 4. The window

- **Grouped by author.** Consecutive messages from one person within a few
  minutes share one header. Repeating "Alice · 14:32" above every line is most
  of why the current list reads as a log.
- **Identity by colour**, from the same rule the PDF annotations use, so a
  person is one colour everywhere in the product.
- **Own messages distinguished** but not right-aligned: with more than two
  people in a project, alignment stops meaning anything.
- **Hover actions** on a message: react, reply.
- **Reply shown as a quote** above the message, clickable to jump to the
  parent, and stated plainly when the parent is not readable — the parent may
  be under an epoch key this reader does not hold, and a reply to a message you
  cannot read should say so rather than dangle.
- **A composer that behaves**: grows with its content, Enter sends, Shift+Enter
  breaks, and shows what it is replying to with a way to cancel.
- **Scrolls in its own window**, pinned to the newest message, and stays put
  when you have scrolled up to read — with a control to return.

---

## 5. Acceptance

Two members hold a conversation: one replies to a specific message and the
quote resolves; both react and each sees the other's reaction with the right
count; a reaction is changed and then withdrawn. Consecutive messages group.
A message under a missing epoch key still says so, and a reply to it says so
too. `pnpm verify --e2e` green, with the reaction table's policies asserted in
pgTAP from both sides.
