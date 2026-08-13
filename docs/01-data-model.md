# Porcupine — Data Model

**v4** — encryption scope is E2EE = messages + LaTeX (prose moved to Google Docs, ADR-014); no AI; LaTeX studio; R2 storage; Google Workspace models.

Prisma is the source of truth for DDL. RLS policies live in hand-written SQL migrations alongside it (`02-security-and-e2ee.md` §6).

---

## 1. Modelling rules

1. **Encrypted columns are `Bytes` with a `_ct` suffix**, always paired with `nonce` + `keyEpoch`. They appear on exactly three model families: `Message`, `Document`/`DocUpdate`, `LatexFile`. Nowhere else.
2. **Everything else is plaintext**, so Postgres can search, sort, filter, and aggregate it. This is what makes the evidence table fast.
3. **`projectId` is denormalized onto every project-scoped table.** RLS must never need a join to decide access — that is both slow and easy to get wrong.
4. **Soft-delete via `deletedAt`** on user content; hard-delete on join tables.
5. **Append-only tables** (`ActivityEvent`, `ContributionEvent`, `AuditLog`, `Message`) get select+insert policies only. The *absence* of update/delete policies is the enforcement.
6. Every table gets `createdAt`/`updatedAt`; user content gets `createdBy`.
7. File bytes never live in Postgres. `FileObject` is a pointer into R2 **and the authorization record** — since R2 has no RLS, this table is the only thing that decides who may fetch a key.
8. All R2 access goes through a `StorageAdapter` interface (ADR-012 / decision #11). No `@aws-sdk` or R2 binding calls outside it.
9. *(v6)* Schema deltas required by `05-resolution-plan.md` are listed in §Appendix A at the end of this file. They are not optional — each one is load-bearing for a resolution.

---

## 2. Schema

```prisma
// ═══════════════════════ Identity & tenancy ═══════════════════════

model User {
  id            String   @id @db.Uuid          // = auth.users.id
  email         String   @unique
  displayName   String
  avatarUrl     String?
  orcid         String?  @unique
  affiliation   String?
  createdAt     DateTime @default(now())

  // E2EE identity — public halves only. Generated at signup from Phase 0,
  // even though nothing is encrypted until Phase 3.
  identityPubKey Bytes?    // X25519, for sealed-box key wrapping
  signingPubKey  Bytes?    // Ed25519, for signing key wraps
  wrappedBundle  Bytes?    // private keys sealed under the Master Key
  kdfSalt        Bytes?    // Argon2id salt — distinct from the auth password salt
  keyBundleVer   Int       @default(0)

  memberships   ProjectMember[]
  devices       Device[]
  orgMembers    OrgMember[]
}

model Device {
  id               String   @id @default(uuid()) @db.Uuid
  userId           String   @db.Uuid
  label            String                       // "MacBook Pro", "Pixel 8"
  devicePubKey     Bytes
  wrappedMasterKey Bytes                        // Master Key sealed to this device
  lastSeenAt       DateTime?
  revokedAt        DateTime?
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Organization {
  id            String   @id @default(uuid()) @db.Uuid
  name          String
  slug          String   @unique
  ssoProvider   String?                          // saml | oidc | null
  domain        String?                          // auto-join by email domain
  retentionDays Int?
  escrowEnabled Boolean  @default(false)         // opt-in, user-visible (ADR-001)
  escrowPubKey  Bytes?
  members       OrgMember[]
  projects      Project[]
}

model OrgMember {
  orgId  String  @db.Uuid
  userId String  @db.Uuid
  role   OrgRole @default(MEMBER)                // OWNER | ADMIN | MEMBER
  org    Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user   User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([orgId, userId])
}

// ═══════════════════════ Projects & membership ═══════════════════════

model Project {
  id              String      @id @default(uuid()) @db.Uuid
  orgId           String?     @db.Uuid
  slug            String
  title           String
  description     String?
  kind            ProjectKind @default(THESIS)   // THESIS | SYSTEMATIC_REVIEW | LAB_PAPER | GENERAL
  visibility      Visibility  @default(PRIVATE)
  assistEnabled   Boolean     @default(false)    // inert; reserved for future AI (plan §9)
  currentKeyEpoch Int         @default(1)
  archivedAt      DateTime?
  createdAt       DateTime    @default(now())

  org           Organization? @relation(fields: [orgId], references: [id])
  members       ProjectMember[]
  keys          ProjectKey[]
  questions     Question[]
  works         ProjectWork[]
  protocols     Protocol[]
  documents     Document[]      // Phase 4b confidential mode only
  linkedDocs    LinkedDoc[]
  sheetExports  SheetExport[]
  latexProjects LatexProject[]
  channels      Channel[]
  milestones    Milestone[]
  savedSearches SavedSearch[]

  @@unique([orgId, slug])
}

model ProjectMember {
  id            String        @id @default(uuid()) @db.Uuid
  projectId     String        @db.Uuid
  userId        String        @db.Uuid
  accessRole    AccessRole    @default(CONTRIBUTOR) // OWNER|ADMIN|CONTRIBUTOR|REVIEWER|OBSERVER
  functionRoles FunctionRole[]
  invitedBy     String?       @db.Uuid
  joinedAt      DateTime?
  removedAt     DateTime?

  /// Set by the prompt shown when adding a member after project creation.
  /// ALL_HISTORY (default) | FROM_JOIN — gates plaintext history and prior-epoch key re-wraps.
  historyAccess HistoryAccess @default(ALL_HISTORY)
  historyFrom   DateTime?                           // set when historyAccess = FROM_JOIN

  digestCadence DigestCadence @default(DAILY)       // NONE | DAILY | WEEKLY

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([projectId, userId])
  @@index([userId])
}

/// The project symmetric key sealed to one member's identity key.
/// One row per (project, member, epoch). Rotation = new epoch + N new rows.
model ProjectKey {
  id         String   @id @default(uuid()) @db.Uuid
  projectId  String   @db.Uuid
  userId     String   @db.Uuid
  epoch      Int
  wrappedKey Bytes                        // crypto_box_seal(projectKey, member.identityPubKey)
  wrappedBy  String   @db.Uuid
  signature  Bytes                        // Ed25519 over (projectId|userId|epoch|wrappedKey)
  createdAt  DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, userId, epoch])
  @@index([userId])
}

model Question {
  id        String  @id @default(uuid()) @db.Uuid
  projectId String  @db.Uuid
  parentId  String? @db.Uuid
  order     Int
  text      String                          // plaintext: drives keyword ranking + coverage views
  keywords  String[]                        // seeds relevance scoring (plan §9)

  project  Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  parent   Question?  @relation("QTree", fields: [parentId], references: [id])
  children Question[] @relation("QTree")

  @@index([projectId])
}

// ═══════════════════════ Bibliography (public) ═══════════════════════

/// Global, deduplicated, not project-scoped. Readable by any authenticated user.
model Work {
  id              String    @id @default(uuid()) @db.Uuid
  doi             String?   @unique
  arxivId         String?   @unique
  openalexId      String?   @unique
  pmid            String?   @unique
  titleNorm       String                        // lowercased, punctuation-stripped — dedupe key
  title           String
  abstract        String?   @db.Text
  authors         Json                          // [{name, orcid, affiliation, position}]
  venue           String?
  publishedYear   Int?
  publishedOn     DateTime?
  type            String?                       // article | preprint | thesis | book
  oaStatus        String?                       // gold|green|hybrid|closed (Unpaywall)
  oaPdfUrl        String?                       // set ONLY when verified open access
  citedByCount    Int       @default(0)
  referencedWorks String[]                      // OpenAlex IDs — citation graph / snowballing
  concepts        Json?
  citationKey     String?   @unique             // author_year_shorttitle → used by \cite{}
  fetchedAt       DateTime?
  raw             Json?                         // cached provider payloads; hit each API once, ever

  projectWorks ProjectWork[]

  @@index([titleNorm, publishedYear])
  @@index([openalexId])
}

/// A stored federated query. pg_cron re-runs it and diffs against known works.
model SavedSearch {
  id         String   @id @default(uuid()) @db.Uuid
  projectId  String   @db.Uuid
  name       String
  query      Json                              // terms, providers, filters, date range
  cadence    DigestCadence @default(WEEKLY)
  lastRunAt  DateTime?
  seenWorkIds String[] @db.Uuid                // suppress repeats
  createdBy  String   @db.Uuid

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@index([projectId])
}

/// A user's own copy of a file. NEVER shared across users (copyright — plan §5).
/// Bytes live in Cloudflare R2; this row is only a pointer and the authorization record.
/// R2 has no RLS, so downloads go: Worker validates JWT → is_project_member() →
/// presigned GET (5-min TTL). Uploads are presigned PUT direct from the browser.
model FileObject {
  id          String     @id @default(uuid()) @db.Uuid
  ownerId     String     @db.Uuid
  projectId   String?    @db.Uuid
  workId      String?    @db.Uuid
  bucket      String                            // papers | latex-assets | build-output
  storagePath String                            // {ownerId}/{uuid}.pdf — key within the bucket
  etag        String?                           // R2 ETag, set on upload completion
  uploadState UploadState @default(PENDING)     // PENDING|COMPLETE|ORPHANED — presigned PUT
                                                // can succeed without us hearing about it,
                                                // so a nightly job reconciles R2 against this table
  mimeType    String
  sizeBytes   Int
  sha256      String
  pageCount   Int?
  textStatus  TextStatus @default(PENDING)      // extracted text → FTS
  scanStatus  ScanStatus @default(PENDING)      // PENDING|CLEAN|INFECTED|FAILED
  createdAt   DateTime   @default(now())

  @@index([ownerId])
  @@index([projectId])
}

// ═══════════════════════ Corpus pipeline ═══════════════════════

model ProjectWork {
  id       String @id @default(uuid()) @db.Uuid
  projectId String @db.Uuid
  workId   String @db.Uuid
  addedBy  String @db.Uuid
  source   String                               // search | doi | bibtex | zotero | upload | snowball

  screenStatus  ScreenStatus @default(IDENTIFIED)
  excludeReason String?                         // controlled vocabulary
  readStatus    ReadStatus   @default(NOT_STARTED)
  priority      Int          @default(0)
  relevanceScore Float?                         // computed: citations + recency + question keywords
  assigneeId    String?      @db.Uuid
  dueAt         DateTime?
  readingPct    Int          @default(0)
  tags          String[]
  note          String?                         // plaintext

  project     Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  work        Work         @relation(fields: [workId], references: [id])
  questions   ProjectWorkQuestion[]
  annotations Annotation[]
  extractions Extraction[]

  @@unique([projectId, workId])
  @@index([projectId, screenStatus])
  @@index([assigneeId])
}

model ProjectWorkQuestion {
  projectWorkId String @db.Uuid
  questionId    String @db.Uuid
  relevance     Int    @default(0)              // -1 contradicts · 0 unset · 1..3 supports
  projectWork   ProjectWork @relation(fields: [projectWorkId], references: [id], onDelete: Cascade)
  @@id([projectWorkId, questionId])
}

/// Precise location in a source document.
/// Resolution order: character offsets → exact quote → fuzzy quote match.
model Anchor {
  id        String       @id @default(uuid()) @db.Uuid
  projectId String       @db.Uuid
  fileId    String?      @db.Uuid
  page      Int?
  quote     String                              // plaintext — enables FTS over cited passages
  prefix    String?
  suffix    String?
  startOff  Int?
  endOff    Int?
  rects     Json?                               // highlight geometry for the PDF layer
  section   String?
  status    AnchorStatus @default(OK)           // OK | DRIFTED | BROKEN

  @@index([projectId])
  @@index([fileId, page])
}

model Annotation {
  id            String               @id @default(uuid()) @db.Uuid
  projectId     String               @db.Uuid
  projectWorkId String               @db.Uuid
  anchorId      String               @db.Uuid
  authorId      String               @db.Uuid
  kind          AnnotationKind       @default(HIGHLIGHT) // HIGHLIGHT|NOTE|QUESTION|TODO
  color         String?
  body          String?                                  // plaintext — searchable
  visibility    AnnotationVisibility @default(PROJECT)    // PRIVATE | PROJECT
  createdAt     DateTime             @default(now())
  deletedAt     DateTime?

  projectWork ProjectWork @relation(fields: [projectWorkId], references: [id], onDelete: Cascade)

  @@index([projectWorkId])
  @@index([projectId, authorId])
}

// ═══════════════════════ Extraction protocol ═══════════════════════

model Protocol {
  id          String   @id @default(uuid()) @db.Uuid
  projectId   String   @db.Uuid
  name        String
  version     Int      @default(1)
  isActive    Boolean  @default(true)
  dualExtract Boolean  @default(false)           // require two independent extractions
  createdAt   DateTime @default(now())

  project Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  fields  ProtocolField[]

  @@unique([projectId, name, version])
}

model ProtocolField {
  id             String    @id @default(uuid()) @db.Uuid
  protocolId     String    @db.Uuid
  key            String                          // stable machine key — immutable once referenced
  label          String
  type           FieldType // TEXT|LONG_TEXT|NUMBER|BOOLEAN|ENUM|MULTI_ENUM|DATE|QUOTE|CITATION|URL
  options        Json?
  required       Boolean   @default(false)
  requiresAnchor Boolean   @default(false)       // force provenance on this field
  helpText       String?
  order          Int
  questionId     String?   @db.Uuid              // ties a field to a research question

  protocol Protocol @relation(fields: [protocolId], references: [id], onDelete: Cascade)

  @@unique([protocolId, key])
}

model Extraction {
  id             String           @id @default(uuid()) @db.Uuid
  projectId      String           @db.Uuid
  projectWorkId  String           @db.Uuid
  protocolId     String           @db.Uuid
  extractorId    String           @db.Uuid
  status         ExtractionStatus @default(DRAFT) // DRAFT|SUBMITTED|IN_CONFLICT|RECONCILED|VERIFIED
  origin         ExtractionOrigin @default(HUMAN) // inert hook; always HUMAN in v1
  reconciledFrom String[]         @db.Uuid
  verifiedBy     String?          @db.Uuid
  submittedAt    DateTime?
  createdAt      DateTime         @default(now())

  projectWork ProjectWork       @relation(fields: [projectWorkId], references: [id], onDelete: Cascade)
  values      ExtractionValue[]

  @@unique([projectWorkId, protocolId, extractorId])
  @@index([projectId, status])
}

model ExtractionValue {
  id           String   @id @default(uuid()) @db.Uuid
  projectId    String   @db.Uuid
  extractionId String   @db.Uuid
  fieldId      String   @db.Uuid
  value        Json                             // typed value — plaintext, so the DB can sort/filter
  valueText    String?                          // flattened for FTS + trigram similarity
  anchorId     String?  @db.Uuid                // required when field.requiresAnchor
  updatedAt    DateTime @updatedAt

  extraction Extraction @relation(fields: [extractionId], references: [id], onDelete: Cascade)

  @@unique([extractionId, fieldId])
  @@index([projectId])
}

/// Saved view over extractions — the "sheet". Derived, never authoritative.
model TableView {
  id         String  @id @default(uuid()) @db.Uuid
  projectId  String  @db.Uuid
  name       String
  protocolId String  @db.Uuid
  config     Json                               // columns, filters, sort, grouping, pivot
  createdBy  String  @db.Uuid
  isShared   Boolean @default(true)
}

// ═══════════════════════ Synthesis ═══════════════════════

/// DEFERRED — Phase 4b "confidential mode" only. Prose normally lives in
/// Google Docs (LinkedDoc). Build these tables when an institution refuses
/// Google Drive, not before. Kept in the schema so Claim.documentId has a
/// stable target and the Claims panel stays editor-agnostic.
model Document {
  id         String    @id @default(uuid()) @db.Uuid
  projectId  String    @db.Uuid
  title      String                             // plaintext for navigation
  kind       DocKind   @default(NOTE)           // NOTE|LITERATURE_REVIEW|PROTOCOL|CHAPTER
  createdBy  String    @db.Uuid
  archivedAt DateTime?

  project Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  updates DocUpdate[]
}

/// Encrypted Yjs updates. The server is a dumb append-only relay.
/// Compaction is performed by an elected client (02-security §5).
model DocUpdate {
  id         BigInt   @id @default(autoincrement())
  documentId String   @db.Uuid
  projectId  String   @db.Uuid
  authorId   String   @db.Uuid
  update_ct  Bytes
  nonce      Bytes
  keyEpoch   Int
  isSnapshot Boolean  @default(false)
  supersedes BigInt?
  createdAt  DateTime @default(now())

  document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId, id])
}

/// A synthesized statement with explicit provenance. Native and plaintext —
/// this is the differentiator (ADR-014 decision #14). Deliberately NOT stored
/// inside any document, so the prose surface (Google Docs, native, LaTeX)
/// can be swapped without touching the claim→evidence graph.
model Claim {
  id          String     @id @default(uuid()) @db.Uuid
  projectId   String     @db.Uuid
  documentId  String?    @db.Uuid              // Phase 4b native doc
  linkedDocId String?    @db.Uuid              // Google Doc this was pushed into
  pushedAt    DateTime?                        // last time its text reached a prose surface
  questionId  String?    @db.Uuid
  text       String
  stance     ClaimStance @default(NEUTRAL)      // SUPPORTS|REFUTES|MIXED|NEUTRAL
  status     ClaimStatus @default(DRAFT)        // DRAFT|NEEDS_SUPPORT|SUPPORTED|STALE
  createdBy  String      @db.Uuid

  evidence ClaimEvidence[]

  @@index([projectId, questionId])
}

model ClaimEvidence {
  id                String  @id @default(uuid()) @db.Uuid
  claimId           String  @db.Uuid
  projectId         String  @db.Uuid
  annotationId      String? @db.Uuid
  extractionValueId String? @db.Uuid
  weight            Int     @default(1)
  addedBy           String  @db.Uuid

  claim Claim @relation(fields: [claimId], references: [id], onDelete: Cascade)
  @@index([claimId])
}

// ═══════════════════════ LaTeX studio (E2EE) ═══════════════════════

model LatexProject {
  id         String   @id @default(uuid()) @db.Uuid
  projectId  String   @db.Uuid
  name       String
  rootFile   String   @default("main.tex")
  engine     TexEngine @default(PDFLATEX)       // PDFLATEX | XELATEX | LUALATEX
  bibStyle   String?   @default("ieeetr")
  template   String?                            // ieee | acm | springer | thesis-generic
  /// Regenerated from the project corpus; users never hand-edit it.
  bibAutoSync Boolean  @default(true)
  createdBy  String    @db.Uuid
  createdAt  DateTime  @default(now())

  project Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  files   LatexFile[]
  builds  CompileJob[]
}

model LatexFile {
  id             String   @id @default(uuid()) @db.Uuid
  latexProjectId String   @db.Uuid
  projectId      String   @db.Uuid
  path           String                          // "main.tex", "sections/intro.tex"
  isBinary       Boolean  @default(false)        // images live in Storage, not here
  fileObjectId   String?  @db.Uuid               // set when isBinary
  content_ct     Bytes?                          // E2EE source text (text files only)
  nonce          Bytes?
  keyEpoch       Int?
  updatedAt      DateTime @updatedAt

  latexProject LatexProject @relation(fields: [latexProjectId], references: [id], onDelete: Cascade)
  updates      LatexUpdate[]

  @@unique([latexProjectId, path])
}

/// Encrypted Yjs updates for collaborative editing of one .tex file.
model LatexUpdate {
  id          BigInt   @id @default(autoincrement())
  latexFileId String   @db.Uuid
  projectId   String   @db.Uuid
  authorId    String   @db.Uuid
  update_ct   Bytes
  nonce       Bytes
  keyEpoch    Int
  isSnapshot  Boolean  @default(false)
  supersedes  BigInt?
  createdAt   DateTime @default(now())

  latexFile LatexFile @relation(fields: [latexFileId], references: [id], onDelete: Cascade)
  @@index([latexFileId, id])
}

/// Maps a Yjs clientID to a real user so character-level authorship can be
/// resolved (latex-studio §8.2). Written on connect BEFORE the first update is
/// accepted — if this row is missing, that session's edits are permanently
/// unattributable. Durable data, never garbage-collected.
model YjsClient {
  id          String   @id @default(uuid()) @db.Uuid
  projectId   String   @db.Uuid
  /// Yjs clientID is a random uint32 chosen per session — unique only per doc.
  clientId    BigInt
  docKind     YDocKind                        // LATEX_FILE | DOCUMENT
  docId       String   @db.Uuid               // latexFileId or documentId
  userId      String   @db.Uuid
  connectedAt DateTime @default(now())
  lastSeenAt  DateTime?

  @@unique([docKind, docId, clientId])
  @@index([projectId, userId])
}

/// A labelled point in a document's history. Surfaces as a version in the UI
/// and as a Git tag once materialized. The Yjs state vector is what makes
/// "restore to here" and "diff against here" possible.
model Snapshot {
  id           String   @id @default(uuid()) @db.Uuid
  projectId    String   @db.Uuid
  docKind      YDocKind
  docId        String   @db.Uuid
  label        String?                        // null = automatic idle snapshot
  stateVector_ct Bytes                        // Y.snapshot(), encrypted
  nonce        Bytes
  keyEpoch     Int
  updateHwm    BigInt                         // highest LatexUpdate.id included
  createdBy    String   @db.Uuid
  createdAt    DateTime @default(now())

  @@index([docKind, docId, createdAt])
}

/// Git is a materialized projection of Yjs, never the source of truth
/// (latex-studio §8.1). Objects live encrypted in the R2 `git-objects` bucket;
/// this table holds only refs and commit metadata so history can be listed
/// without decrypting the whole repo.
model GitRepo {
  id             String    @id @default(uuid()) @db.Uuid
  latexProjectId String    @unique @db.Uuid
  projectId      String    @db.Uuid
  defaultBranch  String    @default("main")

  /// PRIVATE = E2EE, local history only. GITHUB_LINKED = plaintext on GitHub,
  /// E2EE badge suppressed in the UI (latex-studio §8.4). One-way per project.
  mode           RepoMode  @default(PRIVATE)

  installationId String?   @db.Uuid            // → GitHubInstallation
  remoteOwner    String?                       // "my-lab"
  remoteRepo     String?                       // "thesis-2027"
  remoteLinkedBy String?   @db.Uuid
  remoteLinkedAt DateTime?
  lastFetchAt    DateTime?
  lastPushAt     DateTime?
  /// Divergence counters, refreshed on fetch. Surfaced as "N ahead, M behind".
  /// Never acted on automatically — see §8.7.
  aheadCount     Int       @default(0)
  behindCount    Int       @default(0)
  objectCount    Int       @default(0)
  packedAt       DateTime?

  commits      GitCommit[]
  pullRequests PullRequest[]
}

/// A GitHub App installation. App — not OAuth App — so access is per-repository
/// and revocable from GitHub's own settings (latex-studio §8.6).
/// Installation tokens live 1 hour and are minted server-side in a Worker;
/// they are NEVER sent to the browser. All GitHub API calls are proxied.
model GitHubInstallation {
  id              String   @id @default(uuid()) @db.Uuid
  userId          String   @db.Uuid
  githubInstallId BigInt   @unique
  accountLogin    String                        // org or user the app is installed on
  accountType     String                        // User | Organization
  /// Repos the user selected during installation. Empty = all repos on that
  /// account, which the UI should discourage.
  selectedRepos   String[]
  permissions     Json                          // as reported by GitHub, for display
  installedAt     DateTime @default(now())
  suspendedAt     DateTime?
  revokedAt       DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

/// Cached PR metadata so the panel renders without hammering the API.
/// GitHub owns the truth; this is a read-through cache with a short TTL.
model PullRequest {
  id           String   @id @default(uuid()) @db.Uuid
  gitRepoId    String   @db.Uuid
  projectId    String   @db.Uuid
  number       Int
  title        String
  state        String                          // open | closed | merged
  isDraft      Boolean  @default(false)
  headBranch   String
  baseBranch   String
  authorLogin  String
  authorUserId String?  @db.Uuid               // resolved to a member when possible
  checksState  String?                         // success | failure | pending | null
  mergeable    Boolean?
  reviewState  String?                         // approved | changes_requested | pending
  githubUrl    String
  syncedAt     DateTime @default(now())

  repo GitRepo @relation(fields: [gitRepoId], references: [id], onDelete: Cascade)

  @@unique([gitRepoId, number])
  @@index([projectId, state])
}

model GitCommit {
  id         String   @id @default(uuid()) @db.Uuid
  gitRepoId  String   @db.Uuid
  projectId  String   @db.Uuid
  /// Computed client-side over PLAINTEXT, so content-addressing and dedupe
  /// still work even though stored objects are encrypted.
  sha        String
  parentShas String[]
  branch     String
  /// Primary author; everyone else lands in coAuthorIds and as
  /// Co-authored-by: trailers in the commit message.
  authorId   String   @db.Uuid
  coAuthorIds String[] @db.Uuid
  message    String
  trigger    CommitTrigger @default(IDLE)     // IDLE | MANUAL | TAG | MERGE
  snapshotId String?  @db.Uuid
  committedAt DateTime

  repo GitRepo @relation(fields: [gitRepoId], references: [id], onDelete: Cascade)

  @@unique([gitRepoId, sha])
  @@index([projectId, committedAt])
}

/// Compiles run in the browser (WASM). This row records the outcome so
/// collaborators can see the last successful build without recompiling.
model CompileJob {
  id             String       @id @default(uuid()) @db.Uuid
  latexProjectId String       @db.Uuid
  projectId      String       @db.Uuid
  triggeredBy    String       @db.Uuid
  status         CompileStatus @default(RUNNING) // RUNNING|SUCCESS|FAILED
  engine         TexEngine
  durationMs     Int?
  pdfFileId      String?      @db.Uuid           // encrypted PDF in Storage
  logSummary     Json?                            // {errors:[{file,line,msg}], warnings:n}
  createdAt      DateTime     @default(now())

  latexProject LatexProject @relation(fields: [latexProjectId], references: [id], onDelete: Cascade)
  @@index([latexProjectId, createdAt])
}

// ═══════════════════════ Google Workspace (ADR-014) ═══════════════════════

/// One connected Google identity per user. Refresh token is the sensitive part —
/// encrypted with a server-side key (NOT a project key; the Worker must use it
/// without a member present, e.g. during a nightly re-sync).
model GoogleAccount {
  id             String   @id @default(uuid()) @db.Uuid
  userId         String   @unique @db.Uuid
  googleSub      String   @unique              // stable Google user id
  email          String
  refreshToken_ct Bytes                        // AEAD under GOOGLE_TOKEN_KEY (Worker secret)
  nonce          Bytes
  scopes         String[]                      // expect exactly ["drive.file"]
  connectedAt    DateTime @default(now())
  revokedAt      DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

/// A Google Doc bound to a project. Content lives at Google — we store the
/// pointer, the sync state, and the permission mirror.
model LinkedDoc {
  id           String    @id @default(uuid()) @db.Uuid
  projectId    String    @db.Uuid
  googleFileId String    @unique
  title        String
  kind         DocKind   @default(NOTE)        // NOTE|LITERATURE_REVIEW|PROTOCOL|CHAPTER
  createdBy    String    @db.Uuid
  webViewLink  String
  /// Set when Porcupine created the file — determines whether drive.file still
  /// grants us access, or whether the user must re-pick it via the Picker.
  appCreated   Boolean   @default(true)
  lastModified DateTime?
  lastCommentSync DateTime?
  archivedAt   DateTime?

  project  Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  grants   DocPermission[]

  @@index([projectId])
}

/// Mirror of the Drive ACL. The nightly reconciler compares this to Drive's
/// actual state AND to ProjectMember; any three-way disagreement is a finding.
model DocPermission {
  id             String   @id @default(uuid()) @db.Uuid
  linkedDocId    String   @db.Uuid
  userId         String?  @db.Uuid             // null if the grant is to a non-member
  email          String
  googlePermId   String
  role           String                        // reader | commenter | writer
  mirroredAt     DateTime @default(now())
  driftDetectedAt DateTime?

  linkedDoc LinkedDoc @relation(fields: [linkedDocId], references: [id], onDelete: Cascade)

  @@unique([linkedDocId, googlePermId])
}

/// Comments pulled back from Drive into the supervisor review queue.
/// Cached, not authoritative — Google owns the thread.
model DocComment {
  id            String   @id @default(uuid()) @db.Uuid
  linkedDocId   String   @db.Uuid
  projectId     String   @db.Uuid
  googleCommentId String
  authorEmail   String
  authorUserId  String?  @db.Uuid              // resolved to a member when possible
  quotedText    String?
  content       String
  resolved      Boolean  @default(false)
  googleCreatedAt DateTime
  syncedAt      DateTime @default(now())

  linkedDoc LinkedDoc @relation(fields: [linkedDocId], references: [id], onDelete: Cascade)

  @@unique([linkedDocId, googleCommentId])
  @@index([projectId, resolved])
}

/// One spreadsheet per project: Corpus tab + Evidence tab. Re-sync is idempotent.
model SheetExport {
  id             String   @id @default(uuid()) @db.Uuid
  projectId      String   @db.Uuid
  googleFileId   String   @unique
  webViewLink    String
  protocolId     String?  @db.Uuid             // which Protocol the Evidence tab reflects
  /// Highest column index Porcupine writes. Anything to the right belongs to the
  /// user and must never be overwritten.
  ownedColumns   Int      @default(0)
  cadence        DigestCadence @default(NONE)  // NONE = manual push only
  lastSyncedAt   DateTime?
  lastSyncStatus String?
  rowCount       Int      @default(0)
  createdBy      String   @db.Uuid

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}

// ═══════════════════════ Messaging (E2EE) ═══════════════════════

model Channel {
  id        String      @id @default(uuid()) @db.Uuid
  projectId String?     @db.Uuid                 // null = cross-project DM
  kind      ChannelKind @default(PROJECT)        // PROJECT | TOPIC | DM
  name      String?                              // null for DMs
  topic     String?
  createdBy String      @db.Uuid
  createdAt DateTime    @default(now())

  project  Project?         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  members  ChannelMember[]
  messages Message[]

  @@index([projectId])
}

model ChannelMember {
  channelId  String    @db.Uuid
  userId     String    @db.Uuid
  lastReadId BigInt?
  mutedUntil DateTime?
  channel    Channel   @relation(fields: [channelId], references: [id], onDelete: Cascade)
  @@id([channelId, userId])
  @@index([userId])
}

/// Append-only. No update or delete policy exists — edits insert a new row
/// with `editsId`, deletions insert a tombstone.
model Message {
  id        BigInt   @id @default(autoincrement())
  channelId String   @db.Uuid
  projectId String?  @db.Uuid
  authorId  String   @db.Uuid
  body_ct   Bytes
  nonce     Bytes
  keyEpoch  Int
  replyToId BigInt?                              // threading
  editsId   BigInt?
  tombstone Boolean  @default(false)
  mentions  String[] @db.Uuid                    // plaintext: needed for notification routing
  attachmentIds String[] @db.Uuid
  createdAt DateTime @default(now())

  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@index([channelId, id])
}

// ═══════════════════════ Collaboration & oversight ═══════════════════════

model Thread {
  id         String       @id @default(uuid()) @db.Uuid
  projectId  String       @db.Uuid
  targetType ThreadTarget // DOCUMENT_BLOCK|LATEX_LINE|EXTRACTION_VALUE|ANNOTATION|PROJECT_WORK|CLAIM
  targetId   String       @db.Uuid
  kind       ThreadKind   @default(COMMENT)      // COMMENT | SUGGESTION
  status     ThreadStatus @default(OPEN)         // OPEN|RESOLVED|ACCEPTED|REJECTED
  createdBy  String       @db.Uuid
  resolvedBy String?      @db.Uuid
  createdAt  DateTime     @default(now())

  comments Comment[]

  @@index([projectId, targetType, targetId])
  @@index([projectId, status])
}

/// Comments on plaintext targets store `body`; comments on encrypted targets
/// (DOCUMENT_BLOCK, LATEX_LINE) store `body_ct`. Exactly one is set — enforced
/// by a CHECK constraint keyed off the parent thread's targetType.
model Comment {
  id        String   @id @default(uuid()) @db.Uuid
  threadId  String   @db.Uuid
  projectId String   @db.Uuid
  authorId  String   @db.Uuid
  body      String?
  body_ct   Bytes?
  patch_ct  Bytes?                               // SUGGESTION threads: the proposed change
  nonce     Bytes?
  keyEpoch  Int?
  mentions  String[] @db.Uuid
  createdAt DateTime @default(now())
  editedAt  DateTime?

  thread Thread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  @@index([threadId])
}

model Milestone {
  id              String    @id @default(uuid()) @db.Uuid
  projectId       String    @db.Uuid
  title           String
  dueAt           DateTime
  kind            String?                        // proposal|committee|defense|submission
  targetScreened  Int?
  targetExtracted Int?
  completedAt     DateTime?

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

/// Append-only.
model ActivityEvent {
  id         BigInt   @id @default(autoincrement())
  projectId  String   @db.Uuid
  actorId    String   @db.Uuid
  verb       String                              // work.added, extraction.submitted, latex.compiled
  targetType String
  targetId   String   @db.Uuid
  meta       Json?                               // ids and counts only — never message/doc content
  createdAt  DateTime @default(now())

  @@index([projectId, createdAt])
  @@index([actorId, createdAt])
}

/// Append-only. Rolls up into a CRediT contribution profile.
model ContributionEvent {
  id         BigInt     @id @default(autoincrement())
  projectId  String     @db.Uuid
  userId     String     @db.Uuid
  credit     CreditRole // CONCEPTUALIZATION, DATA_CURATION, FORMAL_ANALYSIS, INVESTIGATION,
                        // METHODOLOGY, PROJECT_ADMINISTRATION, SOFTWARE, SUPERVISION,
                        // VALIDATION, VISUALIZATION, WRITING_ORIGINAL, WRITING_REVIEW
  weight     Float      @default(1)
  sourceType String
  sourceId   String
  createdAt  DateTime   @default(now())

  @@index([projectId, userId])
}

model AuditLog {
  id        BigInt   @id @default(autoincrement())
  actorId   String?  @db.Uuid
  projectId String?  @db.Uuid
  action    String                               // key.rotated, member.removed, export.created
  ip        String?
  userAgent String?
  meta      Json?
  createdAt DateTime @default(now())

  @@index([projectId, createdAt])
}
```

---

## 3. Derived views (SQL, not Prisma)

All of these are now possible server-side, because the data they aggregate is plaintext:

- `v_project_progress` — counts per `screenStatus`/`readStatus`; feeds dashboards and burndown.
- `v_prisma_flow` — identified / duplicates removed / screened / excluded-with-reasons / included. Renders the PRISMA 2020 diagram directly.
- `v_extraction_agreement` — per (projectWork, protocol): submitted count, conflict state, **and Cohen's κ computed in SQL** — possible only because extraction values are plaintext.
- `v_member_contribution` — `ContributionEvent` rolled up per member per CRediT role.
- `v_reading_velocity` — works reaching `extracted` per week, joined against `Milestone` for risk flags.
- `v_project_bib` — every included `ProjectWork` → CSL-JSON + BibTeX, keyed by `Work.citationKey`. **This is what generates `references.bib` for the LaTeX studio.**

---

## 4. Search, indexing, performance

**Server-side FTS (the plaintext tiers):**
```sql
alter table work add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(abstract,'')), 'B')
  ) stored;
create index work_search_idx on work using gin (search_tsv);
create index annotation_search_idx on annotation using gin (to_tsvector('english', coalesce(body,'')));
create index anchor_quote_trgm on anchor using gin (quote gin_trgm_ops);
```
This covers works, annotations, cited passages, and extraction values in one query surface.

**Client-side search (the E2EE tiers):** Orama index in IndexedDB over decrypted messages and LaTeX sources. Rebuilt incrementally on sync. Small surface now that prose lives in Google Docs — which is searchable in Drive, not here. Cached `DocComment` rows *are* server-side searchable, so supervisor feedback stays findable.

**Hot indexes:**
- `Work(titleNorm, publishedYear)` + `pg_trgm` GIN on `Work.title` — import-time dedupe
- `ProjectWork(projectId, screenStatus)` and `(assigneeId)` — library view and my-queue
- `ExtractionValue(projectId)` + GIN on `valueText` — evidence table filtering and duplicate detection
- `Message(channelId, id)` and `DocUpdate(documentId, id)` — append-scan only
- Partition `ActivityEvent` and `AuditLog` by month past ~10M rows

**Evidence table performance:** a 300-work × 20-field protocol is 6,000 rows, all plaintext. Server-side filter/sort/paginate — sub-100 ms with the indexes above. (Under v1's full-E2EE design this required 6,000 client-side AEAD opens; that cost is now gone entirely.)

**Compaction targets:** keep live `DocUpdate`/`LatexUpdate` rows under ~500 per file. LaTeX files are plain text and compact well.

**Attribution queries.** The blame gutter resolves `clientId → userId` for every visible line on each render, so `YjsClient(docKind, docId, clientId)` must be a covering unique index and the whole per-document set should be fetched once and held in memory — it is small (one row per session) and hot. Never query it per line.

**Git object storage.** Objects are content-addressed on plaintext hashes and stored encrypted in R2 under `git-objects/{projectId}/{sha[0:2]}/{sha[2:]}`. Unchanged files across commits dedupe to the same key, so a 5 MB thesis committed 200 times costs far less than 1 GB. `GitCommit` exists so history can be listed and filtered in SQL without pulling objects; the objects themselves are only fetched when a diff or checkout is requested.

---

## 5. Migration discipline

- Migrations run against `DIRECT_URL` (port 5432) from CI on Node — `migrate deploy` issues `SET session_replication_role` and **cannot** run through a transaction pooler. Runtime queries reach Postgres through the **Supavisor transaction pooler** (6543, `pgbouncer=true`, `connection_limit=1`) directly from Vercel's Node runtime. *(v6: Hyperdrive removed with ADR-011; see ADR-019.)*
- Any RLS-scoped Prisma query goes through `withUserContext(jwt, fn)`, which opens a `$transaction` and issues `set_config('request.jwt.claims', …, true)` as its first statement. The trailing `true` means `SET LOCAL` — **Postgres itself reverts it at commit or rollback**, so the isolation guarantee does not depend on pooler behaviour. With no claim set, every policy predicate evaluates NULL and returns zero rows: the failure mode is fail-closed. See `05-resolution-plan.md` R-02.
- **Every migration creating a table must enable RLS and add policies in the same migration.** CI fails if any `public` table has `relrowsecurity = false`.
- `ProtocolField.key` is immutable once any `ExtractionValue` references it. Changing a field means a new `Protocol.version` plus an explicit UI migration prompt.
- Key epochs are never deleted — old ciphertext stays readable at its own epoch forever.
- `Work.citationKey` must be stable and globally unique; changing it breaks every `\cite{}` in every LaTeX project.

---

## Appendix A — v6 schema deltas (required by `05-resolution-plan.md`)

Each of these is load-bearing for a specific resolution. None is optional.

**R-01 — the `docEpoch` protocol.** Without these three, cross-epoch Yjs replay is possible and manuscripts corrupt silently.

```prisma
model LatexFile {
  // ...
  docEpoch   Int  @default(0)   // bumped by every completed pull
}

model LatexUpdate {
  // ...
  docEpoch   Int                // MUST equal LatexFile.docEpoch to be applied
  @@index([latexFileId, docEpoch, seq])
}

model GitCommit {
  // ...
  isAnchor   Boolean @default(false)  // materialized from Yjs at PULL_BEGIN
  atEpoch    Int                      // the epoch this commit was anchored from
}
```

Client-side, the IndexedDB Yjs provider is keyed `"<docId>:<docEpoch>"`. This is what makes a stale op *unreachable* rather than merely rejected.

**R-04 — storage residency.** OA-verified files dedupe; paywalled files never reach R2.

```prisma
enum Residency { R2_SHARED  R2_USER  DEVICE_ONLY }

model FileObject {
  // ...
  residency     Residency @default(R2_USER)
  contentHash   String?   // SHA-256; the dedupe key for R2_SHARED only
  oaVerified    Boolean   @default(false)  // Unpaywall confirmed redistributable
  @@index([contentHash])
}
```

**R-05 — the single review queue.** No feedback surface ships without a writer into this table.

```prisma
enum ReviewSource { EXTRACTION_THREAD  DRIVE_COMMENT  GITHUB_REVIEW  LATEX_COMMENT  MILESTONE }

model ReviewItem {
  id          String       @id @default(uuid()) @db.Uuid
  projectId   String       @db.Uuid       // denormalized, so RLS needs no join
  source      ReviewSource
  authorId    String?      @db.Uuid       // null when the author is external to Porcupine
  assigneeId  String?      @db.Uuid
  excerpt     String                       // plaintext summary; never the E2EE body
  deepLink    String                       // back to the originating surface
  createdAt   DateTime     @default(now())
  resolvedAt  DateTime?
  @@index([projectId, assigneeId, resolvedAt])
}
```

**R-06 / R-09 — persona and ownership branching.**

```prisma
enum OwnershipModel { STUDENT_OWNED  LAB_OWNED }

model Project {
  // ...
  ownershipModel OwnershipModel @default(STUDENT_OWNED)
  // Project.kind already exists; capabilities(kind) now gates UI, not just labels it
}
```

**R-14 — FTS language.** Decide in Phase 1; retrofitting a generated column across a large table is an outage.

```prisma
model Work {
  // ...
  language  String?   // from provider metadata; tsvector uses 'simple', never 'english'
}
```

**R-15 — preprint vs published.** Take the relationship from OpenAlex; never infer it.

```prisma
model Work {
  // ...
  versionOfId String?  @db.Uuid
  versionOf   Work?    @relation("WorkVersions", fields: [versionOfId], references: [id])
  versions    Work[]   @relation("WorkVersions")
}
```

**R-07 — what to delete.** Any model or column holding a contribution *score*, percentage, or character/line volume aggregated across members. The CRediT ledger keeps role assignments and activity-kind evidence only. `YjsClient` stays (the blame gutter needs it) but is never aggregated, exported, or exposed to another member.
