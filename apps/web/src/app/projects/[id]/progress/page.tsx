import { SCREEN_STATUSES, screenStatusLabel } from "@Porcupine/shared";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ContributionsClient } from "@/components/contributions/contributions-client";
import { LiveRefresh } from "@/components/live-refresh";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { getProjectContributions } from "@/lib/contributions-server";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Progress & Contributions" };

interface ProgressRow {
  screen_status: string;
  count: number;
  assigned: number;
  overdue: number;
}

interface DecisionRow {
  created_at: string;
  to_status: string;
}

interface ExtractionRow {
  id: string;
  status: string;
  project_work_id: string;
  submitted_at: string | null;
  created_at: string;
}

/** The velocity window, and the cap on how long a project is assumed to be. */
const VELOCITY_DAYS = 14;

/** Sum the counts for a set of statuses. Same rule the overview uses. */
function countOf(rows: ProgressRow[], ...statuses: string[]) {
  return rows
    .filter((r) => statuses.includes(r.screen_status))
    .reduce((sum, r) => sum + r.count, 0);
}

/**
 * Project Progress & Contribution Intelligence Hub.
 *
 * Provides granular tracking from macro pipeline stages down to every single
 * micro-action, member breakdown, and chronological audit trail.
 */
export default async function ProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createClient();

  const project = await must(
    supabase.from("projects").select("id, title, created_at").eq("id", id).maybeSingle(),
    "the project",
  );

  if (!project) notFound();

  const [progressData, decisionData, extractionData, annotationData, contributionsData] =
    await Promise.all([
      supabase
        .from("v_project_progress")
        .select("screen_status, count, assigned, overdue")
        .eq("project_id", id),
      supabase
        .from("screening_decisions")
        .select("created_at, to_status")
        .eq("project_id", id)
        .gte("created_at", new Date(Date.now() - VELOCITY_DAYS * 86_400_000).toISOString())
        .order("created_at", { ascending: true }),
      supabase
        .from("extractions")
        .select("id, status, project_work_id, submitted_at, created_at")
        .eq("project_id", id),
      supabase
        .from("annotations")
        .select("id, project_work_id")
        .eq("project_id", id)
        .is("deleted_at", null),
      getProjectContributions(id),
    ]);

  if (progressData.error) {
    throw new Error(`Could not load progress: ${progressData.error.message}`);
  }

  const rows = (progressData.data ?? []) as unknown as ProgressRow[];
  const extractions = (extractionData.data ?? []) as unknown as ExtractionRow[];
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const overdue = rows.reduce((sum, r) => sum + r.overdue, 0);

  // Distinct completed extractions
  const completedExtractionWorks = new Set(
    extractions.filter((e) => e.status !== "DRAFT").map((e) => e.project_work_id),
  );
  const draftExtractionWorks = new Set(
    extractions
      .filter((e) => e.status === "DRAFT" && !completedExtractionWorks.has(e.project_work_id))
      .map((e) => e.project_work_id),
  );
  const annotatedWorks = new Set(
    ((annotationData.data ?? []) as Array<{ project_work_id: string }>)
      .filter((a) => !completedExtractionWorks.has(a.project_work_id))
      .map((a) => a.project_work_id),
  );

  const activeReadingWorks = new Set([
    ...draftExtractionWorks,
    ...annotatedWorks,
  ]);

  const rawExtracted = countOf(rows, "EXTRACTED");
  const rawReading = countOf(rows, "READING");
  const rawIncluded = countOf(rows, "INCLUDED");
  const rawSynthesized = countOf(rows, "SYNTHESIZED");
  const rawExcluded = countOf(rows, "EXCLUDED");
  const rawIdentified = countOf(rows, "IDENTIFIED");
  const rawScreening = countOf(rows, "SCREENING");

  // Reconciled counts for all 7 statuses
  const extractedCount = Math.max(rawExtracted, completedExtractionWorks.size);
  const readingCount = Math.max(rawReading, activeReadingWorks.size);
  const deltaExtracted = extractedCount - rawExtracted;
  const deltaReading = readingCount - rawReading;
  const includedCount = Math.max(0, rawIncluded - deltaExtracted - deltaReading);

  const countsMap = new Map<string, number>([
    ["IDENTIFIED", rawIdentified],
    ["SCREENING", rawScreening],
    ["INCLUDED", includedCount],
    ["EXCLUDED", rawExcluded],
    ["READING", readingCount],
    ["EXTRACTED", extractedCount],
    ["SYNTHESIZED", rawSynthesized],
  ]);

  const undecided = rawIdentified + rawScreening;
  const screened = total - undecided;
  const remaining = undecided;
  const totalIncluded = includedCount + readingCount + extractedCount + rawSynthesized;

  /*
   * Velocity: screening rate over the last fortnight.
   */
  const decisions = ((decisionData.data ?? []) as unknown as DecisionRow[]).filter(
    (d) => d.to_status === "INCLUDED" || d.to_status === "EXCLUDED",
  );

  const ageDays = (Date.now() - new Date(project.created_at).getTime()) / 86_400_000;
  const observedDays = Math.max(1, Math.min(VELOCITY_DAYS, ageDays));
  const perDay = decisions.length / observedDays;

  const enoughToExtrapolate = decisions.length >= 5 && perDay >= 0.5;
  const daysLeft =
    enoughToExtrapolate && remaining > 0 ? Math.ceil(remaining / perDay) : null;

  /*
   * Extraction Velocity: completed submissions over the last fortnight.
   */
  const recentSubmissions = extractions.filter(
    (e) =>
      e.status !== "DRAFT" &&
      e.submitted_at &&
      new Date(e.submitted_at).getTime() >= Date.now() - VELOCITY_DAYS * 86_400_000,
  );
  const extractPerDay = recentSubmissions.length / observedDays;
  const remainingToExtract = Math.max(0, totalIncluded - extractedCount);
  const enoughToExtrapolateExtract = recentSubmissions.length >= 3 && extractPerDay >= 0.3;
  const extractDaysLeft =
    enoughToExtrapolateExtract && remainingToExtract > 0
      ? Math.ceil(remainingToExtract / extractPerDay)
      : null;

  return (
    <main id="main" className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-8 sm:px-6">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Progress & Contributions"
        description="Detailed tracking of research pipeline diagnostics, velocity projections, and member contribution audit logs."
      />

      <LiveRefresh projectId={id} kind={["screening", "extraction", "messages"]} />

      {total === 0 && contributionsData.totalProjectActions === 0 ? (
        <EmptyState
          title="No research activity yet"
          description="Progress and contribution intelligence appears as members import papers, screen, and extract."
          action={
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/projects/${id}/search`} variant="primary">
                Search Papers
              </ButtonLink>
              <ButtonLink href={`/projects/${id}/import`}>Import Records</ButtonLink>
            </div>
          }
        />
      ) : (
        <>
          {/* ── 1. Research Pipeline Diagnostics (AT THE VERY TOP) ─────────── */}
          <section aria-labelledby="pipeline-diagnostics" className="flex flex-col gap-6">
            <div>
              <h2 id="pipeline-diagnostics" className="text-ink text-heading font-semibold">
                Research Pipeline & Velocity
              </h2>
              <p className="text-muted text-fine mt-0.5">
                Current status distribution across PRISMA stages and completion projections.
              </p>
            </div>

            {/* Totals Summary */}
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <Stat label="Papers" value={total} />
              <Stat label="Decided" value={screened} hint="in or out" />
              <Stat label="Extracted" value={extractedCount} hint={`of ${totalIncluded} included`} />
              <Stat label="Remaining" value={remaining} hint="to screen" />
              <Stat
                label="Overdue"
                value={overdue}
                tone={overdue > 0 ? "danger" : "normal"}
                hint="past due date"
              />
            </dl>

            {/* 7-Stage Pipeline Visual Distribution Meter */}
            <div className="border-border/70 bg-raised/70 rounded-2xl border p-6 shadow-xs">
              <h3 className="text-ink text-ui mb-4 font-semibold">
                Pipeline Stage Distribution
              </h3>
              <ul className="space-y-3">
                {SCREEN_STATUSES.map((status) => {
                  const count = countsMap.get(status) ?? 0;
                  const share = total === 0 ? 0 : Math.round((count / total) * 100);
                  return (
                    <li key={status} className="flex items-center gap-4">
                      <span className="text-muted text-fine w-28 shrink-0 font-medium">
                        {screenStatusLabel(status)}
                      </span>
                      <div
                        role="meter"
                        aria-valuenow={count}
                        aria-valuemin={0}
                        aria-valuemax={total}
                        aria-label={`${screenStatusLabel(status)}: ${count} of ${total}`}
                        className="bg-surface/80 border-border/40 h-2.5 flex-1 overflow-hidden rounded-full border"
                      >
                        <div
                          className="bg-accent h-full rounded-full transition-all duration-500"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                      <span className="text-ink text-ui w-12 shrink-0 text-right font-semibold tabular-nums">
                        {count}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Velocity Projections */}
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="border-border/70 bg-raised/70 rounded-2xl border p-6 shadow-xs">
                <h3 className="text-ink text-ui mb-2 font-semibold">
                  Screening velocity
                </h3>
                <p className="text-muted text-ui leading-relaxed">
                  {decisions.length === 0 ? (
                    "No papers included or excluded in the last fortnight."
                  ) : (
                    <>
                      {decisions.length} {decisions.length === 1 ? "paper" : "papers"} decided
                      in the last {Math.round(observedDays)}{" "}
                      {Math.round(observedDays) === 1 ? "day" : "days"} — about{" "}
                      {perDay.toFixed(1)} per day.
                      {daysLeft !== null ? (
                        <>
                          {" "}
                          At that rate the remaining {remaining} would take roughly{" "}
                          <strong className="text-ink">{daysLeft} days</strong>.
                        </>
                      ) : remaining > 0 ? (
                        " Too few recent decisions to estimate a finish date."
                      ) : (
                        " Everything has been screened."
                      )}
                    </>
                  )}
                </p>
              </div>

              <div className="border-border/70 bg-raised/70 rounded-2xl border p-6 shadow-xs">
                <h3 className="text-ink text-ui mb-2 font-semibold">
                  Extraction velocity
                </h3>
                <p className="text-muted text-ui leading-relaxed">
                  {recentSubmissions.length === 0 ? (
                    "No extractions submitted in the last fortnight."
                  ) : (
                    <>
                      {recentSubmissions.length}{" "}
                      {recentSubmissions.length === 1 ? "extraction" : "extractions"}{" "}
                      completed in the last {Math.round(observedDays)}{" "}
                      {Math.round(observedDays) === 1 ? "day" : "days"} — about{" "}
                      {extractPerDay.toFixed(1)} per day.
                      {extractDaysLeft !== null ? (
                        <>
                          {" "}
                          At that rate the remaining {remainingToExtract} would take roughly{" "}
                          <strong className="text-ink">{extractDaysLeft} days</strong>.
                        </>
                      ) : remainingToExtract > 0 ? (
                        " Too few recent extractions to estimate completion."
                      ) : (
                        " All included papers have been extracted."
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
          </section>

          {/* ── 2. Member Contributions, Leaderboard & Audit Feed ──────────── */}
          <section aria-labelledby="contributions-section" className="flex flex-col gap-4 border-t border-border/60 pt-8">
            <div className="flex flex-col gap-1">
              <h2 id="contributions-section" className="text-ink text-heading font-semibold">
                Member Contributions & Granular Audit Log
              </h2>
              <p className="text-muted text-fine">
                Deep-dive into every micro-action, member workload breakdown, and 35-day activity heatmaps.
              </p>
            </div>

            <ContributionsClient data={contributionsData} />
          </section>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "normal",
  hint,
}: {
  label: string;
  value: number;
  tone?: "normal" | "danger";
  hint?: string;
}) {
  return (
    <div className="border-border/70 bg-raised/70 rounded-2xl border p-4 shadow-xs">
      <dt className="text-muted text-fine font-medium">
        {label}
        {hint && <span className="mt-0.5 block opacity-80 font-normal">{hint}</span>}
      </dt>
      <dd
        className={`text-title mt-1.5 font-bold tabular-nums ${
          tone === "danger" && value > 0 ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
