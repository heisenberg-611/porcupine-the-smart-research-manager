import "server-only";

import { createAdminClient } from "@/server/admin";
import { must } from "@/lib/supabase/query";
import { createClient } from "@/lib/supabase/server";
import {
  aggregateProjectContributions,
  type ProjectContributionsData,
  type RawAnnotation,
  type RawAuthSession,
  type RawDevice,
  type RawExtraction,
  type RawMember,
  type RawProjectWork,
  type RawProtocol,
  type RawQuestion,
  type RawReconciliation,
  type RawScreeningDecision,
} from "./contributions";

/**
 * Server-side loader to fetch and aggregate all project contributions.
 */
export async function getProjectContributions(
  projectId: string,
): Promise<ProjectContributionsData> {
  const supabase = await createClient();

  const [
    membersData,
    decisionsData,
    extractionsData,
    extractionValuesData,
    projectWorksData,
    questionsData,
    protocolsData,
    annotationsData,
    reconciliationsData,
    authEventsData,
  ] = await Promise.all([
    // 1. Members
    must(
      supabase
        .from("project_members")
        .select(
          "id, user_id, access_role, joined_at, users!project_members_user_id_fkey(display_name, email)",
        )
        .eq("project_id", projectId)
        .is("removed_at", null),
      "project members for contributions",
    ),

    // 2. Screening Decisions (correct column names: decided_by, note, to_status, exclude_reason)
    supabase
      .from("screening_decisions")
      .select(
        "id, project_work_id, decided_by, from_status, to_status, exclude_reason, note, created_at, project_works!inner(works(title))",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1000),

    // 3. Extractions
    supabase
      .from("extractions")
      .select(
        "id, project_work_id, extractor_id, status, created_at, updated_at, submitted_at, project_works!inner(works(title))",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(500),

    // 4. Extraction Values (for field counts)
    supabase
      .from("extraction_values")
      .select("id, extraction_id, extractions!inner(extractor_id, project_id)")
      .eq("extractions.project_id", projectId),

    // 5. Project Works (Collected papers)
    supabase
      .from("project_works")
      .select("id, added_by, created_at, screen_status, works(title)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1000),

    // 6. Research Questions
    supabase
      .from("questions")
      .select("id, title, created_by, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),

    // 7. Protocols
    supabase
      .from("protocols")
      .select("id, name, version, created_by, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),

    // 8. Annotations
    supabase
      .from("annotations")
      .select("id, project_work_id, created_by, created_at, comment, project_works!inner(works(title))")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500),

    // 9. Reconciliations
    supabase
      .from("v_reconciliation_queue")
      .select("project_work_id, reconciled_by, reconciled_at, works(title)")
      .eq("project_id", projectId)
      .eq("reconciled", true)
      .limit(200),

    // 10. Dedicated Member Auth Events (Login & Logout database table)
    supabase
      .from("member_auth_events")
      .select("id, user_id, event_type, action, device_label, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const rawMembers = (membersData ?? []) as unknown as RawMember[];
  const memberUserIds = new Set(rawMembers.map((m) => m.user_id));

  // Aggregate extraction values count by extractor
  const extractionValuesCountByExtractor: Record<string, number> = {};
  if (extractionValuesData.data) {
    for (const row of (extractionValuesData.data as any[])) {
      const ext = Array.isArray(row.extractions) ? row.extractions[0] : row.extractions;
      const extractorId = ext?.extractor_id;
      if (extractorId) {
        extractionValuesCountByExtractor[extractorId] =
          (extractionValuesCountByExtractor[extractorId] ?? 0) + 1;
      }
    }
  }

  // Transform screening decisions
  const screeningDecisions: RawScreeningDecision[] = (decisionsData.data ?? []).map(
    (d: any) => ({
      id: d.id,
      project_work_id: d.project_work_id,
      decided_by: d.decided_by,
      from_status: d.from_status,
      to_status: d.to_status,
      exclude_reason: d.exclude_reason,
      note: d.note,
      created_at: d.created_at,
      works: d.project_works?.works ?? null,
    }),
  );

  // Transform extractions
  const extractions: RawExtraction[] = (extractionsData.data ?? []).map((e: any) => ({
    id: e.id,
    project_work_id: e.project_work_id,
    extractor_id: e.extractor_id,
    status: e.status,
    created_at: e.created_at,
    updated_at: e.updated_at,
    submitted_at: e.submitted_at,
    works: e.project_works?.works ?? null,
  }));

  // Transform project works
  const projectWorks: RawProjectWork[] = (projectWorksData.data ?? []).map((pw: any) => ({
    id: pw.id,
    added_by: pw.added_by,
    created_at: pw.created_at,
    screen_status: pw.screen_status,
    works: pw.works ?? null,
  }));

  // Transform annotations
  const annotations: RawAnnotation[] = (annotationsData.data ?? []).map((a: any) => ({
    id: a.id,
    project_work_id: a.project_work_id,
    created_by: a.created_by,
    created_at: a.created_at,
    comment: a.comment,
    works: a.project_works?.works ?? null,
  }));

  // Transform reconciliations
  const reconciliations: RawReconciliation[] = (reconciliationsData.data ?? []).map(
    (r: any) => ({
      id: r.project_work_id,
      project_work_id: r.project_work_id,
      reconciled_by: r.reconciled_by,
      reconciled_at: r.reconciled_at,
      works: r.works ?? null,
    }),
  );

  // Ingest Login & Logout events directly from member_auth_events table
  const authSessions: RawAuthSession[] = [];
  let rawAuthRows = (authEventsData?.data ?? []) as any[];

  // Fallback to admin client if RLS or query returned empty rows
  if (rawAuthRows.length === 0) {
    try {
      const admin = createAdminClient();
      if (admin) {
        const adminAuthRes = await admin
          .from("member_auth_events")
          .select("id, user_id, event_type, action, device_label, created_at")
          .in("user_id", Array.from(memberUserIds))
          .order("created_at", { ascending: false })
          .limit(500);

        if (adminAuthRes.data && adminAuthRes.data.length > 0) {
          rawAuthRows = adminAuthRes.data;
        }
      }
    } catch {
      // Non-blocking
    }
  }

  for (const row of rawAuthRows) {
    if (memberUserIds.has(row.user_id)) {
      authSessions.push({
        userId: row.user_id,
        type: row.event_type as "LOGIN" | "LOGOUT",
        action: row.action,
        label: row.device_label || "Web Session",
        timestamp: row.created_at,
      });
    }
  }

  // Fallback: Also load enrolled devices for legacy or multi-device context
  let devices: RawDevice[] = [];
  try {
    const admin = createAdminClient();
    if (admin) {
      const devicesRes = await admin
        .from("devices")
        .select("id, user_id, label, created_at, last_seen_at, revoked_at")
        .in("user_id", Array.from(memberUserIds))
        .order("created_at", { ascending: false })
        .limit(200);

      if (devicesRes.data) {
        devices = (devicesRes.data as any[]).map((d) => ({
          id: d.id,
          user_id: d.user_id,
          label: d.label,
          created_at: d.created_at,
          last_seen_at: d.last_seen_at,
          revoked_at: d.revoked_at,
        }));
      }
    }
  } catch {
    // Non-blocking
  }

  return aggregateProjectContributions({
    projectId,
    members: rawMembers,
    screeningDecisions,
    extractions,
    extractionValuesCountByExtractor,
    projectWorks,
    questions: (questionsData.data ?? []) as unknown as RawQuestion[],
    protocols: (protocolsData.data ?? []) as unknown as RawProtocol[],
    annotations,
    reconciliations,
    devices,
    authSessions,
  });
}
