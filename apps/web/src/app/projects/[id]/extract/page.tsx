import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LiveRefresh } from "@/components/live-refresh";
import { Banner, EmptyState, Input, PageHeader } from "@/components/ui";
import { getProjectRole } from "@/lib/project";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { TargetForm } from "./target-form";

export const metadata: Metadata = { title: "Extract papers" };

/**
 * Who has extracted what, and how far off the target the team is.
 *
 * The counts, the per-member progress and the search all live here rather
 * than in three screens, because the question this page answers is a single
 * one — "are we going to finish, and who is stuck" — and answering it used to
 * mean opening the dashboard for the names, /progress for the totals, and the
 * evidence table to see whether the answers were actually in.
 *
 * ─ Done means NOT DRAFT ───────────────────────────────────────────────────
 *
 * Every count below treats an extraction as complete when its status is
 * anything other than DRAFT, which is the same rule `evidence_rows` applies.
 * The version this replaces tested `status === "SUBMITTED"` and so reported a
 * RECONCILED or VERIFIED extraction — one that has been through dual
 * extraction and had its disagreements resolved, the most finished thing in
 * the product — as still drafting. Two screens disagreeing about whether a
 * paper is done is worse than either being wrong on its own.
 *
 * ─ The search is a URL, not state ─────────────────────────────────────────
 *
 * `?q=` rather than a client filter, so this page stays a server component
 * and a filtered view is a link somebody can send. Same choice the evidence
 * table makes, for the same reason.
 */
export default async function ExtractDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const supabase = await createClient();

  const project = await must(
    supabase
      .from("projects")
      .select("title, extraction_target")
      .eq("id", id)
      .maybeSingle(),
    "the project",
  );
  if (!project) notFound();

  const { title: projectTitle, extraction_target: target } = project as {
    title: string;
    extraction_target: number | null;
  };

  const [role, extractionsResult, worksResult, membersResult] = await Promise.all([
    getProjectRole(id, user.id),
    supabase
      .from("extractions")
      .select("id, status, extractor_id, project_work_id")
      .eq("project_id", id),
    supabase
      .from("project_works")
      .select("id, assignee_id, works ( title, published_year )")
      .eq("project_id", id)
      .in("screen_status", ["INCLUDED", "READING", "EXTRACTED", "SYNTHESIZED"]),
    supabase
      .from("project_members")
      /*
       * `users!project_members_user_id_fkey`, not `users`.
       *
       * Naming the constraint became necessary the moment
       * `project_members.invited_by` gained a foreign key of its own: there are
       * now TWO relationships between `project_members` and `users`, and
       * PostgREST refuses to guess, with "Could not embed because more than
       * one relationship was found". An implicit embed is only unambiguous
       * while there is exactly one way through, which is a property of the
       * schema and not of this query.
       */
      .select("user_id, users!project_members_user_id_fkey ( display_name )")
      .eq("project_id", id)
      .is("removed_at", null),
  ]);

  // `error` captured, not discarded. A bare `const { data }` renders an empty
  // dashboard when the query fails, so "nobody has extracted anything" and
  // "the query is broken" look identical — to the reader, who concludes the
  // screening did not save, and to us.
  if (extractionsResult.error || worksResult.error || membersResult.error) {
    return (
      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
        <PageHeader
          backHref={`/projects/${id}`}
          backLabel={projectTitle}
          title="Extract"
        />
        <Banner tone="danger">Could not load this project&rsquo;s extractions.</Banner>
      </main>
    );
  }

  const extractions = (extractionsResult.data ?? []) as unknown as Extraction[];
  const works = (worksResult.data ?? []) as unknown as WorkRow[];
  const members = (membersResult.data ?? []) as unknown as MemberRow[];

  const board = buildBoard({ works, extractions, members });

  /*
   * All four numbers describe the SAME set of papers.
   *
   * `works` is filtered to the papers screening has let through, and the
   * counts below are filtered to extractions of those papers rather than to
   * every extraction in the project. Without that they are answers to two
   * different questions printed side by side: an extraction started from the
   * library before the paper was screened in counted as complete against a
   * corpus that did not contain it, and the page cheerfully rendered "1
   * complete" above "0 papers to extract".
   *
   * Found by the e2e fixture, which imports a paper and extracts it without
   * screening it — an order the app allows.
   */
  const inCorpus = new Set(works.map((w) => w.id));
  const relevant = extractions.filter((e) => inCorpus.has(e.project_work_id));

  const totals = {
    corpus: works.length,
    done: relevant.filter((e) => e.status !== "DRAFT").length,
    drafting: relevant.filter((e) => e.status === "DRAFT").length,
    unassigned: board.unassigned.length,
  };

  /*
   * Progress against the target if there is one, against the corpus if not.
   *
   * With four members and a target of 25, the denominator is 100 — the work
   * the team agreed to — not the number of papers that happen to be in the
   * library today. Those are different numbers and the difference is the
   * point: a bar that moves because somebody imported more papers is not
   * measuring progress.
   */
  const denominator = target ? target * members.length : totals.corpus;
  // Clamped, because `done` legitimately exceeds the target the moment somebody
  // takes more than their share — which is the behaviour a target is supposed
  // to encourage, and not a reason to render a bar wider than its track.
  const percent =
    denominator > 0 ? Math.min(100, Math.round((totals.done / denominator) * 100)) : 0;

  const needle = query.toLowerCase();
  const matches = (paperTitle: string) =>
    needle === "" || paperTitle.toLowerCase().includes(needle);

  return (
    <main id="main" className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={projectTitle}
        title="Extract"
        description="Who has extracted what, and how much is left. Open a member to see their papers."
      />

      <LiveRefresh projectId={id} kind="extraction" />

      {/*
        A description list, because that is what these are — three labelled
        values — and `dt`/`dd` say so where two stacked paragraphs say nothing.
        Each pair carries a `data-stat` handle for the same reason the evidence
        table's rows carry `data-evidence-item`: the numbers are the contract,
        and a test that finds them by reading the prose beside them breaks the
        next time the prose is reworded.
      */}
      <dl aria-label="Totals" className="grid gap-3 sm:grid-cols-3">
        <Stat name="corpus" label="Papers to extract" value={String(totals.corpus)} />
        {/* The hint prop is spread rather than passed as `undefined`:
            `exactOptionalPropertyTypes` treats "absent" and "explicitly
            undefined" as different things, correctly. */}
        <Stat
          name="complete"
          label="Extractions complete"
          value={target ? `${totals.done} of ${denominator}` : String(totals.done)}
          {...(totals.drafting > 0 ? { hint: `${totals.drafting} still in draft` } : {})}
        />
        <Stat
          name="unstarted"
          label="Nobody has started"
          value={String(totals.unassigned)}
        />
      </dl>

      {/*
        One bar, and only when there is something for it to mean. A progress
        bar on an empty project is a bar at 0% that says nothing except that
        the project is empty, which the counts above already said.
      */}
      {denominator > 0 && (
        <section aria-label="Overall progress" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-ink text-heading font-medium">Overall</h2>
            <p className="text-muted text-ui">
              <span className="text-ink font-medium">{percent}%</span> of{" "}
              {target ? "the agreed workload" : "the library"}
            </p>
          </div>
          <Meter percent={percent} />
        </section>
      )}

      {(role === "OWNER" || role === "ADMIN") && (
        <section
          aria-label="Target"
          className="border-rule bg-surface/50 rounded-[--radius-card] border p-5"
        >
          <TargetForm projectId={id} target={target} />
        </section>
      )}

      {/* The search only earns its space once the list is long enough to need
          it. Below that it is a control that answers a question nobody has. */}
      {totals.corpus > 8 && (
        <form method="get" role="search" className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="q" className="text-muted text-fine block">
              Find a paper
            </label>
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={query}
              placeholder="Title contains…"
              className="mt-1"
            />
          </div>
          {query && (
            <Link
              href={`/projects/${id}/extract`}
              className="text-muted hover:text-ink text-ui focus-visible:ring-accent inline-flex min-h-12 items-center rounded-lg px-3 focus-visible:ring-2 focus-visible:outline-none"
            >
              Clear
            </Link>
          )}
        </form>
      )}

      <div className="flex flex-col gap-4">
        {members.map((member) => {
          const papers = board.byMember.get(member.user_id) ?? [];
          const visible = papers.filter((p) => matches(p.title));
          const done = papers.filter((p) => p.state === "done").length;

          // Somebody with nothing assigned and nothing extracted is not part
          // of this screen's story yet — unless a target exists, in which case
          // their nought is exactly what a supervisor came here to see.
          if (papers.length === 0 && !target) return null;

          return (
            <details
              key={member.user_id}
              open={query !== "" && visible.length > 0}
              className="border-rule bg-surface/50 rounded-[--radius-card] border"
            >
              <summary className="hover:bg-surface flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-2 rounded-[--radius-card] p-5">
                <span className="text-ink min-w-0 flex-1 font-medium">
                  {member.users?.display_name ?? "Unknown member"}
                </span>

                <span
                  data-member-progress
                  className="text-muted text-ui shrink-0 font-mono"
                >
                  {target ? `${done} / ${target}` : `${done} done`}
                </span>

                {target ? (
                  <span className="w-full sm:w-40">
                    <Meter percent={Math.min(100, Math.round((done / target) * 100))} />
                  </span>
                ) : null}
              </summary>

              <div className="border-rule border-t px-5 py-4">
                {visible.length === 0 ? (
                  <p className="text-muted text-ui">
                    {papers.length === 0
                      ? "Nothing assigned yet."
                      : "No paper here matches that search."}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {visible.map((paper, index) => (
                      <PaperRow
                        key={`${paper.id}-${index}`}
                        projectId={id}
                        paper={paper}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </details>
          );
        })}

        {board.unassigned.length > 0 && (
          <details
            open={query !== ""}
            className="border-rule rounded-[--radius-card] border border-dashed"
          >
            <summary className="hover:bg-surface flex cursor-pointer items-center gap-4 rounded-[--radius-card] p-5">
              <span className="text-ink flex-1 font-medium">Nobody has started</span>
              <span className="text-muted text-ui font-mono">
                {board.unassigned.length}
              </span>
            </summary>
            <div className="border-rule border-t px-5 py-4">
              <ul className="flex flex-col gap-2">
                {board.unassigned
                  .filter((paper) => matches(paper.title))
                  .map((paper, index) => (
                    <PaperRow key={`${paper.id}-${index}`} projectId={id} paper={paper} />
                  ))}
              </ul>
            </div>
          </details>
        )}

        {board.departed.length > 0 && (
          <details className="border-rule rounded-[--radius-card] border border-dashed">
            <summary className="hover:bg-surface flex cursor-pointer items-center gap-4 rounded-[--radius-card] p-5">
              <span className="text-ink flex-1 font-medium">
                Extracted by former members
              </span>
              <span className="text-muted text-ui font-mono">
                {board.departed.length}
              </span>
            </summary>
            <div className="border-rule border-t px-5 py-4">
              <p className="text-muted text-ui mb-3 text-pretty">
                Still counted above and still in the evidence table — removing somebody
                from a project does not remove their work from the review.
              </p>
              <ul className="flex flex-col gap-2">
                {/* Index in the key: dual extraction puts the same paper in
                    this pile twice, once per extractor, and both belong. */}
                {board.departed
                  .filter((paper) => matches(paper.title))
                  .map((paper, index) => (
                    <PaperRow key={`${paper.id}-${index}`} projectId={id} paper={paper} />
                  ))}
              </ul>
            </div>
          </details>
        )}

        {totals.corpus === 0 && (
          <EmptyState
            title="No papers to extract yet"
            description="Papers arrive here once they have been included during screening."
            action={
              <Link
                href={`/projects/${id}/screen`}
                className="border-border text-ink hover:bg-surface focus-visible:ring-accent text-ui inline-flex min-h-11 items-center rounded-lg border px-4 font-medium focus-visible:ring-2 focus-visible:outline-none"
              >
                Go to screening
              </Link>
            }
          />
        )}
      </div>
    </main>
  );
}

/** One number, said once. */
function Stat({
  name,
  label,
  value,
  hint,
}: {
  name: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      data-stat={name}
      className="border-rule bg-surface/50 rounded-[--radius-card] border p-5"
    >
      <dt className="text-muted text-fine">{label}</dt>
      <dd className="text-ink text-title mt-1 font-serif">{value}</dd>
      {hint && <dd className="text-muted text-fine mt-1">{hint}</dd>}
    </div>
  );
}

/**
 * A bar, and a number for the people the bar does not reach.
 *
 * `aria-hidden` on the track: the percentage is already in the text beside
 * every one of these, so announcing it twice is noise. A `<progress>` element
 * would announce it a third time and cannot be styled consistently across
 * browsers.
 */
function Meter({ percent }: { percent: number }) {
  return (
    <span aria-hidden className="bg-surface block h-1.5 w-full rounded-full">
      <span
        className="bg-accent block h-1.5 rounded-full transition-[width] duration-500"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

function PaperRow({ projectId, paper }: { projectId: string; paper: Paper }) {
  const label =
    paper.state === "done"
      ? "View in the evidence table"
      : paper.state === "draft"
        ? "Continue"
        : "Start";

  const href =
    paper.state === "done"
      ? `/projects/${projectId}/evidence?q=${encodeURIComponent(paper.title)}`
      : `/projects/${projectId}/extract/${paper.id}`;

  return (
    <li className="border-rule bg-raised flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3">
      <span className="text-ink text-ui min-w-0 flex-1 text-pretty">
        {paper.title}
        {paper.year ? <span className="text-muted"> · {paper.year}</span> : null}
      </span>

      <span className="meta shrink-0">
        {paper.state === "done"
          ? "Complete"
          : paper.state === "draft"
            ? "In draft"
            : "Not started"}
      </span>

      <Link
        href={href}
        className="border-border text-ink hover:bg-surface focus-visible:ring-accent text-ui inline-flex min-h-9 shrink-0 items-center rounded-lg border px-3 font-medium focus-visible:ring-2 focus-visible:outline-none"
      >
        {label}
      </Link>
    </li>
  );
}

interface Extraction {
  id: string;
  status: string;
  extractor_id: string;
  project_work_id: string;
}

interface WorkRow {
  id: string;
  assignee_id: string | null;
  works: { title: string | null; published_year: number | null } | null;
}

interface MemberRow {
  user_id: string;
  users: { display_name: string | null } | null;
}

interface Paper {
  id: string;
  title: string;
  year: number | null;
  state: "done" | "draft" | "todo";
}

/**
 * Papers to people.
 *
 * A paper appears under everyone who has extracted it — which is two people
 * in a systematic review doing dual extraction, and that is the point rather
 * than a duplicate — plus its assignee, if they have not started. It falls
 * through to "nobody has started" only when it has neither.
 */
function buildBoard({
  works,
  extractions,
  members,
}: {
  works: WorkRow[];
  extractions: Extraction[];
  members: MemberRow[];
}) {
  const byMember = new Map<string, Paper[]>();
  for (const member of members) byMember.set(member.user_id, []);

  const unassigned: Paper[] = [];
  const departed: Paper[] = [];

  for (const work of works) {
    const paper = {
      id: work.id,
      title: work.works?.title ?? "Untitled paper",
      year: work.works?.published_year ?? null,
    };

    const mine = extractions.filter((e) => e.project_work_id === work.id);

    for (const extraction of mine) {
      const state = extraction.status === "DRAFT" ? "draft" : "done";
      const list = byMember.get(extraction.extractor_id);
      if (list) {
        list.push({ ...paper, state });
      } else {
        /*
         * Extracted by somebody who has since left the project.
         *
         * Their work is still in the evidence table and still counted in the
         * totals above, so dropping it here would make this page disagree with
         * both. It cannot go in the "nobody has started" pile either — a
         * completed extraction filed under "not started" is worse than not
         * showing it, because it is a statement and the statement is false.
         *
         * Its own group, named for what it is.
         */
        departed.push({ ...paper, state });
      }
    }

    if (work.assignee_id) {
      const startedItAlready = mine.some((e) => e.extractor_id === work.assignee_id);
      if (!startedItAlready) {
        byMember.get(work.assignee_id)?.push({ ...paper, state: "todo" });
      }
    } else if (mine.length === 0) {
      unassigned.push({ ...paper, state: "todo" });
    }
  }

  return { byMember, unassigned, departed };
}
