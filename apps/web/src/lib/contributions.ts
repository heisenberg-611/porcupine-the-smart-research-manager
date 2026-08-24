export type ActivityActionType =
  | "SCREENING"
  | "EXTRACTION"
  | "COLLECTION"
  | "QUESTION"
  | "PROTOCOL"
  | "ANNOTATION"
  | "RECONCILIATION"
  | "LOGIN"
  | "LOGOUT";

export interface ProjectActivityEvent {
  id: string;
  type: ActivityActionType;
  actorId: string;
  actorName: string;
  actorEmail: string;
  action: string;
  targetTitle: string;
  targetHref?: string | undefined;
  details?: string | undefined;
  timestamp: string; // ISO string
}

export interface MemberContributionStats {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string | null;
  lastActiveAt: string | null;

  // Screening
  screenedTotal: number;
  screenedIncluded: number;
  screenedExcluded: number;
  screenedMaybe: number;

  // Extraction
  extractedPapers: number;
  extractedFields: number;
  submittedExtractions: number;
  verifiedExtractions: number;

  // Collection & Formulating
  papersImported: number;
  questionsCreated: number;
  protocolsCreated: number;

  // Synthesis & Annotations
  annotationsCount: number;
  reconciliationsCount: number;

  // Aggregated Score & Share
  totalActionsCount: number;
  contributionScore: number;
  percentageShare: number;
}

export interface ContributionHeatmapDay {
  date: string; // YYYY-MM-DD
  count: number;
  intensity: 0 | 1 | 2 | 3 | 4;
}

export interface ContributionHeatmapData {
  days: ContributionHeatmapDay[];
  totalActions: number;
  currentStreak: number;
  longestStreak: number;
  peakDay: { date: string; count: number } | null;
}

export interface ProjectContributionsData {
  members: MemberContributionStats[];
  events: ProjectActivityEvent[];
  heatmap: ContributionHeatmapData;
  totalProjectActions: number;
  activeContributorsCount: number;
}

// ── Raw input types from DB queries ─────────────────────────────────────────

export interface RawMember {
  id: string;
  user_id: string;
  access_role: string;
  joined_at: string | null;
  users: { display_name: string | null; email: string } | null;
}

export interface RawScreeningDecision {
  id: string;
  project_work_id: string;
  decided_by: string;
  from_status?: string | null;
  to_status: string;
  exclude_reason?: string | null;
  note: string | null;
  created_at: string;
  works?: { title?: string | null } | null;
  users?: { display_name?: string | null; email?: string } | null;
}

export interface RawExtraction {
  id: string;
  project_work_id: string;
  extractor_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  works?: { title?: string | null } | null;
  users?: { display_name?: string | null; email?: string } | null;
  field_count?: number;
}

export interface RawProjectWork {
  id: string;
  added_by: string | null;
  created_at: string;
  screen_status: string;
  works?: { title?: string | null } | null;
  users?: { display_name?: string | null; email?: string } | null;
}

export interface RawQuestion {
  id: string;
  title: string;
  created_by: string | null;
  created_at: string;
  users?: { display_name?: string | null; email?: string } | null;
}

export interface RawProtocol {
  id: string;
  name: string;
  version: number;
  created_by: string | null;
  created_at: string;
  users?: { display_name?: string | null; email?: string } | null;
}

export interface RawAnnotation {
  id: string;
  project_work_id: string;
  created_by: string | null;
  created_at: string;
  comment: string | null;
  works?: { title?: string | null } | null;
  users?: { display_name?: string | null; email?: string } | null;
}

export interface RawReconciliation {
  id: string;
  project_work_id: string;
  reconciled_by: string | null;
  reconciled_at: string | null;
  works?: { title?: string | null } | null;
  users?: { display_name?: string | null; email?: string } | null;
}

export interface RawDevice {
  id: string;
  user_id: string;
  label: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  users?: { display_name?: string | null; email?: string } | null;
}

export interface RawAuthSession {
  userId: string;
  type: "LOGIN" | "LOGOUT";
  action: string;
  label?: string | null;
  timestamp: string;
}

export interface AggregateInputs {
  projectId: string;
  members: RawMember[];
  screeningDecisions: RawScreeningDecision[];
  extractions: RawExtraction[];
  extractionValuesCountByExtractor?: Record<string, number>;
  projectWorks: RawProjectWork[];
  questions: RawQuestion[];
  protocols: RawProtocol[];
  annotations: RawAnnotation[];
  reconciliations: RawReconciliation[];
  devices?: RawDevice[];
  authSessions?: RawAuthSession[];
}

/**
 * Pure function: Aggregates all project contributions across team members,
 * generates the unified micro-action audit feed, and computes the activity heatmap.
 */
export function aggregateProjectContributions(
  inputs: AggregateInputs,
): ProjectContributionsData {
  const {
    projectId,
    members,
    screeningDecisions,
    extractions,
    extractionValuesCountByExtractor = {},
    projectWorks,
    questions,
    protocols,
    annotations,
    reconciliations,
    devices = [],
    authSessions = [],
  } = inputs;

  // Build map of users for fast lookups
  const userMap = new Map<string, { name: string; email: string; role: string; joinedAt: string | null }>();
  for (const m of members) {
    userMap.set(m.user_id, {
      name: m.users?.display_name || m.users?.email?.split("@")[0] || "Unknown",
      email: m.users?.email || "",
      role: m.access_role || "MEMBER",
      joinedAt: m.joined_at,
    });
  }

  const getUser = (userId: string | null | undefined, fallback?: { display_name?: string | null; email?: string } | null) => {
    if (userId && userMap.has(userId)) {
      return userMap.get(userId)!;
    }
    const name = fallback?.display_name || fallback?.email?.split("@")[0] || (userId ? "Member" : "System");
    const email = fallback?.email || "";
    return { name, email, role: "MEMBER", joinedAt: null };
  };

  // Initialize stats per member
  const statsByMember = new Map<string, MemberContributionStats>();

  for (const m of members) {
    statsByMember.set(m.user_id, {
      userId: m.user_id,
      name: m.users?.display_name || m.users?.email?.split("@")[0] || "Member",
      email: m.users?.email || "",
      role: m.access_role || "MEMBER",
      joinedAt: m.joined_at,
      lastActiveAt: null,
      screenedTotal: 0,
      screenedIncluded: 0,
      screenedExcluded: 0,
      screenedMaybe: 0,
      extractedPapers: 0,
      extractedFields: 0,
      submittedExtractions: 0,
      verifiedExtractions: 0,
      papersImported: 0,
      questionsCreated: 0,
      protocolsCreated: 0,
      annotationsCount: 0,
      reconciliationsCount: 0,
      totalActionsCount: 0,
      contributionScore: 0,
      percentageShare: 0,
    });
  }

  const bumpActive = (userId: string, timestamp: string) => {
    const s = statsByMember.get(userId);
    if (!s) return;
    if (!s.lastActiveAt || new Date(timestamp) > new Date(s.lastActiveAt)) {
      s.lastActiveAt = timestamp;
    }
  };

  // 1. Process Screening Decisions
  for (const sd of screeningDecisions) {
    const s = statsByMember.get(sd.decided_by);
    if (s) {
      s.screenedTotal += 1;
      const statusUpper = sd.to_status?.toUpperCase() || "";
      if (statusUpper === "INCLUDED" || statusUpper === "READING" || statusUpper === "EXTRACTED" || statusUpper === "SYNTHESIZED") {
        s.screenedIncluded += 1;
      } else if (statusUpper === "EXCLUDED") {
        s.screenedExcluded += 1;
      } else {
        s.screenedMaybe += 1;
      }
      bumpActive(sd.decided_by, sd.created_at);
    }
  }

  // 2. Process Extractions
  for (const e of extractions) {
    const s = statsByMember.get(e.extractor_id);
    if (s) {
      s.extractedPapers += 1;
      if (e.status === "SUBMITTED") s.submittedExtractions += 1;
      if (e.status === "VERIFIED") s.verifiedExtractions += 1;
      bumpActive(e.extractor_id, e.submitted_at || e.updated_at || e.created_at);
    }
  }

  // Add individual fields answered
  for (const [userId, count] of Object.entries(extractionValuesCountByExtractor)) {
    const s = statsByMember.get(userId);
    if (s) {
      s.extractedFields = count;
    }
  }

  // 3. Process Imported Papers
  for (const pw of projectWorks) {
    if (pw.added_by) {
      const s = statsByMember.get(pw.added_by);
      if (s) {
        s.papersImported += 1;
        bumpActive(pw.added_by, pw.created_at);
      }
    }
  }

  // 4. Process Questions
  for (const q of questions) {
    if (q.created_by) {
      const s = statsByMember.get(q.created_by);
      if (s) {
        s.questionsCreated += 1;
        bumpActive(q.created_by, q.created_at);
      }
    }
  }

  // 5. Process Protocols
  for (const p of protocols) {
    if (p.created_by) {
      const s = statsByMember.get(p.created_by);
      if (s) {
        s.protocolsCreated += 1;
        bumpActive(p.created_by, p.created_at);
      }
    }
  }

  // 6. Process Annotations
  for (const a of annotations) {
    if (a.created_by) {
      const s = statsByMember.get(a.created_by);
      if (s) {
        s.annotationsCount += 1;
        bumpActive(a.created_by, a.created_at);
      }
    }
  }

  // 7. Process Reconciliations
  for (const r of reconciliations) {
    if (r.reconciled_by) {
      const s = statsByMember.get(r.reconciled_by);
      if (s) {
        s.reconciliationsCount += 1;
        if (r.reconciled_at) bumpActive(r.reconciled_by, r.reconciled_at);
      }
    }
  }

  // 8. Process Auth Sessions
  for (const sess of authSessions) {
    bumpActive(sess.userId, sess.timestamp);
  }

  // 9. Process Devices
  for (const d of devices) {
    if (d.last_seen_at) {
      bumpActive(d.user_id, d.last_seen_at);
    } else if (d.created_at) {
      bumpActive(d.user_id, d.created_at);
    }
  }

  // Compute Contribution Scores
  // Weighting formula:
  // - Screening decision: 2 pts
  // - Completed extraction paper: 5 pts
  // - Extracted field answered: 1 pt
  // - Imported paper: 1 pt
  // - Research question: 5 pts
  // - Protocol: 10 pts
  // - PDF annotation / quote: 2 pts
  // - Reconciled conflict: 4 pts
  let grandTotalScore = 0;
  let totalProjectActions = 0;

  for (const s of statsByMember.values()) {
    s.totalActionsCount =
      s.screenedTotal +
      s.extractedPapers +
      s.papersImported +
      s.questionsCreated +
      s.protocolsCreated +
      s.annotationsCount +
      s.reconciliationsCount;

    s.contributionScore =
      s.screenedTotal * 2 +
      s.extractedPapers * 5 +
      s.extractedFields * 1 +
      s.papersImported * 1 +
      s.questionsCreated * 5 +
      s.protocolsCreated * 10 +
      s.annotationsCount * 2 +
      s.reconciliationsCount * 4;

    grandTotalScore += s.contributionScore;
    totalProjectActions += s.totalActionsCount;
  }

  for (const s of statsByMember.values()) {
    s.percentageShare =
      grandTotalScore > 0 ? Math.round((s.contributionScore / grandTotalScore) * 100) : 0;
  }

  // Sort members by contribution score descending
  const memberStats = Array.from(statsByMember.values()).sort(
    (a, b) => b.contributionScore - a.contributionScore,
  );

  // ── Build Chronological Activity Audit Feed ──────────────────────────────
  const events: ProjectActivityEvent[] = [];

  // Screening events
  for (const sd of screeningDecisions) {
    const user = getUser(sd.decided_by, sd.users);
    const detailParts: string[] = [];
    if (sd.note) detailParts.push(`"${sd.note}"`);
    if (sd.exclude_reason) detailParts.push(`Reason: ${sd.exclude_reason}`);

    events.push({
      id: `screen-${sd.id}`,
      type: "SCREENING",
      actorId: sd.decided_by,
      actorName: user.name,
      actorEmail: user.email,
      action: `Screened as ${sd.to_status}`,
      targetTitle: sd.works?.title || "Paper",
      targetHref: `/projects/${projectId}/read/${sd.project_work_id}`,
      details: detailParts.length > 0 ? detailParts.join(" · ") : undefined,
      timestamp: sd.created_at,
    });
  }

  // Extraction events
  for (const e of extractions) {
    const user = getUser(e.extractor_id, e.users);
    events.push({
      id: `extract-${e.id}`,
      type: "EXTRACTION",
      actorId: e.extractor_id,
      actorName: user.name,
      actorEmail: user.email,
      action: `Extraction ${e.status.toLowerCase()}`,
      targetTitle: e.works?.title || "Paper",
      targetHref: `/projects/${projectId}/extract/${e.project_work_id}`,
      details: e.field_count ? `${e.field_count} fields extracted` : undefined,
      timestamp: e.submitted_at || e.updated_at || e.created_at,
    });
  }

  // Collection events
  for (const pw of projectWorks) {
    if (pw.added_by) {
      const user = getUser(pw.added_by, pw.users);
      events.push({
        id: `import-${pw.id}`,
        type: "COLLECTION",
        actorId: pw.added_by,
        actorName: user.name,
        actorEmail: user.email,
        action: "Added to library",
        targetTitle: pw.works?.title || "Paper",
        targetHref: `/projects/${projectId}/read/${pw.id}`,
        timestamp: pw.created_at,
      });
    }
  }

  // Question events
  for (const q of questions) {
    if (q.created_by) {
      const user = getUser(q.created_by, q.users);
      events.push({
        id: `question-${q.id}`,
        type: "QUESTION",
        actorId: q.created_by,
        actorName: user.name,
        actorEmail: user.email,
        action: "Created research question",
        targetTitle: q.title,
        targetHref: `/projects/${projectId}/questions`,
        timestamp: q.created_at,
      });
    }
  }

  // Protocol events
  for (const p of protocols) {
    if (p.created_by) {
      const user = getUser(p.created_by, p.users);
      events.push({
        id: `protocol-${p.id}`,
        type: "PROTOCOL",
        actorId: p.created_by,
        actorName: user.name,
        actorEmail: user.email,
        action: `Created protocol v${p.version}`,
        targetTitle: p.name,
        targetHref: `/projects/${projectId}/protocol`,
        timestamp: p.created_at,
      });
    }
  }

  // Annotation events
  for (const a of annotations) {
    if (a.created_by) {
      const user = getUser(a.created_by, a.users);
      events.push({
        id: `anno-${a.id}`,
        type: "ANNOTATION",
        actorId: a.created_by,
        actorName: user.name,
        actorEmail: user.email,
        action: "Added PDF annotation / quote",
        targetTitle: a.works?.title || "Paper",
        targetHref: `/projects/${projectId}/read/${a.project_work_id}`,
        details: a.comment ? `"${a.comment}"` : undefined,
        timestamp: a.created_at,
      });
    }
  }

  // Reconciliation events
  for (const r of reconciliations) {
    if (r.reconciled_by && r.reconciled_at) {
      const user = getUser(r.reconciled_by, r.users);
      events.push({
        id: `reconcile-${r.id}`,
        type: "RECONCILIATION",
        actorId: r.reconciled_by,
        actorName: user.name,
        actorEmail: user.email,
        action: "Reconciled dual extraction",
        targetTitle: r.works?.title || "Paper",
        targetHref: `/projects/${projectId}/reconcile`,
        timestamp: r.reconciled_at,
      });
    }
  }

  // ── Authentication Audit Events (Login & Logout) ──────────────────────────
  // Logged directly and fully preserved for each authentication event
  for (const sess of authSessions) {
    const user = getUser(sess.userId);
    events.push({
      id: `auth-${sess.userId}-${sess.type}-${sess.timestamp}`,
      type: sess.type,
      actorId: sess.userId,
      actorName: user.name,
      actorEmail: user.email,
      action: sess.action,
      targetTitle: sess.label || "Web Session",
      timestamp: sess.timestamp,
    });
  }

  // Sort events newest first
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // ── Build 35-Day Contribution Heatmap ────────────────────────────────────
  const heatmap = buildContributionHeatmap(events);

  const activeContributorsCount = memberStats.filter((m) => m.totalActionsCount > 0).length;

  return {
    members: memberStats,
    events,
    heatmap,
    totalProjectActions,
    activeContributorsCount,
  };
}

/**
 * Builds daily activity buckets for the specified number of days (default 35 days).
 */
export function buildContributionHeatmap(
  events: ProjectActivityEvent[],
  now = new Date(),
  daysCount = 35,
): ContributionHeatmapData {
  const daysMap = new Map<string, number>();

  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth();
  const utcDate = now.getUTCDate();
  const todayUtcMidnight = new Date(Date.UTC(utcYear, utcMonth, utcDate));

  // Initialize days with 0 count
  const days: ContributionHeatmapDay[] = [];
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(todayUtcMidnight.getTime() - i * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    daysMap.set(dateStr, 0);
  }

  // Count events per date
  for (const event of events) {
    const dateStr = event.timestamp.slice(0, 10);
    if (daysMap.has(dateStr)) {
      daysMap.set(dateStr, (daysMap.get(dateStr) ?? 0) + 1);
    }
  }

  let totalActions = 0;
  let peakDay: { date: string; count: number } | null = null;

  for (const [date, count] of daysMap.entries()) {
    totalActions += count;
    if (!peakDay || count > peakDay.count) {
      peakDay = { date, count };
    }

    let intensity: 0 | 1 | 2 | 3 | 4 = 0;
    if (count > 0) {
      if (count <= 2) intensity = 1;
      else if (count <= 5) intensity = 2;
      else if (count <= 10) intensity = 3;
      else intensity = 4;
    }

    days.push({ date, count, intensity });
  }

  // Calculate current & longest streaks
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;

  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    if (!day) continue;
    if (day.count > 0) {
      if (i === days.length - 1 || currentStreak > 0) {
        currentStreak++;
      }
    } else if (i === days.length - 1) {
      // today has 0, check yesterday
      continue;
    } else {
      break;
    }
  }

  for (const day of days) {
    if (day.count > 0) {
      tempStreak++;
      if (tempStreak > longestStreak) longestStreak = tempStreak;
    } else {
      tempStreak = 0;
    }
  }

  return {
    days,
    totalActions,
    currentStreak,
    longestStreak,
    peakDay: peakDay && peakDay.count > 0 ? peakDay : null,
  };
}
