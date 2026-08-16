import { capabilities, type ProjectKind } from "@porcupine/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Projects" };

interface ProjectRow {
  id: string;
  title: string;
  description: string | null;
  kind: ProjectKind;
  created_at: string;
}

function ProjectIcon({ kind, className }: { kind: ProjectKind; className?: string }) {
  switch (kind) {
    case "THESIS":
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path d="M12 14l9-5-9-5-9 5 9 5z" />
          <path d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
        </svg>
      );
    case "SYSTEMATIC_REVIEW":
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      );
    case "LAB_PAPER":
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      );
    case "GENERAL":
    default:
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      );
  }
}

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  // Read path is supabase-js, not Prisma (R-02): the JWT travels with the
  // request and PostgREST evaluates RLS against it, with no session state to
  // leak. RLS returns only projects this user is a member of — there is no
  // WHERE clause here and there must not be one.
  const supabase = await createClient();
  const [projectsResponse, membersResponse] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, description, kind, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("project_members")
      .select("project_id")
  ]);

  const { data, error } = projectsResponse;
  const projects = (data ?? []) as ProjectRow[];

  const memberList = (membersResponse.data ?? []) as { project_id: string }[];
  const membersBy = new Map<string, number>();
  for (const row of memberList) {
    membersBy.set(row.project_id, (membersBy.get(row.project_id) ?? 0) + 1);
  }

  return (
    <main id="main" className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Your Projects"
        actions={
          <ButtonLink href="/projects/new" variant="primary" className="shadow-sm">
            <svg className="w-4 h-4 mr-2 -ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New project
          </ButtonLink>
        }
      />

      {error && (
        <p role="alert" className="text-danger text-ui bg-danger-soft/20 p-4 rounded-lg border border-danger/20">
          Could not load projects.
        </p>
      )}

      {projects.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No projects yet"
            description="A project is a thesis, a systematic review, or a lab paper. It is the unit of membership, permissions and encryption, and its kind decides which screens it has."
            action={
              <ButtonLink href="/projects/new" variant="primary" className="shadow-sm">
                Start your first project
              </ButtonLink>
            }
          />
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => {
            const caps = capabilities(project.kind);
            const memberCount = membersBy.get(project.id) ?? 0;
            return (
              <li key={project.id} className="group">
                <Link href={`/projects/${project.id}`} className="block h-full">
                  <Card className="h-full flex flex-col p-6 border-border/60 hover:border-accent/40 bg-surface/50 hover:bg-surface hover:shadow-md hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-accent/20 to-accent/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    
                    <div className="flex-1">
                      <h2 className="text-ink text-xl font-bold tracking-tight mb-2 group-hover:text-accent transition-colors">{project.title}</h2>
                      {project.description && (
                        <p className="text-muted text-ui leading-relaxed line-clamp-3">
                          {project.description}
                        </p>
                      )}
                    </div>
                    
                    <div className="mt-6 pt-4 border-t border-border/50 flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-muted text-[11px] font-mono tracking-wider uppercase font-semibold">
                        <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-canvas/80 border border-border/50">
                          <ProjectIcon kind={project.kind} className="w-3.5 h-3.5 text-accent" />
                          {project.kind.replace(/_/g, " ")}
                        </span>
                        <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-canvas/80 border border-border/50">
                          <svg className="w-3.5 h-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                          {memberCount} {memberCount === 1 ? "Member" : "Members"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-muted text-fine mt-1">
                        <span>Created {new Date(project.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        {caps.protocolRequired && (
                          <span className="text-accent/80 flex items-center gap-1" title="Protocol Required">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            Required
                          </span>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
