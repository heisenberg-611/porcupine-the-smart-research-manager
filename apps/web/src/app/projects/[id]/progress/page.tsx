import { SCREEN_STATUSES, screenStatusLabel } from "@porcupine/shared";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Progress" };

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

/**
 * Where the project actually is.
 *
 * Counts come from `v_project_progress` rather than being recomputed here, so
 * the number on this page is the same number a support conversation would get
 * from SQL. The view is `security_invoker`, so RLS still applies — see
 * packages/db/test/06_screening.sql, which asserts it.
 *
 * The velocity figure is deliberately blunt: decisions per day over the last
 * fortnight, and an estimate only when the recent rate is non-zero. A burndown
 * that projects a finish date from four decisions is worse than no estimate,
 * because people plan around it.
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
    supabase.from("projects").select("id, title").eq("id", id).maybeSingle(),
    "the project",
  );

  if (!project) notFound();

  const { data: progressData, error: progressError } = await supabase
    .from("v_project_progress")
    .select("screen_status, count, assigned, overdue")
    .eq("project_id", id);

  // Fail loudly rather than rendering a page of zeroes: "nothing screened yet"
  // and "the query broke" must not look identical.
  if (progressError) {
    throw new Error(`Could not load progress: ${progressError.message}`);
  }

  const rows = (progressData ?? []) as unknown as ProgressRow[];
  const byStatus = new Map(rows.map((r) => [r.screen_status, r]));
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const overdue = rows.reduce((sum, r) => sum + r.overdue, 0);

  // Screened = anything past the initial identification stage.
  const screened = rows
    .filter((r) => r.screen_status !== "IDENTIFIED")
    .reduce((sum, r) => sum + r.count, 0);
  const remaining = total - screened;

  const fortnightAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const decisionData = await must(
    supabase
      .from("screening_decisions")
      .select("created_at, to_status")
      .eq("project_id", id)
      .gte("created_at", fortnightAgo)
      .order("created_at", { ascending: true }),
    "recent decisions",
  );

  const decisions = (decisionData ?? []) as unknown as DecisionRow[];
  const perDay = decisions.length / 14;

  // Only estimate when there is a rate worth extrapolating from.
  const daysLeft = perDay >= 0.5 && remaining > 0 ? Math.ceil(remaining / perDay) : null;

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Progress"
      />

      {total === 0 ? (
        <EmptyState
          title="No papers yet"
          description="Progress appears once the library has records to screen."
          action={
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/projects/${id}/search`} variant="primary">
                Search
              </ButtonLink>
              <ButtonLink href={`/projects/${id}/import`}>Import</ButtonLink>
            </div>
          }
        />
      ) : (
        <>
          <section aria-labelledby="summary">
            <h2 id="summary" className="sr-only">
              Summary
            </h2>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Papers" value={total} />
              <Stat label="Screened" value={screened} />
              <Stat label="Remaining" value={remaining} />
              <Stat
                label="Overdue"
                value={overdue}
                tone={overdue > 0 ? "danger" : "normal"}
              />
            </dl>
          </section>

          <section aria-labelledby="pipeline">
            <h2 id="pipeline" className="text-ink mb-3 text-lg font-medium">
              Pipeline
            </h2>
            <ul className="space-y-2">
              {SCREEN_STATUSES.map((status) => {
                const row = byStatus.get(status);
                const count = row?.count ?? 0;
                const share = total === 0 ? 0 : Math.round((count / total) * 100);
                return (
                  <li key={status} className="flex items-center gap-3">
                    <span className="text-muted w-28 shrink-0 text-xs">
                      {screenStatusLabel(status)}
                    </span>
                    {/* A meter, not a decorative div: it announces its value. */}
                    <div
                      role="meter"
                      aria-valuenow={count}
                      aria-valuemin={0}
                      aria-valuemax={total}
                      aria-label={`${screenStatusLabel(status)}: ${count} of ${total}`}
                      className="bg-border h-2 flex-1 overflow-hidden rounded-full"
                    >
                      <div className="bg-accent h-full" style={{ width: `${share}%` }} />
                    </div>
                    <span className="text-ink w-10 shrink-0 text-right text-sm tabular-nums">
                      {count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="velocity">
            <h2 id="velocity" className="text-ink mb-2 text-lg font-medium">
              Reading velocity
            </h2>
            <p className="text-muted text-sm">
              {decisions.length === 0 ? (
                "No screening decisions in the last fortnight."
              ) : (
                <>
                  {decisions.length} {decisions.length === 1 ? "decision" : "decisions"}{" "}
                  in the last 14 days — about {perDay.toFixed(1)} per day.
                  {daysLeft !== null ? (
                    <>
                      {" "}
                      At that rate the remaining {remaining} would take roughly{" "}
                      <strong className="text-ink">{daysLeft} days</strong>.
                    </>
                  ) : remaining > 0 ? (
                    // Refusing to extrapolate is the honest answer here.
                    " Too few recent decisions to estimate a finish date."
                  ) : (
                    " Everything has been screened."
                  )}
                </>
              )}
            </p>
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
}: {
  label: string;
  value: number;
  tone?: "normal" | "danger";
}) {
  return (
    <div className="border-border rounded-lg border p-3">
      <dt className="text-muted text-xs">{label}</dt>
      <dd
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "danger" && value > 0 ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
