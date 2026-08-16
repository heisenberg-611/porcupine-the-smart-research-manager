import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { OPEN_QUEUE_STATUSES } from "@porcupine/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

interface ProjectRow {
  id: string;
  title: string;
  kind: string;
}

interface ProgressRow {
  project_id: string;
  screen_status: string;
  count: number;
  overdue: number;
}

interface QueueRow {
  id: string;
  project_id: string;
  screen_status: string;
  due_at: string | null;
}

/**
 * Where a signed-in person lands.
 *
 * The project LIST used to be this, and a list is not an answer to the
 * question people actually arrive with, which is "what should I be doing".
 * Someone on their own thesis and their supervisor's review has two projects
 * and no idea which of them is waiting on them — the state that decides was
 * spread across two project overviews and a queue.
 *
 * Everything here is a link to the work itself. A dashboard whose numbers you
 * cannot click is a report, and nobody asked for a report.
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const supabase = await createClient();

  // Three reads, none needing another's result. RLS scopes every one of them
  // to projects this person is a member of, so there is no WHERE clause here
  // and there must not be one.
  const [projectData, progressData, queueData] = await Promise.all([
    must(
      supabase
        .from("projects")
        .select("id, title, kind")
        .order("created_at", { ascending: false }),
      "your projects",
    ),
    must(
      supabase
        .from("v_project_progress")
        .select("project_id, screen_status, count, overdue"),
      "progress",
    ),
    must(
      supabase
        .from("project_works")
        .select("id, project_id, screen_status, due_at")
        .eq("assignee_id", user.id)
        .in("screen_status", OPEN_QUEUE_STATUSES as unknown as string[])
        .order("due_at", { ascending: true, nullsFirst: false }),
      "your queue",
    ),
  ]);

  const projects = (projectData ?? []) as unknown as ProjectRow[];
  const progress = (progressData ?? []) as unknown as ProgressRow[];
  const queue = (queueData ?? []) as unknown as QueueRow[];

  const now = Date.now();
  const assigned = queue.length;
  const overdue = queue.filter(
    (row) => row.due_at !== null && new Date(row.due_at).getTime() < now,
  ).length;

  // Undecided means IDENTIFIED or SCREENING — the same rule the project
  // overview and the progress page use. Three screens disagreeing about what
  // "unscreened" means is how a number stops being trusted.
  const undecidedBy = new Map<string, number>();
  const papersBy = new Map<string, number>();
  for (const row of progress) {
    papersBy.set(row.project_id, (papersBy.get(row.project_id) ?? 0) + row.count);
    if (row.screen_status === "IDENTIFIED" || row.screen_status === "SCREENING") {
      undecidedBy.set(row.project_id, (undecidedBy.get(row.project_id) ?? 0) + row.count);
    }
  }

  const totalUndecided = [...undecidedBy.values()].reduce((a, b) => a + b, 0);

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
      <PageHeader
        title="Dashboard"
        description="What is waiting for you, across everything you are on."
        actions={
          <ButtonLink href="/projects/new" variant="primary">
            New project
          </ButtonLink>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="A project is a thesis, a systematic review, or a lab paper. Start one and this fills in."
          action={
            <div className="flex flex-wrap gap-2">
              <ButtonLink href="/projects/new" variant="primary">
                Start your first project
              </ButtonLink>
            </div>
          }
        />
      ) : (
        <>
          <section aria-labelledby="waiting">
            <h2 id="waiting" className="sr-only">
              Waiting for you
            </h2>
            <ul aria-label="Your totals" className="grid grid-cols-3 gap-3">
              <Stat label="Assigned to you" value={assigned} href="/assigned" />
              <Stat
                label="Overdue"
                value={overdue}
                href="/assigned"
                tone={overdue > 0 ? "danger" : "normal"}
              />
              <Stat label="Projects" value={projects.length} href="/projects" />
            </ul>
          </section>

          <section aria-labelledby="projects">
            <h2 id="projects" className="text-ink text-heading mb-3 font-medium">
              Your projects
            </h2>
            <ul className="flex flex-col gap-2">
              {projects.map((project) => {
                const undecided = undecidedBy.get(project.id) ?? 0;
                const papers = papersBy.get(project.id) ?? 0;
                return (
                  <li key={project.id}>
                    <Card className="hover:border-accent/50 flex flex-wrap items-center justify-between gap-3 transition-colors">
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${project.id}`}
                          className="text-ink text-ui font-medium underline-offset-4 hover:underline"
                        >
                          {project.title}
                        </Link>
                        <p className="text-muted text-fine mt-0.5">
                          {papers} {papers === 1 ? "paper" : "papers"}
                          {" · "}
                          {project.kind.replace(/_/g, " ").toLowerCase()}
                        </p>
                      </div>

                      {/* The one number that decides whether to open it. */}
                      {undecided > 0 ? (
                        <Link
                          href={`/projects/${project.id}/screen`}
                          className="text-accent text-fine shrink-0 underline underline-offset-4"
                        >
                          {undecided} to screen
                        </Link>
                      ) : (
                        <span className="text-muted text-fine shrink-0">
                          {papers === 0 ? "empty" : "all screened"}
                        </span>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>

          <p className="text-muted text-fine">
            <Link href="/zotero" className="text-accent underline underline-offset-4">
              Using Zotero
            </Link>{" "}
            — every paper carries a citation you can import.
          </p>

          <p className="text-muted text-fine">
            {totalUndecided > 0
              ? `${totalUndecided} ${totalUndecided === 1 ? "paper is" : "papers are"} undecided across your projects.`
              : "Nothing is undecided across your projects."}
          </p>
        </>
      )}
    </main>
  );
}

/** A count that goes somewhere. Same rule as the project overview. */
function Stat({
  label,
  value,
  href,
  tone = "normal",
}: {
  label: string;
  value: number;
  href: string;
  tone?: "normal" | "danger";
}) {
  return (
    <li>
      <Link
        href={href}
        aria-label={`${value} ${label.toLowerCase()}`}
        className="border-rule hover:border-border hover:bg-surface focus-visible:ring-accent block rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="text-muted text-fine block">{label}</span>
        <span
          className={`text-title mt-1 block font-semibold tabular-nums ${
            tone === "danger" && value > 0 ? "text-danger" : "text-ink"
          }`}
        >
          {value}
        </span>
      </Link>
    </li>
  );
}
