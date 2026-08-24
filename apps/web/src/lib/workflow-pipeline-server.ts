import "server-only";

import { capabilities, type ProjectKind } from "@Porcupine/shared";
import { must } from "@/lib/supabase/query";
import { createClient } from "@/lib/supabase/server";
import {
  calculateWorkflowPipeline,
  type WorkflowPipelineResult,
} from "./workflow-pipeline";

export interface ProjectWorkflowData {
  pipeline: WorkflowPipelineResult;
  counts: {
    papers: number;
    unscreened: number;
    included: number;
    excluded: number;
    extracted: number;
  };
}

/**
 * Server-side loader to fetch live project counts and compute the 6-stage workflow pipeline.
 */
export async function getProjectWorkflowPipeline(
  projectId: string,
  kind: ProjectKind,
): Promise<ProjectWorkflowData> {
  const supabase = await createClient();
  const caps = capabilities(kind);

  const [
    progressData,
    protocolRes,
    reconcileRes,
    questionRes,
    extractionsData,
  ] = await Promise.all([
    must(
      supabase
        .from("v_project_progress")
        .select("screen_status, count")
        .eq("project_id", projectId),
      "the progress counts",
    ),
    supabase
      .from("protocols")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("is_active", true),
    caps.dualExtraction
      ? supabase
          .from("v_reconciliation_queue")
          .select("project_work_id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .eq("reconciled", false)
      : Promise.resolve({ count: 0 }),
    supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    supabase
      .from("extractions")
      .select("project_work_id")
      .eq("project_id", projectId)
      .neq("status", "DRAFT"),
  ]);

  const progress = (progressData ?? []) as Array<{ screen_status: string; count: number }>;
  const countOf = (...statuses: string[]) =>
    progress
      .filter((r) => statuses.includes(r.screen_status))
      .reduce((sum, r) => sum + r.count, 0);

  const papers = progress.reduce((sum, r) => sum + r.count, 0);
  const unscreened = countOf("IDENTIFIED", "SCREENING");
  const included = countOf("INCLUDED", "READING", "EXTRACTED", "SYNTHESIZED");
  const excluded = countOf("EXCLUDED");

  const extractedWorks = new Set(
    ((extractionsData?.data ?? []) as Array<{ project_work_id: string }>).map(
      (e) => e.project_work_id,
    ),
  );
  const dbExtracted = countOf("EXTRACTED", "SYNTHESIZED");
  const extracted = Math.max(extractedWorks.size, dbExtracted);

  const hasProtocol = (protocolRes.count ?? 0) > 0;
  const questionCount = questionRes.count ?? 0;
  const awaiting = reconcileRes.count ?? 0;

  const pipeline = calculateWorkflowPipeline({
    projectId,
    questionCount,
    papers,
    unscreened,
    included,
    excluded,
    hasProtocol,
    extracted,
    awaiting,
    dualExtraction: caps.dualExtraction,
  });

  return {
    pipeline,
    counts: {
      papers,
      unscreened,
      included,
      excluded,
      extracted,
    },
  };
}
