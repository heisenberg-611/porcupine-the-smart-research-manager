# Porcupine — Security & Encryption Design

**v4** — E2EE scope is **messages and LaTeX sources**. v2 narrowed it from everything; v3 moved storage to Cloudflare R2, relocating file authorization from database RLS into a Worker (§7); v4 moved prose to Google Docs, adding a third-party tier and a new authorization seam (ADR-014, §7).

---

## 1. Threat model

**Assets:** private conversation between collaborators, unpublished draft text, corpus composition (which papers a lab reads leaks a research direction pre-publication), supervisor feedback, member identities.

| Adversary                                                             | Capability                                | Mitigation                                                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| External attacker                                                     | Internet access, stolen credentials       | Auth, MFA, RLS, rate limiting, short-lived tokens                                                               |
| Malicious or curious operator (you, a future employee, a cloud admin) | Full DB + storage read                    | **E2EE for messages/docs/LaTeX.** Annotations and extractions are _not_ protected from this adversary — say so. |
| Compromised infrastructure provider                                   | DB dumps, disk images                     | E2EE for the encrypted tier; at-rest encryption + access controls for the rest                                  |
| Malicious project member                                              | Holds the project key legitimately        | **Not mitigable by crypto.** Audit log, revocation, key rotation.                                               |
| Compromised client or browser extension                               | Reads plaintext in memory                 | Strict CSP, no third-party scripts on app routes, worker isolation                                              |
| Compromised NPM dependency                                            | Arbitrary client code, key exfiltration   | Lockfile pinning, `npm audit` CI gate, **hard dependency budget on the crypto worker: libsodium only**          |
| LaTeX compilation abuse (`\write18`, `\input{/etc/passwd}`)           | Arbitrary file read / RCE on a build host | **Eliminated by compiling client-side in WASM** — no build host exists (ADR-007)                                |

**Out of scope:** a member who legitimately had access and then leaks; traffic analysis; nation-state client implants.

---

## 2. Encryption tiers (ADR-001, confirmed)

| Tier                     | Contents                                                                                                                                                | Protection                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Public**               | `Work` metadata, project/org names, member display names                                                                                                | None needed                                                                    |
| **Server-confidential**  | Membership, roles, screening/reading status, annotations, anchors, extraction values, questions, claims, milestones, activity                           | RLS + at-rest disk encryption. Server can read.                                |
| **Third-party (Google)** | Google Docs prose, exported Sheets                                                                                                                      | Google's at-rest encryption and ACLs. Outside our boundary entirely (ADR-014). |
| **End-to-end encrypted** | `Message.body_ct`, `LatexFile.content_ct`, `LatexUpdate.update_ct`, comments on encrypted targets, compiled PDFs, and `DocUpdate.update_ct` in Phase 4b | XChaCha20-Poly1305 under per-project keys wrapped to each member               |

**What the server can see, stated plainly** — publish this verbatim:

> Porcupine cannot read your messages or your LaTeX manuscripts. It can read your paper library, your highlights, and your extracted data, which are encrypted at rest and access-controlled. Documents you write in Google Docs live in your Google Drive under Google's terms — we can read those, and so can Google. Porcupine always knows who is in which project and when they acted.

Never market this as "fully end-to-end encrypted." The tier table is defensible to a university privacy office precisely because it is honest.

**Accepted leakage in the encrypted tier:** ciphertext sizes and timing. An operator can infer message volume and document length. Pad message bodies to 256/1024/4096-byte buckets; don't bother padding CRDT updates.

---

## 3. Key hierarchy

```
Recovery passphrase ──Argon2id(INTERACTIVE, User.kdfSalt)──► Key Encryption Key
                                                              │
                                                              ▼
                                        User Master Key (32 B random)  ◄── also wrapped by:
                                                │                          • each Device (WebAuthn PRF)
                                                │                          • org escrow key, if opted in
                                                ▼
                          Identity keypair (X25519) + Signing keypair (Ed25519)
                                    private halves sealed under the Master Key
                                                ▼
                          ProjectKey[epoch] — 32 B random, per project per epoch
                            sealed to each member via crypto_box_seal(pk_member)
```

**There is no password.** Authentication is email OTP and OAuth, so there is
nothing the user knows to derive a KEK from. The root secret is instead a
**recovery passphrase the system generates and shows exactly once** — 30
Crockford-base32 characters, ~128 bits. It is both the account-recovery
mechanism and the only thing standing between the server and the private keys.

Two consequences, stated rather than implied:

- **Lose the passphrase, lose the encrypted content.** That is what end-to-end
  encryption means. The UI says so where the passphrase is shown, not in a help
  article.
- **The Master Key is what makes any of the other wraps possible.** Until Phase
  3 the identity private halves were sealed *directly* under the KEK, which
  meant exactly one way in — a device could not be registered and escrow could
  not be added without the passphrase. Wrapping one 32-byte key instead of the
  whole private bundle is the entire reason that layer exists.

**Bundle versions.** v1 sealed the identity halves under the KEK directly; v2
introduces the Master Key. `users.key_bundle_ver` records which, derived from
the blob's own first byte so the two cannot disagree, and v1 still opens and
re-wraps to v2 on first unlock without changing any keypair. A public key that
changed during a migration would be indistinguishable from an attack to anyone
who had compared a safety number.

**Primitives (libsodium):** `crypto_aead_xchacha20poly1305_ietf` for content, `crypto_box_seal` for key wrapping, `crypto_sign_detached` for wrap authenticity, `crypto_pwhash` (Argon2id) for the KEK. No hand-rolled crypto, no AES-CBC, no `Math.random`.

**`User.kdfSalt` is distinct from the auth password salt** and the derivation input never leaves the client. Supabase Auth hashes the password server-side for login; the KEK is derived independently in the browser.

**AAD binding:** every AEAD call includes `projectId || tableName || rowId || keyEpoch` as associated data. This stops an operator relocating ciphertext between rows or replaying an old epoch.

---

## 4. Key lifecycle

**Signup (Phase 0).** Client generates the Master Key, identity + signing keypairs, and a recovery passphrase. Uploads public keys and the wrapped private bundle. Passphrase display is mandatory and blocking — the user must confirm they've stored it.

**New device.** Recovery passphrase → Argon2id → KEK → Master Key → identity keys → fetch and unwrap `ProjectKey` rows. Register the device with its own wrap of the **Master Key**, so later logins use WebAuthn PRF and never need the passphrase again.

**Adding a member.** An `admin`/`owner` fetches the invitee's `identityPubKey`, seals the current-epoch `ProjectKey` to it, signs the wrap, inserts a `ProjectKey` row. **This requires an online member holding the key.** Invitations are therefore two-phase: `invited` → `provisioned`. The UI must say "waiting for a member to grant access" rather than pretending the invite completed.

> **Trust-on-first-use caveat.** The inviter trusts the server's copy of the invitee's public key; a malicious server could substitute its own. Mitigate with **key fingerprint (safety number) display** verifiable out of band, and by signing every wrap so substitution is detectable in the audit log afterwards. Ship fingerprints before making any security claim publicly.

**Supervisor added later.** Same flow, plus the `historyAccess` prompt (`ALL_HISTORY` default | `FROM_JOIN`). `ALL_HISTORY` re-wraps every prior epoch to them; `FROM_JOIN` wraps the current epoch only and sets `ProjectMember.historyFrom`, which also filters plaintext history in RLS. Both choices are written to `AuditLog`.

**Removing a member.** Delete their `ProjectKey` rows, revoke sessions, increment `Project.currentKeyEpoch`, re-wrap a fresh key to remaining members. New writes use the new epoch.

> **Rotation is not retroactive.** Anything they already downloaded is compromised permanently. The removal dialog must say this — don't let a user believe otherwise.

**Recovery.** The recovery passphrase is the only backstop, and there is no password behind it. Optionally an org enables **escrow**: the Master Key additionally wrapped to an escrow key held by two org admins under split control. Escrow is off by default, opt-in per organization, and **disclosed to the user at signup** — silent escrow would make the E2EE claim dishonest.

**Loading multi-epoch content.** A document or LaTeX file may span epochs. The client must hold a _set_ of keys, not one. Decrypt each update at its own `keyEpoch`.

---

## 5. Encrypted real-time collaboration (Phase 5; Phase 4b if confidential mode is built)

- **Transport:** a **Cloudflare Durable Object per file**, deployed as a standalone Worker that hosts nothing else (ADR-017 as amended by ADR-020). It fans out opaque encrypted update blobs and **never holds a project key, never decrypts, merges, or interprets anything** — it is a fast relay that happens to sit in the right place. Supabase Realtime keeps Postgres change subscriptions only.
- **Relay authorization:** the DO holds **no database credentials** and never calls Supabase. Clients present a 60-second **relay ticket** — a JWT signed by Vercel _after_ an `is_project_member()` check, carrying `{ latexFileId, userId, projectId, docEpoch, exp }`. The DO verifies the signature against a public key in its environment and checks the binding. This keeps the membership decision on the side that owns the database and gives the relay the smallest possible trust surface: it can shuffle ciphertext for one file and nothing else.
- **Authorization on connect** is the critical control: the DO must verify the JWT _and_ re-check `is_project_member` per connection, not trust a token minted earlier. A long-lived WebSocket outlives a membership revocation otherwise — so also push a disconnect to that member's sockets when membership changes.
- **Persistence:** every update also appended to `DocUpdate` / `LatexUpdate` as ciphertext. The server never merges.
- **Awareness:** cursor positions and selections encrypted; presence _identity_ is server-visible metadata.
- **Compaction:** clients race on an advisory lock row; the winner merges locally with Yjs, writes `isSnapshot = true` with `supersedes = maxId`, and a background job deletes superseded rows **only after** verifying the snapshot exists. Trigger at >300 updates or >1 MB.
- **Rotation mid-document:** write a snapshot at the new epoch; older updates stay at their epoch.
- **Offline:** Yjs merges cleanly on reconnect — the main reason for a CRDT over OT. LaTeX is plain text and merges especially cleanly.

**Git objects (ADR-016).** All Git operations run client-side via `isomorphic-git`; the server can never build a commit because it cannot read the sources. Objects are encrypted under the project key and stored in the R2 `git-objects` bucket. Content-addressing uses the **plaintext** hash computed client-side, which preserves dedupe — and means the object _key_ leaks the plaintext hash. That is an accepted, bounded leak: it enables a confirmation attack only against an adversary who already possesses a candidate file, and it is the price of a functioning object store. Do not additionally leak filenames — tree objects are encrypted like everything else.

**GitHub linking is plaintext egress**, exactly like a Google Doc. A LaTeX project is in one of two states (`03-latex-studio.md` §8.4): **Private** (E2EE, local history only) or **GitHub-linked** (plaintext on GitHub, E2EE badge suppressed). Linking requires typed confirmation, is one-way per project, and is written to `AuditLog`. Do not display an encryption claim for a linked project — the guarantee is genuinely void there.

**Use a GitHub App, never an OAuth App** (ADR-018). An OAuth App with `repo` scope gets read-write on _every_ repository the user can see — the same disproportionate-access mistake `drive.file` avoids on the Google side. A GitHub App is installed per-repository with `contents: write`, `pull_requests: write`, `checks: read`, `metadata: read`, and the user can inspect and revoke it from GitHub's own settings, which is also the answer when a university asks what access the tool holds.

**Installation tokens live one hour and must never reach the browser.** Mint them server-side in a Worker and proxy every GitHub API call. A token in client code is a token in someone's devtools.

**Pulling is an external-content path**: enforce size caps, reject symlinks, validate every path in the tree against traversal, and never auto-resolve a `.tex` merge conflict — a silently mis-merged equation is worse than a visible conflict marker.

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

- Supabase Auth: email OTP + Google; SAML/OIDC in Phase 7. ORCID as a _linked_ identity for attribution, not a login provider.
- MFA required for `owner`/`admin` and all org admins.
- Short-lived access tokens, refresh rotation, server-side session revocation on member removal.
- Invite tokens: single-use, 72 h expiry, bound to the invited email, constant-time compare.

**Input & output**

- Zod at every boundary — parse, don't validate.
- Strict CSP with nonces; no `unsafe-inline`, no `unsafe-eval`. `wasm-unsafe-eval` **is** required for the crypto worker and the TeX engine — scope it to those workers, not the document.
- `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (also unlocks `SharedArrayBuffer`, which the TeX engine wants).
- Rich text sanitized on render, not on store — the server can't sanitize ciphertext anyway.

**Files (Cloudflare R2)**

- Private buckets only; no public bucket exists. **R2 has no row-level security**, so authorization moves up a layer: a Worker route validates the JWT, calls `app.is_project_member()`, then issues a **presigned GET with a 5-minute TTL**. `FileObject` is therefore not merely metadata — it is the access-control record, and a bug there is a data leak.
- **Uploads go client → R2 directly via a presigned PUT.** File bytes never traverse the Worker, sidestepping request-body and CPU limits entirely.
- Treat presigned URLs as bearer tokens: short TTL, never logged, never placed anywhere that could leak via a `Referer` header or analytics payload.
- A presigned PUT can succeed without the client reporting back, so a nightly job reconciles R2 keys against `FileObject.uploadState` and deletes orphans — otherwise a user can silently consume storage outside any quota.
- **`Cross-Origin-Resource-Policy: cross-origin` must be set on every `tex-dist` object.** Under COEP `require-corp` — which `SharedArrayBuffer` requires — cross-origin resources lacking CORP are blocked, and the WASM TeX engine fails to load its packages with an unhelpful error.
- pdf.js with `isEvalSupported: false`, scripting disabled, rendered in a sandboxed context. Enforce size, page, and magic-byte type checks.
- **Virus scanning is deferred to Phase 7.** This host has no long-running process to run ClamAV in. v1 relies on type validation, size caps, and sandboxed rendering; the residual risk is a malicious PDF downloaded and opened in a _native_ reader, which sandboxing does not cover. When an institution requires AV, run it as a queue consumer on a cheap VPS rather than reworking the host. **Do not claim files are scanned until it exists.**

**SSRF — the highest-risk server surface**
Users paste URLs and the server fetches them (DOI resolution, OA PDF fetch, Zotero import).

> **This got worse in v6, and the plan should say so.** On Cloudflare, `workerd` egressed through the edge with no VPC and no cloud metadata endpoint, so the `169.254.169.254` credential-theft class simply did not exist. **Vercel Functions run on AWS Lambda, where a link-local metadata endpoint does exist.** Moving to Vercel bought a great deal (see ADR-019) but it gave back this specific mitigation, and the SSRF controls below stop being defence-in-depth and become the _only_ defence.

Required, and now load-bearing rather than belt-and-braces:

- `https` only.
- **Resolve the hostname first, then check the resolved IP** against RFC1918, loopback, link-local (`169.254.0.0/16` explicitly), CGNAT, and IPv6 equivalents — checking the hostname string alone is defeated by a DNS record pointing at a private address.
- **Re-validate at every redirect hop**, not just the first, and cap redirect depth. DNS-rebinding and redirect-to-metadata are the two live attacks here.
- **Pin the connection to the validated address.** Resolving, checking, and then calling `fetch` still lets the runtime resolve a *second* time, and a hostile authoritative DNS server can change the answer in between — so the check applies to an address nothing connects to. Implemented in `packages/discovery/src/ssrf.ts` via an `undici` agent with an overridden `lookup`; the Host header and TLS SNI keep the original hostname, so certificate verification is unaffected. _Implemented Phase 1 week 2._
- Response size and time caps; never proxy an arbitrary URL back to the browser.
- Outbound fetches carry no ambient credentials — no `Authorization` header is ever attached to a user-supplied URL.

Consider routing user-URL fetches through a dedicated function with a distinct, minimal IAM identity, so an SSRF that succeeds steals nothing worth having.

**Rate limiting**
Per-user and per-IP on auth, invites, external API proxying, uploads, compiles, exports. Postgres token bucket is sufficient and free. Bulk imports run as queued jobs with progress, never in a request.

**Google Workspace (ADR-014)**

- **`drive.file` scope only.** Never `drive`, `drive.readonly`, or `spreadsheets`. Broad scopes are _restricted_ and trigger Google's CASA security assessment — a recurring five-figure annual third-party audit. `drive.file` covers files the app created plus files the user hands over through the **Picker API**, which is everything this product needs.
- Refresh tokens are encrypted at rest under a Worker secret (`GOOGLE_TOKEN_KEY`), **not** a project key — the nightly re-sync runs with no member present and cannot unwrap member-held keys. Rotate on disconnect; hard-delete on account deletion.
- **The two-sources-of-truth problem is the real risk here.** Drive ACLs and `ProjectMember` are independent, so removing someone from a project does not revoke their Drive access. Required: mirror membership → Drive permissions on every membership write; run a nightly three-way reconciliation across `ProjectMember`, `DocPermission`, and Drive's live ACL; surface real Drive permissions in the project UI rather than implying they match; log drift to `AuditLog` and treat it as a security finding, not a sync warning.
- Never write E2EE content into a Doc or Sheet. A `Message` or LaTeX source pushed to Google silently voids the encryption guarantee for that content. Enforce it in the push path, not in a code-review convention.
- Users must be told, at connect time and in the project UI, that Doc content is readable by Google and is outside Porcupine's encryption boundary.

**External APIs**
Send `mailto=` for OpenAlex/Crossref polite pools. Queue arXiv at 1 req / 3 s. Cache every response in `Work.raw` — one call per work, ever. Circuit-break on provider failure; degrade to the remaining providers rather than failing the search.

**Supply chain**
Lockfile committed, `npm ci` only, Dependabot, `npm audit --audit-level=high` as a CI gate. The crypto worker's dependency budget is libsodium and nothing else; review every addition by hand.

**Compliance**
GDPR: DPIA, data export, hard deletion (E2EE content becomes unreadable on key deletion — a clean deletion story), EU residency option. FERPA if US universities: student work is an educational record. Per-org retention; audit log retained ≥ 1 year. **External penetration test before v1.0 GA — budget for it.**

---

## 8. Incident response

Write this before launch: severity levels, on-call, a `security@` address, the 72-hour GDPR breach clock, and a public disclosure policy. For the encrypted tier specifically, a DB breach is materially less severe than for a normal SaaS — and being able to say that credibly, with the §2 tier table, is worth a great deal. That credibility only exists if the boundary was documented honestly from day one.
