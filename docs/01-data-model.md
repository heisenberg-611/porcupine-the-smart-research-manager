# Porcupine — Data Model

**v2** — updated for the confirmed encryption scope (E2EE = messages, documents, LaTeX only), no AI, and the LaTeX studio.

Prisma is the source of truth for DDL. RLS policies live in hand-written SQL migrations alongside it (`02-security-and-e2ee.md` §6).

---

## 1. Modelling rules

1. **Encrypted columns are `Bytes` with a `_ct` suffix**, always paired with `nonce` + `keyEpoch`. They appear on exactly three model families: `Message`, `Document`/`DocUpdate`, `LatexFile`. Nowhere else.
2. **Everything else is plaintext**, so Postgres can search, sort, filter, and aggregate it. This is what makes the evidence table fast.
3. **`projectId` is denormalized onto every project-scoped table.** RLS must never need a join to decide access — that is both slow and easy to get wrong.
4. **Soft-delete via `deletedAt`** on user content; hard-delete on join tables.
5. **Append-only tables** (`ActivityEvent`, `ContributionEvent`, `AuditLog`, `Message`) get select+insert policies only. The *absence* of update/delete policies is the enforcement.
6. Every table gets `createdAt`/`updatedAt`; user content gets `createdBy`.
7. File bytes never live in Postgres. `FileObject` is a pointer into Supabase Storage.

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
  documents     Document[]
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
/// Bytes live in Supabase Storage; this row is only a pointer.
model FileObject {
  id          String     @id @default(uuid()) @db.Uuid
  ownerId     String     @db.Uuid
  projectId   String?    @db.Uuid
  workId      String?    @db.Uuid
  bucket      String                            // "papers" | "attachments" | "latex-assets"
  storagePath String                            // {bucket}/{ownerId}/{uuid}.pdf
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

// ═══════════════════════ Synthesis (E2EE) ═══════════════════════

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

/// A synthesized statement with explicit provenance. Plaintext: it is the
/// bridge between the encrypted document layer and the searchable evidence layer,
/// and claim coverage per question must be aggregable.
model Claim {
  id         String      @id @default(uuid()) @db.Uuid
  projectId  String      @db.Uuid
  documentId String?     @db.Uuid
  questionId String?     @db.Uuid
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

**Client-side search (the E2EE tiers):** Orama index in IndexedDB over decrypted messages, documents, and LaTeX sources. Rebuilt incrementally on sync. Far more tractable than v1's design because it covers only the content the user actually opens.

**Hot indexes:**
- `Work(titleNorm, publishedYear)` + `pg_trgm` GIN on `Work.title` — import-time dedupe
- `ProjectWork(projectId, screenStatus)` and `(assigneeId)` — library view and my-queue
- `ExtractionValue(projectId)` + GIN on `valueText` — evidence table filtering and duplicate detection
- `Message(channelId, id)` and `DocUpdate(documentId, id)` — append-scan only
- Partition `ActivityEvent` and `AuditLog` by month past ~10M rows

**Evidence table performance:** a 300-work × 20-field protocol is 6,000 rows, all plaintext. Server-side filter/sort/paginate — sub-100 ms with the indexes above. (Under v1's full-E2EE design this required 6,000 client-side AEAD opens; that cost is now gone entirely.)

**Compaction targets:** keep live `DocUpdate`/`LatexUpdate` rows under ~500 per file. LaTeX files are plain text and compact well.

---

## 5. Migration discipline

- Migrations run against `DIRECT_URL` (port 5432); runtime uses the pooler (6543, `pgbouncer=true`, `connection_limit=1`).
- **Every migration creating a table must enable RLS and add policies in the same migration.** CI fails if any `public` table has `relrowsecurity = false`.
- `ProtocolField.key` is immutable once any `ExtractionValue` references it. Changing a field means a new `Protocol.version` plus an explicit UI migration prompt.
- Key epochs are never deleted — old ciphertext stays readable at its own epoch forever.
- `Work.citationKey` must be stable and globally unique; changing it breaks every `\cite{}` in every LaTeX project.
