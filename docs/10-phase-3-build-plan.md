# Phase 3 — Crypto envelope + Messaging · Build Plan

Written after auditing the code rather than from the roadmap, because five
weeks of Phase 2c each found a plan item that was already built or a flag
describing behaviour that did not exist. In a phase about cryptography, that
habit stops being embarrassing and starts being dangerous.

Audited 2026-08-15 against `main`.

---

## 1. What the audit found

### 1.1 The key hierarchy in the code is not the one in the design

`docs/02-security-and-e2ee.md` §3 specifies:

```
KEK ──► User Master Key (32 B random) ──► identity keypairs ──► ProjectKey[epoch]
             ▲
             └── also wrapped by: recovery code · each device · org escrow
```

`packages/crypto/src/identity.ts` implements:

```
KEK ──► identity private bundle          (crypto_secretbox_easy, directly)
```

**There is no Master Key.** The identity private halves are sealed directly
under a single Argon2id KEK.

This is not a tidiness problem, and it is the reason this phase starts here.
The Master Key exists to be *the one thing many keys wrap*. Wrapping the
identity bundle directly under one KEK means there is exactly one way in, and
**no second unwrap path can be added without the recovery passphrase**:

- registering a device requires re-deriving from the passphrase, every time
- org escrow cannot be added to an existing account at all
- rotating the passphrase means re-wrapping the bundle rather than re-wrapping
  one 32-byte key

The schema already assumes the design: `devices.wrapped_master_key` is a column
with nothing to put in it.

### 1.2 The design document is stale in a second way

§3 and §5 say *"Password → Argon2id → KEK"*. There is no password — auth is
email OTP and OAuth. `identity.ts` says so in its own header and derives the
KEK from the generated **recovery passphrase** instead, which is a different
security story: the recovery passphrase is the *only* secret, shown once.

Both statements need to become one statement before anything is built on them.

### 1.3 Three tables exist and are read by nothing

| Table | Shape | Application references |
| --- | --- | --- |
| `project_keys` | `project_id, user_id, epoch, wrapped_key, wrapped_by, signature` | **0** |
| `devices` | `user_id, label, device_pub_key, wrapped_master_key, revoked_at` | **0** |
| `file_objects` | (the R2 pipeline) | **0** |

All three have RLS enabled and forced. The shapes look right —
`project_keys` is exactly "per project per epoch, sealed to each member, with a
signature over the wrap", and `projects.current_key_epoch` is the pointer. But
schema without behaviour is a promise, and this repository has just spent a
week removing two of those.

**Nothing here should be trusted until something reads it and a test proves the
policy.** The RLS on these tables has never had a mutation check run against
it, because there has never been a row.

### 1.4 There is no messaging schema at all

No channels, messages, threads, reactions or receipts. That half of the phase
is genuinely greenfield, which makes it the *easy* half.

### 1.5 The relay is not for this

`apps/relay` is a Durable Object for Yjs document collaboration (ADR-020),
ticket-authenticated and E2EE-opaque. Messages are append-only with no merge
semantics — the roadmap says so itself — so they do not need a CRDT relay.
Using it for messaging would put a Phase 5 dependency in front of Phase 3.

---

## 2. The decision this phase turns on

**Introduce the Master Key, now.** Alternatives considered:

*Wrap the identity bundle under each key-wrapping key directly* — no Master Key,
each device and escrow key wraps the whole private bundle. It works. It also
re-encrypts the full bundle for every device added, and every wrap is a
separate copy of the private keys, which is more attack surface for no benefit.

*Defer it* — build messaging on the current single-wrap identity, add the Master
Key later. This is the expensive option and the audit is the argument: today
there are no production users, so introducing the layer costs a migration of
zero rows. `identity.ts`'s own header names the alternative — *"the whole
population needs a re-enrollment flow, which for keys means a trust-on-first-use
moment you only get to spend once."*

**And rewrite §3 of the security doc to say "recovery passphrase", not
"password".** The doc describes an authentication design the product does not
have. Either it changes or the code does, and the code is right: there is no
password to derive from.

---

## Week 1 — The key hierarchy, reconciled

*Nothing encrypted ships until the thing that holds the keys is the thing the
schema and the document describe.*

**1.1 Master Key in `packages/crypto`.** 32 random bytes. Identity private
halves sealed under it; the Master Key sealed under the KEK. `createIdentity`
returns the same public surface, so `enroll` does not change shape.

**1.2 A wrap is a thing, not a field.** One `wrapMasterKey(mk, to)` /
`unwrapMasterKey(...)` pair used by the passphrase path, the device path and
(later) escrow, so a second unwrap route is a row rather than a rewrite.

**1.3 Migrate the existing bundle format.** `key_bundle_ver` exists on `users`
for exactly this. v1 (identity-under-KEK) must still unwrap, and re-wrap to v2
on next unlock. Zero rows today; the path is written anyway, because "there were
no users when we skipped it" is how a migration becomes impossible.

**1.4 Fix `docs/02-security-and-e2ee.md` §3 and §5** to describe the recovery
passphrase, and state plainly that losing it loses the encrypted content.

**1.5 Sabotage tests.** Wrong passphrase fails; a tampered wrapped bundle
fails; a v1 bundle still opens. Each seen to fail before it is believed.

---

## Week 2 — Project keys and epochs

**2.1 Generate a ProjectKey on project creation** — 32 random bytes, sealed to
each member with `crypto_box_seal(identityPubKey)`, signed with the wrapper's
Ed25519 key. That signature is the point: without it the server could hand a
member a key it chose.

**2.2 Verify the signature on unwrap, and refuse on mismatch.** A wrap whose
signature does not verify is an attack, not a glitch.

**2.3 New member provisioning** — the inviter wraps the current epoch's key to
the new member. A member who joins cannot read earlier epochs; `history_access`
already exists on `project_members` and already means this.

**2.4 Removal rotates the epoch.** New key, wrapped to remaining members,
`projects.current_key_epoch` incremented. Old ciphertext stays readable by
whoever still holds the old key — rotation protects *future* content and
claiming otherwise would be a lie.

**2.5 pgTAP for `project_keys` RLS, with mutation checks.** A member sees only
their own wraps. This policy has never been exercised against a row.

---

## Week 3 — Messages

**3.1 Schema:** `channels`, `messages`, `message_reads`. Ciphertext plus the
epoch it was encrypted under — a message that cannot say which key opens it is
unreadable after the first rotation.

**3.2 The envelope:** `crypto_aead_xchacha20poly1305_ietf`, project key for the
epoch, with channel id and message id as associated data so a ciphertext cannot
be replayed into a different conversation.

**3.3 RLS + pgTAP.** Membership scopes reads; the server stores ciphertext it
cannot read, and a test asserts the column is opaque rather than assuming it.

**3.4 Send and read, no UI polish.** Prove the round trip end to end with two
browser contexts before anything is styled.

---

## Week 4 — The surface

**4.1 Channels and threads** in the project shell, using the navigation and
primitives Phase 2c built.

**4.2 Safety numbers.** `keyFingerprint` exists and is displayed nowhere. Two
people comparing a fingerprint out of band is the only defence against a server
that swapped a public key, and it is worthless if the UI never shows it.

**4.3 Device list** — register, name, revoke. Revocation must remove the wrap,
not hide the row.

**4.4 The honest empty state.** What the server can and cannot read, said once,
where a new member first sees a channel.

---

## Definition of done

- [ ] The hierarchy in the code, the schema and `02-security-and-e2ee.md` are
      the same hierarchy
- [ ] A v1 bundle still unwraps, and re-wraps to v2 — proven, not assumed
- [ ] Every `project_keys` and `messages` policy has a pgTAP test with a
      mutation check
- [ ] A wrap with a bad signature is refused, and that has been seen to fail
- [ ] Removing a member rotates the epoch; the removed member's wrap is gone
- [ ] Two browsers exchange a message neither the server nor the database can
      read — asserted by reading the column
- [ ] Safety numbers are displayed and match across two clients
- [ ] `pnpm verify --e2e` green; axe clean on both viewports
- [ ] BUILD-LOG entry exists, Problems section non-empty

## Not in this phase

**Client-side search over messages** — it needs a decrypted corpus in the
browser and an index that survives reload; it is its own piece of work.

**Presence and read receipts** — the v6 replan already found Supabase Realtime
bills per delivered message *per subscriber*, which makes presence the most
expensive feature per unit of value in the product. Deferred on cost, not
difficulty.

**Org escrow** — week 1 makes it possible by putting a Master Key there to
wrap. Building it needs an organisation with two admins to hold it, which no
test fixture has.

**The R2 file pipeline.** `file_objects` is the third unread table and PDF
reading is the largest gap in the product, but it is blocked on credentials
rather than on work, and it is not cryptography.

## The measurement this phase cannot make

Encryption is verifiable and usability is not. Nothing in the list above tells
us whether a research team will actually use channels in here rather than in
the tool they already have open. That is still four people and one afternoon,
carried since Phase 1.
