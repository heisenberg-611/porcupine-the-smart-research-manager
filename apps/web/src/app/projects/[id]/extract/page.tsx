import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader, Banner } from "@/components/ui";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Extract papers" };

export default async function ExtractDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createClient();

  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("title")
    .eq("id", id)
    .single();

  if (pErr || !project) notFound();

  // Fetch extractions
  const { data: extractions, error: extErr } = await supabase
    .from("extractions")
    .select(
      `
      id,
      status,
      extractor_id,
      project_work_id
    `,
    )
    .eq("project_id", id);

  /*
   * `error` captured, not discarded.
   *
   * These two were bare `const { data: x }` destructures, which is the shape
   * CI's guard exists to catch: when the query fails, `data` is null and the
   * page renders an empty extraction dashboard. "No papers ready to extract"
   * and "the query is broken" then look identical — to the reader, who
   * concludes the screening did not save, and to us. The project query three
   * lines above already handled its error; these two did not, on the same
   * page.
   */
  const { data: projectWorks, error: worksErr } = await supabase
    .from("project_works")
    .select(
      `
      id,
      assignee_id,
      works ( title, published_year )
    `,
    )
    .eq("project_id", id)
    .in("screen_status", ["INCLUDED", "READING", "EXTRACTED", "SYNTHESIZED"]);

  const { data: members, error: membersErr } = await supabase
    .from("project_members")
    .select(
      `
      user_id,
      users ( display_name )
    `,
    )
    .eq("project_id", id);

  if (extErr || worksErr || membersErr) {
    return (
      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
        <PageHeader
          backHref={`/projects/${id}`}
          backLabel={project.title}
          title="Extract papers"
        />
        <Banner tone="danger">Could not load this project&rsquo;s extractions.</Banner>
      </main>
    );
  }

  // Organize papers by member
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memberPapers = new Map<string, Array<{ pw: any; ext: any }>>();
  members?.forEach((m) => memberPapers.set(m.user_id, []));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unassignedWorks: any[] = [];

  for (const pw of projectWorks || []) {
    const exts = extractions?.filter((e) => e.project_work_id === pw.id) || [];

    // Everyone who has an extraction gets the paper in their accordion
    if (exts.length > 0) {
      for (const ext of exts) {
        const arr = memberPapers.get(ext.extractor_id) || [];
        if (!arr.some((a) => a.pw.id === pw.id)) {
          arr.push({ pw, ext });
        }
        memberPapers.set(ext.extractor_id, arr);
      }
    }

    // AND if it's assigned to someone, they should ALSO have it in their accordion
    // (unless they already have an extraction, which is handled above)
    if (pw.assignee_id) {
      const hasExtracted = exts.some((e) => e.extractor_id === pw.assignee_id);
      if (!hasExtracted) {
        const arr = memberPapers.get(pw.assignee_id) || [];
        if (!arr.some((a) => a.pw.id === pw.id)) {
          arr.push({ pw, ext: null });
        }
        memberPapers.set(pw.assignee_id, arr);
      }
    } else if (exts.length === 0) {
      // Only completely unassigned and unextracted papers go to the queue
      unassignedWorks.push(pw);
    }
  }

  return (
    <main
      id="main"
      className="animate-in fade-in slide-in-from-bottom-4 mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12 duration-500"
    >
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Extraction Dashboard"
        description="Track how many papers each member has extracted. Click on a member to see the exact papers."
      />

      <div className="flex flex-col gap-6">
        {members?.map((member) => {
          const papers = memberPapers.get(member.user_id) || [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const displayName = (member.users as any)?.display_name || "Unknown member";

          if (papers.length === 0) return null;

          return (
            <details
              key={member.user_id}
              className="group border-border bg-surface open:ring-border/50 rounded-xl border shadow-sm transition-all open:ring-1"
            >
              <summary className="hover:bg-canvas/50 group-open:bg-canvas/30 flex cursor-pointer items-center justify-between rounded-xl p-5 transition-colors select-none group-open:rounded-b-none">
                <div className="flex items-center gap-4">
                  <div className="bg-accent/10 text-accent ring-accent/20 flex h-10 w-10 items-center justify-center rounded-full text-base font-bold ring-1">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-ink text-lg font-semibold">{displayName}</h2>
                    <p className="text-muted mt-0.5 text-sm">Team Member</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-ink bg-canvas border-border/80 flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold shadow-sm">
                    <span className="bg-accent h-2 w-2 animate-pulse rounded-full" />
                    {papers.length} {papers.length === 1 ? "paper" : "papers"}
                  </span>
                  <svg
                    className="text-muted h-5 w-5 transition-transform duration-300 group-open:rotate-180"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </summary>

              <div className="border-border bg-canvas/30 rounded-b-xl border-t px-5 py-5">
                <ul className="flex flex-col gap-3">
                  {papers.map(({ pw, ext }) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const work = pw.works as any;
                    const title = work?.title || "Unknown paper";
                    const year = work?.published_year || "";

                    return (
                      <li
                        key={pw.id}
                        className="bg-surface border-border/60 hover:border-accent/40 flex flex-col justify-between gap-4 rounded-xl border p-4 transition-all duration-200 hover:shadow-sm sm:flex-row sm:items-center"
                      >
                        <div className="flex-1 pr-4">
                          <p className="text-ink leading-snug font-medium text-pretty">
                            {title}
                          </p>
                          <div className="mt-2 flex items-center gap-3">
                            {year && (
                              <span className="bg-canvas border-border/60 text-muted rounded border px-2 py-0.5 font-mono text-xs">
                                {year}
                              </span>
                            )}
                            {ext ? (
                              <span
                                className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${ext.status === "SUBMITTED" ? "bg-accent/10 text-accent border-accent/20 border" : "bg-surface border-border text-ui border"}`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${ext.status === "SUBMITTED" ? "bg-accent" : "bg-muted/50"}`}
                                />
                                {ext.status === "SUBMITTED" ? "Completed" : "Drafting"}
                              </span>
                            ) : (
                              <span className="bg-canvas border-border text-muted flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium">
                                <span className="bg-muted/30 h-1.5 w-1.5 rounded-full" />
                                Assigned, Not Started
                              </span>
                            )}
                          </div>
                        </div>
                        {ext ? (
                          ext.status === "SUBMITTED" ? (
                            <Link
                              href={`/projects/${id}/evidence?q=${encodeURIComponent(title)}`}
                              className="bg-surface border-border text-ink hover:bg-canvas focus-visible:ring-accent inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border px-4 text-sm font-medium shadow-sm transition-all outline-none hover:-translate-y-0.5 focus-visible:ring-2"
                            >
                              View in Evidence
                            </Link>
                          ) : (
                            <Link
                              href={`/projects/${id}/extract/${pw.id}`}
                              className="bg-surface border-border text-ink hover:bg-canvas focus-visible:ring-accent inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border px-4 text-sm font-medium shadow-sm transition-all outline-none hover:-translate-y-0.5 focus-visible:ring-2"
                            >
                              Continue Drafting
                            </Link>
                          )
                        ) : (
                          <Link
                            href={`/projects/${id}/extract/${pw.id}`}
                            className="bg-surface border-border text-ink hover:bg-canvas focus-visible:ring-accent inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border px-4 text-sm font-medium shadow-sm transition-all outline-none hover:-translate-y-0.5 focus-visible:ring-2"
                          >
                            Start Extraction
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          );
        })}

        {unassignedWorks.length > 0 && (
          <details className="group border-border bg-surface open:ring-border/50 rounded-xl border shadow-sm transition-all open:ring-1">
            <summary className="hover:bg-canvas/50 group-open:bg-canvas/30 flex cursor-pointer items-center justify-between rounded-xl p-5 transition-colors select-none group-open:rounded-b-none">
              <div className="flex items-center gap-4">
                <div className="bg-muted/10 text-muted ring-muted/20 flex h-10 w-10 items-center justify-center rounded-full text-base font-bold ring-1">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-ink text-lg font-semibold">Unassigned Papers</h2>
                  <p className="text-muted mt-0.5 text-sm">Available for extraction</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-muted bg-canvas border-border/80 flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold shadow-sm">
                  {unassignedWorks.length} pending
                </span>
                <svg
                  className="text-muted h-5 w-5 transition-transform duration-300 group-open:rotate-180"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </summary>

            <div className="border-border bg-canvas/30 rounded-b-xl border-t px-5 py-5">
              <ul className="flex flex-col gap-3">
                {unassignedWorks.map((pw) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const work = pw.works as any;
                  const title = work?.title || "Unknown paper";
                  const year = work?.published_year || "";

                  return (
                    <li
                      key={pw.id}
                      className="bg-surface border-border/60 hover:border-accent/40 flex flex-col justify-between gap-4 rounded-xl border p-4 transition-all duration-200 hover:shadow-sm sm:flex-row sm:items-center"
                    >
                      <div className="flex-1 pr-4">
                        <p className="text-ink leading-snug font-medium text-pretty">
                          {title}
                        </p>
                        {year && (
                          <div className="mt-2">
                            <span className="bg-canvas border-border/60 text-muted rounded border px-2 py-0.5 font-mono text-xs">
                              {year}
                            </span>
                          </div>
                        )}
                      </div>
                      <Link
                        href={`/projects/${id}/extract/${pw.id}`}
                        className="bg-accent text-accent-ink focus-visible:ring-accent inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg px-4 text-sm font-medium shadow-sm transition-all outline-none hover:-translate-y-0.5 hover:brightness-110 focus-visible:ring-2"
                      >
                        Start Extraction
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          </details>
        )}

        {members?.every((m) => (memberPapers.get(m.user_id) || []).length === 0) &&
          unassignedWorks.length === 0 && (
            <div className="border-rule flex flex-col items-center rounded-xl border border-dashed p-10 text-center">
              <div className="bg-muted/10 text-muted mb-4 flex h-12 w-12 items-center justify-center rounded-full">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h2 className="text-ink mb-2 text-lg font-semibold">
                No papers to extract yet
              </h2>
              <p className="text-muted text-ui max-w-sm">
                Papers will appear here once they have been screened and marked as
                "Included" in the screening phase.
              </p>
              <Link
                href={`/projects/${id}/screen`}
                className="bg-surface border-border text-ink hover:bg-canvas focus-visible:ring-accent mt-6 inline-flex min-h-11 items-center justify-center rounded-full border px-6 font-medium transition-colors outline-none focus-visible:ring-2"
              >
                Go to Screening
              </Link>
            </div>
          )}
      </div>
    </main>
  );
}
