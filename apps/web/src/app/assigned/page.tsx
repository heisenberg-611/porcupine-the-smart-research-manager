import { OPEN_QUEUE_STATUSES, screenStatusLabel } from "@porcupine/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SourceLinks } from "@/components/source-links";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Assigned to me" };

interface QueueRow {
  id: string;
  project_id: string;
  screen_status: string;
  due_at: string | null;
  projects: { title: string } | null;
  works: {
    title: string;
    published_year: number | null;
    doi: string | null;
    arxiv_id: string | null;
    pmid: string | null;
    oa_pdf_url: string | null;
  } | null;
}

/**
 * Everything assigned to me, across every project, soonest due first.
 *
 * Deliberately cross-project. A doctoral student is usually on their own
 * thesis and their supervisor's review at the same time, and a per-project
 * queue means they have to remember which projects to check — which is
 * exactly the "keeping tabs on a thousand things" problem this product
 * exists to remove.
 *
 * No RLS special-casing is needed: the policy already scopes project_works
 * to projects the caller is a member of, so filtering by assignee is purely
 * a narrowing.
 *
 * Every row is a link to the thing it is asking for. It used to name the paper
 * and link only to the PROJECT, which made this a list of instructions with no
 * way to follow any of them — you read "screen this paper", clicked, and
 * arrived at a project overview to start navigating from scratch. A queue you
 * cannot act from is a reminder, and people already have those.
 */
export default async function AssignedPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const supabase = await createClient();

  const data = await must(
    supabase
      .from("project_works")
      .select(
        "id, project_id, screen_status, due_at, projects(title), works(title, published_year, doi, arxiv_id, pmid, oa_pdf_url)",
      )
      .eq("assignee_id", user.id)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200),
    "your queue",
  );

  const rows = (data ?? []) as unknown as QueueRow[];
  const now = Date.now();

  const openStatuses = OPEN_QUEUE_STATUSES as unknown as string[];
  const openRows = rows.filter((r) => openStatuses.includes(r.screen_status));
  const closedRows = rows.filter((r) => !openStatuses.includes(r.screen_status));

  const overdue = openRows.filter((r) => r.due_at && new Date(r.due_at).getTime() < now);

  /**
   * Where a row sends you, by what it is waiting for.
   *
   * Unscreened work goes to the screening surface; anything already included
   * goes to the reader, which is where the next decision gets made. The reader
   * is a safe destination for every status, so the fallback is not a guess.
   */
  const destination = (row: QueueRow) => {
    const read = `/projects/${row.project_id}/read/${row.id}`;
    if (row.screen_status === "IDENTIFIED" || row.screen_status === "SCREENING") {
      return { href: `/projects/${row.project_id}/screen`, label: "Screen" };
    }
    return { href: read, label: "Read" };
  };

  /**
   * Everything you can do with this paper, spelled out.
   *
   * The row used to be a title and one link, and that link was often "Read" —
   * which lands on a page holding an abstract and a highlighter. For a paper
   * whose next real step is extraction, that reads as a dead end: the reader
   * "does nothing" because reading was not what was being asked for.
   *
   * So the actions are named by the WORK rather than by the screen, and the
   * one the status is actually waiting on comes first.
   */
  const actions = (row: QueueRow) => {
    const base = `/projects/${row.project_id}`;
    switch (row.screen_status) {
      case "IDENTIFIED":
      case "SCREENING":
        return [
          { href: `${base}/screen`, label: "Screen it", primary: true },
          { href: `${base}/read/${row.id}`, label: "Read the abstract" },
        ];
      case "INCLUDED":
      case "READING":
        return [
          { href: `${base}/extract/${row.id}`, label: "Extract from it", primary: true },
          { href: `${base}/read/${row.id}`, label: "Read and annotate" },
        ];
      case "EXTRACTED":
      case "SYNTHESIZED":
        return [
          { href: `${base}/evidence`, label: "See it in the evidence", primary: true },
          { href: `${base}/read/${row.id}`, label: "Read and annotate" },
        ];
      default:
        return [{ href: `${base}/read/${row.id}`, label: "Open it", primary: true }];
    }
  };

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <PageHeader
        backHref="/projects"
        backLabel="All projects"
        title="Assigned to me"
        description={
          <>
            {openRows.length === 0 && closedRows.length === 0
              ? "Nothing assigned to you."
              : `${openRows.length} open ${overdue.length > 0 ? ` · ${overdue.length} overdue` : ""} · ${closedRows.length} closed`}
          </>
        }
      />

      {openRows.length === 0 && closedRows.length === 0 ? (
        // The one screen someone lands on with nothing to do.
        <EmptyState
          title="Nothing is waiting for you"
          description="Papers assigned to you appear here, across every project you are in, soonest due first. Assignments are made on a project's screening page."
          action={<ButtonLink href="/projects">Go to your projects</ButtonLink>}
        />
      ) : (
        <div className="flex flex-col gap-10">
          {openRows.length > 0 && (
            <section>
              <h2 className="text-display text-ink mb-4">Open</h2>
              <ul className="border-border divide-border divide-y rounded-lg border">
                {openRows.map((row) => {
                  const isOverdue = row.due_at
                    ? new Date(row.due_at).getTime() < now
                    : false;
                  return (
                    <li
                      key={row.id}
                      className="flex items-start justify-between gap-4 p-4"
                    >
                      <div className="min-w-0">
                        <Link
                          href={destination(row).href}
                          className="text-ink text-ui font-medium underline-offset-2 hover:underline"
                        >
                          {row.works?.title ?? "Untitled"}
                        </Link>
                        <p className="text-muted text-fine mt-0.5">
                          <Link
                            href={`/projects/${row.project_id}`}
                            className="hover:text-ink underline underline-offset-2"
                          >
                            {row.projects?.title ?? "Project"}
                          </Link>
                          {" · "}
                          {screenStatusLabel(row.screen_status)}
                          {row.works?.published_year && ` · ${row.works.published_year}`}
                        </p>
                        <SourceLinks
                          className="mt-1"
                          title={row.works?.title ?? "this paper"}
                          work={{
                            doi: row.works?.doi,
                            arxivId: row.works?.arxiv_id,
                            pmid: row.works?.pmid,
                            oaPdfUrl: row.works?.oa_pdf_url,
                          }}
                        />

                        {/* Named by the work, not by the screen. */}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {actions(row).map((action) => (
                            <Link
                              key={action.href + action.label}
                              href={action.href}
                              className={
                                action.primary
                                  ? "bg-accent text-accent-ink text-fine focus-visible:ring-accent inline-flex min-h-9 items-center rounded-lg px-3 focus-visible:ring-2 focus-visible:outline-none"
                                  : "border-border text-muted hover:text-ink text-fine focus-visible:ring-accent inline-flex min-h-9 items-center rounded-lg border px-3 focus-visible:ring-2 focus-visible:outline-none"
                              }
                            >
                              {action.label}
                            </Link>
                          ))}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        {row.due_at && (
                          <span
                            className={`text-fine shrink-0 ${isOverdue ? "text-danger" : "text-muted"}`}
                          >
                            {/* Rendered from a timestamptz; the viewer's locale decides
                        the format. Never do date maths in local time (B-07). */}
                            {isOverdue ? "Overdue " : "Due "}
                            <time dateTime={row.due_at}>
                              {new Date(row.due_at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </time>
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {closedRows.length > 0 && (
            <section>
              <h2 className="text-display text-ink mb-4 opacity-70">Closed</h2>
              <ul className="border-border divide-border divide-y rounded-lg border opacity-70">
                {closedRows.map((row) => {
                  return (
                    <li
                      key={row.id}
                      className="flex items-start justify-between gap-4 p-4"
                    >
                      <div className="min-w-0">
                        <Link
                          href={destination(row).href}
                          className="text-ink text-ui font-medium underline-offset-2 hover:underline"
                        >
                          {row.works?.title ?? "Untitled"}
                        </Link>
                        <p className="text-muted text-fine mt-0.5">
                          <Link
                            href={`/projects/${row.project_id}`}
                            className="hover:text-ink underline underline-offset-2"
                          >
                            {row.projects?.title ?? "Project"}
                          </Link>
                          {" · "}
                          {screenStatusLabel(row.screen_status)}
                          {row.works?.published_year && ` · ${row.works.published_year}`}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <ButtonLink href={destination(row).href} variant="ghost">
                          {destination(row).label}
                        </ButtonLink>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
