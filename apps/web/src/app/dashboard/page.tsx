import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { OPEN_QUEUE_STATUSES } from "@Porcupine/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

interface ProjectRow {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  ownership_model: string;
}

interface ProgressRow {
  project_id: string;
  screen_status: string;
  count: number;
  overdue: number;
}

interface ProjectMemberRow {
  project_id: string;
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
  const [projectData, progressData, queueData, memberData] = await Promise.all([
    must(
      supabase
        .from("projects")
        .select("id, title, description, kind, ownership_model")
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
    must(
      supabase
        .from("project_members")
        .select("project_id"),
      "members",
    ),
  ]);

  const projects = (projectData ?? []) as unknown as ProjectRow[];
  const progress = (progressData ?? []) as unknown as ProgressRow[];
  const queue = (queueData ?? []) as unknown as QueueRow[];
  const memberList = (memberData ?? []) as unknown as ProjectMemberRow[];

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

  const membersBy = new Map<string, number>();
  for (const row of memberList) {
    membersBy.set(row.project_id, (membersBy.get(row.project_id) ?? 0) + 1);
  }

  const totalUndecided = [...undecidedBy.values()].reduce((a, b) => a + b, 0);

  return (
    <main id="main" className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <PageHeader
        title="Dashboard"
        description="What is waiting for you, across everything you are on."
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
            <ul aria-label="Your totals" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            <div className="flex items-end justify-between mb-4">
              <h2 id="projects" className="text-ink text-title font-serif">
                Your projects
              </h2>
            </div>

            <ul className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {projects.map((project) => {
                const undecided = undecidedBy.get(project.id) ?? 0;
                const papers = papersBy.get(project.id) ?? 0;
                const memberCount = membersBy.get(project.id) ?? 0;
                return (
                  <li key={project.id} className="group">
                    <Link href={`/projects/${project.id}`} className="block h-full">
                      <div className="border-rule bg-surface/40 hover:bg-accent/5 hover:border-accent/40 flex h-full flex-col justify-between gap-4 rounded-2xl border p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md backdrop-blur-sm">

                        <div className="flex flex-col gap-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="bg-raised text-muted group-hover:text-accent flex size-10 shrink-0 items-center justify-center rounded-xl shadow-sm transition-colors duration-300">
                                <ProjectIcon kind={project.kind} />
                              </div>
                              <div className="min-w-0">
                                <h3 className="text-ink text-ui truncate font-medium underline-offset-4 group-hover:underline">
                                  {project.title}
                                </h3>
                                <p className="text-muted text-fine mt-0.5 truncate flex flex-wrap items-center gap-1.5">
                                  <span>{project.kind.replace(/_/g, " ").toLowerCase()}</span>
                                  <span className="opacity-50">•</span>
                                  <span className="capitalize">{project.ownership_model.replace(/_/g, " ").toLowerCase()}</span>
                                  <span className="opacity-50">•</span>
                                  <span>{memberCount} {memberCount === 1 ? "member" : "members"}</span>
                                </p>
                              </div>
                            </div>
                          </div>

                          {project.description && (
                            <p className="text-muted text-fine line-clamp-2 leading-relaxed">
                              {project.description}
                            </p>
                          )}
                        </div>

                        <div className="bg-raised/50 border-rule flex items-center justify-between rounded-lg border px-3 py-2">
                          <span className="text-muted text-fine">
                            {papers} {papers === 1 ? "paper" : "papers"}
                          </span>

                          {/* The one number that decides whether to open it. */}
                          {undecided > 0 ? (
                            <span className="text-accent text-fine font-medium">
                              {undecided} to screen
                            </span>
                          ) : (
                            <span className="text-muted text-fine flex items-center gap-1">
                              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              {papers === 0 ? "Empty" : "All screened"}
                            </span>
                          )}
                        </div>

                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="bg-surface/50 border-rule flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border p-5 mt-4">
            <p className="text-muted text-ui">
              {totalUndecided > 0
                ? <><strong className="text-ink">{totalUndecided} {totalUndecided === 1 ? "paper is" : "papers are"}</strong> undecided across your projects.</>
                : "Nothing is undecided across your projects."}
            </p>
            <Link href="/zotero" className="text-accent text-ui font-medium underline underline-offset-4 hover:brightness-110 transition-all">
              Connect Zotero
            </Link>
          </div>
        </>
      )}
    </main>
  );
}

function ProjectIcon({ kind }: { kind: string }) {
  if (kind === "THESIS") {
    return (
      <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    );
  }
  if (kind === "LAB_PAPER") {
    return (
      <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    );
  }
  return (
    <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

/** A premium stat card. */
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
        className="group border-rule bg-surface/30 hover:border-accent/40 hover:bg-accent/5 focus-visible:ring-accent relative block overflow-hidden rounded-2xl border p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg focus-visible:ring-2 focus-visible:outline-none backdrop-blur-sm"
      >
        <span className="text-muted text-ui group-hover:text-ink relative z-10 block font-medium transition-colors">
          {label}
        </span>
        <span
          className={`text-display mt-2 block font-serif tabular-nums relative z-10 ${tone === "danger" && value > 0 ? "text-danger" : "text-ink"
            }`}
        >
          {value}
        </span>

        {/* Subtle background glow effect on hover */}
        <div className="absolute -inset-x-4 -bottom-4 h-1/2 bg-gradient-to-t from-accent/5 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      </Link>
    </li>
  );
}
