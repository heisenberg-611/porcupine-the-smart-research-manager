import { SCREEN_STATUSES, screenStatusLabel } from "@Porcupine/shared";
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

/** The velocity window, and the cap on how long a project is assumed to be. */
const VELOCITY_DAYS = 14;

/** Sum the counts for a set of statuses. Same rule the overview uses. */
function countOf(rows: ProgressRow[], ...statuses: string[]) {
  return rows
    .filter((r) => statuses.includes(r.screen_status))
    .reduce((sum, r) => sum + r.count, 0);
}

/**
 * Where the project actually is.
 *
 * Counts come from `v_project_progress` rather than being recomputed here, so
 * the number on this page is the same number a support conversation would get
 * from SQL. The view is `security_invoker`, so RLS still applies — see
 * packages/db/test/06_screening.sql, which asserts it.
 *
 * The velocity figure is deliberately blunt: verdicts per day over the last
 * fortnight, and an estimate only when the recent rate is non-zero. A burndown
 * that projects a finish date from four decisions is worse than no estimate,
 * because people plan around it.
 *
 * The bars are SHARES OF THE LIBRARY, one per status — not a funnel. Each is
 * `count / total`, so they sum to the whole. Read as a funnel they would be
 * nonsense, which is why every bar carries its own count beside it rather than
 * relying on the reader to infer one from a width.
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

  /*
   * Screened = a paper that has been DECIDED about.
   *
   * This used to be "anything that is not IDENTIFIED", which counted SCREENING
   * as screened. SCREENING means someone has the paper open and has not
   * decided yet — the one status that is explicitly unfinished. So the number
   * overstated progress, `Remaining` understated the work, and the two got
   * further apart the busier the team was.
   *
   * It also disagreed with the project overview, which has always counted
   * IDENTIFIED + SCREENING as unscreened. Two pages, one question, two
   * answers. This one was wrong.
   */
  const undecided = countOf(rows, "IDENTIFIED", "SCREENING");
  const screened = total - undecided;
  const remaining = undecided;

  const window = new Date(Date.now() - VELOCITY_DAYS * 24 * 60 * 60 * 1000);
  const decisionData = await must(
    supabase
      .from("screening_decisions")
      .select("created_at, to_status")
      .eq("project_id", id)
      .gte("created_at", window.toISOString())
      .order("created_at", { ascending: true }),
    "recent decisions",
  );

  /*
   * Velocity counts VERDICTS, not row inserts.
   *
   * Backwards moves are deliberately allowed — a decision gets revised, a
   * misclick gets undone — and each one writes a `screening_decisions` row. As
   * throughput they are worse than noise: reopening ten papers would have read
   * as a productive afternoon while the pile got bigger.
   */
  const decisions = ((decisionData ?? []) as unknown as DecisionRow[]).filter(
    (d) => d.to_status === "INCLUDED" || d.to_status === "EXCLUDED",
  );

  /*
   * Divided by the days the project has actually existed, capped at the
   * window. Dividing by a flat 14 meant a project three days old reported a
   * fifth of its real rate, and the estimate below then refused to appear at
   * all — worst on exactly the projects where someone is checking whether this
   * is going to work.
   */
  const ageDays = (Date.now() - new Date(project.created_at).getTime()) / 86_400_000;
  const observedDays = Math.max(1, Math.min(VELOCITY_DAYS, ageDays));
  const perDay = decisions.length / observedDays;

  /*
   * Only estimate when there is a SAMPLE worth extrapolating from.
   *
   * Two gates, because each catches what the other misses. The rate gate
   * alone let a project created twenty minutes ago turn one decision into
   * "1.0 per day" and a confident finish date — dividing by a floor of one day
   * makes any first decision look like a daily habit. The count gate alone
   * would extrapolate five decisions spread over a dead fortnight.
   *
   * Five is a judgement, not a calculation: it is roughly the point where a
   * number stops being one afternoon's mood.
   */
  const enoughToExtrapolate = decisions.length >= 5 && perDay >= 0.5;
  const daysLeft =
    enoughToExtrapolate && remaining > 0 ? Math.ceil(remaining / perDay) : null;

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
              <Stat label="Decided" value={screened} hint="included or excluded" />
              <Stat label="Remaining" value={remaining} hint="not yet decided" />
              <Stat
                label="Overdue"
                value={overdue}
                tone={overdue > 0 ? "danger" : "normal"}
                hint="past their due date"
              />
            </dl>
          </section>

          <section aria-labelledby="pipeline">
            <h2 id="pipeline" className="text-ink text-heading mb-3 font-medium">
              Pipeline
            </h2>
            <ul className="space-y-2">
              {SCREEN_STATUSES.map((status) => {
                const row = byStatus.get(status);
                const count = row?.count ?? 0;
                const share = total === 0 ? 0 : Math.round((count / total) * 100);
                return (
                  <li key={status} className="flex items-center gap-3">
                    <span className="text-muted text-fine w-28 shrink-0">
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
                    <span className="text-ink text-ui w-10 shrink-0 text-right tabular-nums">
                      {count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="velocity">
            <h2 id="velocity" className="text-ink text-heading mb-2 font-medium">
              Reading velocity
            </h2>
            <p className="text-muted text-ui">
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
  hint,
}: {
  label: string;
  value: number;
  tone?: "normal" | "danger";
  /** What the number counts. On screen, not only in a comment — the previous
   *  version's "Screened" meant something different here than on the overview
   *  and there was no way to tell from either page. */
  hint?: string;
}) {
  return (
    <div className="border-border rounded-lg border p-3">
      {/* The hint belongs to the TERM, not the value. Putting it in the `dd`
          made the definition read "1 included or excluded", which is a
          sentence about a number rather than the number itself. */}
      <dt className="text-muted text-fine">
        {label}
        {hint && <span className="mt-0.5 block opacity-80">{hint}</span>}
      </dt>
      <dd
        className={`text-title mt-1 font-semibold tabular-nums ${tone === "danger" && value > 0 ? "text-danger" : "text-ink"
          }`}
      >
        {value}
      </dd>
    </div>
  );
}
