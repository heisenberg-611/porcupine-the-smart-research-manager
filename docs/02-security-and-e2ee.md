# Porcupine — Security & Encryption Design

**v2** — E2EE scope narrowed to messages, documents, and LaTeX sources. Roughly half the crypto surface of v1.

---

## 1. Threat model

**Assets:** private conversation between collaborators, unpublished draft text, corpus composition (which papers a lab reads leaks a research direction pre-publication), supervisor feedback, member identities.

| Adversary | Capability | Mitigation |
|---|---|---|
| External attacker | Internet access, stolen credentials | Auth, MFA, RLS, rate limiting, short-lived tokens |
| Malicious or curious operator (you, a future employee, a cloud admin) | Full DB + storage read | **E2EE for messages/docs/LaTeX.** Annotations and extractions are *not* protected from this adversary — say so. |
| Compromised infrastructure provider | DB dumps, disk images | E2EE for the encrypted tier; at-rest encryption + access controls for the rest |
| Malicious project member | Holds the project key legitimately | **Not mitigable by crypto.** Audit log, revocation, key rotation. |
| Compromised client or browser extension | Reads plaintext in memory | Strict CSP, no third-party scripts on app routes, worker isolation |
| Compromised NPM dependency | Arbitrary client code, key exfiltration | Lockfile pinning, `npm audit` CI gate, **hard dependency budget on the crypto worker: libsodium only** |
| LaTeX compilation abuse (`\write18`, `\input{/etc/passwd}`) | Arbitrary file read / RCE on a build host | **Eliminated by compiling client-side in WASM** — no build host exists (ADR-007) |

**Out of scope:** a member who legitimately had access and then leaks; traffic analysis; nation-state client implants.

---

## 2. Encryption tiers (ADR-001, confirmed)

| Tier | Contents | Protection |
|---|---|---|
| **Public** | `Work` metadata, project/org names, member display names | None needed |
| **Server-confidential** | Membership, roles, screening/reading status, annotations, anchors, extraction values, questions, claims, milestones, activity | RLS + at-rest disk encryption. Server can read. |
| **End-to-end encrypted** | `Message.body_ct`, `DocUpdate.update_ct`, `LatexFile.content_ct`, `LatexUpdate.update_ct`, comments on encrypted targets, compiled PDFs | XChaCha20-Poly1305 under per-project keys wrapped to each member |

**What the server can see, stated plainly** — publish this verbatim:

> Porcupine cannot read your messages, your documents, or your LaTeX drafts. It can read your paper library, your highlights, and your extracted data, which are encrypted at rest and access-controlled. It always knows who is in which project and when they acted.

Never market this as "fully end-to-end encrypted." The tier table is defensible to a university privacy office precisely because it is honest.

**Accepted leakage in the encrypted tier:** ciphertext sizes and timing. An operator can infer message volume and document length. Pad message bodies to 256/1024/4096-byte buckets; don't bother padding CRDT updates.

---

## 3. Key hierarchy

```
Password ──Argon2id(m=64MiB, t=3, p=1, User.kdfSalt)──► Key Encryption Key
                                                              │
                                                              ▼
                                        User Master Key (32 B random)  ◄── also wrapped by:
                                                │                          • recovery code (BIP39, 24 words)
                                                │                          • each Device (WebAuthn PRF)
                                                │                          • org escrow key, if opted in
                                                ▼
                          Identity keypair (X25519) + Signing keypair (Ed25519)
                                    private halves sealed under the Master Key
                                                ▼
                          ProjectKey[epoch] — 32 B random, per project per epoch
                            sealed to each member via crypto_box_seal(pk_member)
```

**Primitives (libsodium):** `crypto_aead_xchacha20poly1305_ietf` for content, `crypto_box_seal` for key wrapping, `crypto_sign_detached` for wrap authenticity, `crypto_pwhash` (Argon2id) for the KEK. No hand-rolled crypto, no AES-CBC, no `Math.random`.

**`User.kdfSalt` is distinct from the auth password salt** and the derivation input never leaves the client. Supabase Auth hashes the password server-side for login; the KEK is derived independently in the browser.

**AAD binding:** every AEAD call includes `projectId || tableName || rowId || keyEpoch` as associated data. This stops an operator relocating ciphertext between rows or replaying an old epoch.

---

## 4. Key lifecycle

**Signup (Phase 0).** Client generates the Master Key, identity + signing keypairs, and a 24-word recovery code. Uploads public keys and the wrapped private bundle. Recovery code display is mandatory and blocking — the user must confirm they've stored it.

**New device.** Password → Argon2id → KEK → Master Key → identity keys → fetch and unwrap `ProjectKey` rows. Register the device with its own wrap so later logins can use WebAuthn PRF instead of the password.

**Adding a member.** An `admin`/`owner` fetches the invitee's `identityPubKey`, seals the current-epoch `ProjectKey` to it, signs the wrap, inserts a `ProjectKey` row. **This requires an online member holding the key.** Invitations are therefore two-phase: `invited` → `provisioned`. The UI must say "waiting for a member to grant access" rather than pretending the invite completed.

> **Trust-on-first-use caveat.** The inviter trusts the server's copy of the invitee's public key; a malicious server could substitute its own. Mitigate with **key fingerprint (safety number) display** verifiable out of band, and by signing every wrap so substitution is detectable in the audit log afterwards. Ship fingerprints before making any security claim publicly.

**Supervisor added later.** Same flow, plus the `historyAccess` prompt (`ALL_HISTORY` default | `FROM_JOIN`). `ALL_HISTORY` re-wraps every prior epoch to them; `FROM_JOIN` wraps the current epoch only and sets `ProjectMember.historyFrom`, which also filters plaintext history in RLS. Both choices are written to `AuditLog`.

**Removing a member.** Delete their `ProjectKey` rows, revoke sessions, increment `Project.currentKeyEpoch`, re-wrap a fresh key to remaining members. New writes use the new epoch.

> **Rotation is not retroactive.** Anything they already downloaded is compromised permanently. The removal dialog must say this — don't let a user believe otherwise.

**Recovery.** The recovery code is the only backstop for a forgotten password. Optionally an org enables **escrow**: the Master Key additionally wrapped to an escrow key held by two org admins under split control. Escrow is off by default, opt-in per organization, and **disclosed to the user at signup** — silent escrow would make the E2EE claim dishonest.

**Loading multi-epoch content.** A document or LaTeX file may span epochs. The client must hold a *set* of keys, not one. Decrypt each update at its own `keyEpoch`.

---

## 5. Encrypted real-time collaboration (Phases 4–5)

- **Transport:** Supabase Realtime `broadcast` channel per document/file, authorized by RLS. Payload is an encrypted Yjs update.
- **Persistence:** every update also appended to `DocUpdate` / `LatexUpdate` as ciphertext. The server never merges.
- **Awareness:** cursor positions and selections encrypted; presence *identity* is server-visible metadata.
- **Compaction:** clients race on an advisory lock row; the winner merges locally with Yjs, writes `isSnapshot = true` with `supersedes = maxId`, and a background job deletes superseded rows **only after** verifying the snapshot exists. Trigger at >300 updates or >1 MB.
- **Rotation mid-document:** write a snapshot at the new epoch; older updates stay at their epoch.
- **Offline:** Yjs merges cleanly on reconnect — the main reason for a CRDT over OT. LaTeX is plain text and merges especially cleanly.

---

## 6. Row Level Security (ADR-002 — the Prisma boundary)

**The problem:** Prisma connecting as the table owner or a superuser **silently bypasses RLS**. A team using Prisma for everything can ship a complete authorization bypass and never see an error.

**The rule:**
- **Client reads and Realtime go through `supabase-js`** with the user's JWT. RLS enforced natively. Primary read path.
- **Prisma handles migrations and trusted server-side writes** in Server Actions / Route Handlers, with authorization enforced in application code.
- Prisma connects as `porcupine_app` — **not** the owner — with only DML grants. Every table gets `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, so RLS applies to Prisma too as defence in depth.
- Where a Prisma query must run as the user:
  ```ts
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    // queries here run under the user's RLS context
  });
  ```
- `SUPABASE_SERVICE_ROLE_KEY` exists only in worker environment variables. Add an ESLint rule **and** a CI grep that fails the build if it appears in any client-reachable module.

**Baseline policy shape.** A `SECURITY DEFINER` helper avoids recursive policy evaluation:

```sql
create or replace function app.is_project_member(p uuid, min_role text default 'observer')
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_member m
    where m.project_id = p
      and m.user_id = auth.uid()
      and m.removed_at is null
      and app.role_rank(m.access_role) >= app.role_rank(min_role)
  );
$$;

-- history gating for members added with FROM_JOIN
create or replace function app.can_see_history(p uuid, created timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_member m
    where m.project_id = p and m.user_id = auth.uid() and m.removed_at is null
      and (m.history_access = 'ALL_HISTORY' or created >= coalesce(m.history_from, m.joined_at))
  );
$$;

alter table annotation enable row level security;
alter table annotation force row level security;

create policy annotation_select on annotation for select
  using (app.is_project_member(project_id) and app.can_see_history(project_id, created_at));

create policy annotation_insert on annotation for insert
  with check (app.is_project_member(project_id, 'contributor') and author_id = auth.uid());

create policy annotation_update on annotation for update
  using (author_id = auth.uid() and app.is_project_member(project_id, 'contributor'));
-- no delete policy: soft-delete via update only
```

`ActivityEvent`, `ContributionEvent`, `AuditLog`, and `Message` get **select + insert policies only**. The absence of update/delete policies is the append-only enforcement.

**Testing is mandatory.** A pgTAP suite asserting, for every table: a non-member sees zero rows; an `observer` cannot insert; a `reviewer` can insert comments but not extractions; a removed member sees zero rows; a `FROM_JOIN` member sees no pre-join rows. Plus a test enumerating `pg_class` that fails on any RLS-disabled table in `public`. Run as a merge gate.

---

## 7. Application security checklist

**Auth**
- Supabase Auth: email OTP + Google; SAML/OIDC in Phase 7. ORCID as a *linked* identity for attribution, not a login provider.
- MFA required for `owner`/`admin` and all org admins.
- Short-lived access tokens, refresh rotation, server-side session revocation on member removal.
- Invite tokens: single-use, 72 h expiry, bound to the invited email, constant-time compare.

**Input & output**
- Zod at every boundary — parse, don't validate.
- Strict CSP with nonces; no `unsafe-inline`, no `unsafe-eval`. `wasm-unsafe-eval` **is** required for the crypto worker and the TeX engine — scope it to those workers, not the document.
- `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (also unlocks `SharedArrayBuffer`, which the TeX engine wants).
- Rich text sanitized on render, not on store — the server can't sanitize ciphertext anyway.

**Files (Supabase Storage)**
- Private buckets, RLS on `storage.objects`, short-lived signed URLs only. No public bucket exists.
- **Uploads go client → Storage directly via a signed upload URL** issued by a Server Action. This dodges Vercel's 4.5 MB request body limit and keeps large PDFs off the app server entirely.
- Post-upload job: ClamAV scan → `scanStatus = CLEAN` gates all downloads; extract text for FTS; count pages.
- pdf.js with `isEvalSupported: false`, scripting disabled, rendered in a sandboxed context. Enforce size and page caps.

**SSRF — the highest-risk server surface**
Users paste URLs and the server fetches them (DOI resolution, OA PDF fetch, Zotero import). Required controls: `https` only; resolve DNS and reject RFC1918, loopback, link-local, and `169.254.169.254` **after** resolution; no redirects to non-allowlisted hosts; response size and time caps; run fetches in an isolated worker with no cloud metadata access. Never proxy an arbitrary URL back to the browser.

**Rate limiting**
Per-user and per-IP on auth, invites, external API proxying, uploads, compiles, exports. Postgres token bucket is sufficient and free. Bulk imports run as queued jobs with progress, never in a request.

**External APIs**
Send `mailto=` for OpenAlex/Crossref polite pools. Queue arXiv at 1 req / 3 s. Cache every response in `Work.raw` — one call per work, ever. Circuit-break on provider failure; degrade to the remaining providers rather than failing the search.

**Supply chain**
Lockfile committed, `npm ci` only, Dependabot, `npm audit --audit-level=high` as a CI gate. The crypto worker's dependency budget is libsodium and nothing else; review every addition by hand.

**Compliance**
GDPR: DPIA, data export, hard deletion (E2EE content becomes unreadable on key deletion — a clean deletion story), EU residency option. FERPA if US universities: student work is an educational record. Per-org retention; audit log retained ≥ 1 year. **External penetration test before v1.0 GA — budget for it.**

---

## 8. Incident response

Write this before launch: severity levels, on-call, a `security@` address, the 72-hour GDPR breach clock, and a public disclosure policy. For the encrypted tier specifically, a DB breach is materially less severe than for a normal SaaS — and being able to say that credibly, with the §2 tier table, is worth a great deal. That credibility only exists if the boundary was documented honestly from day one.
