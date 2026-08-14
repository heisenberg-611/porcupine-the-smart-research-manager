import { capabilities, type ProjectKind } from "@porcupine/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, EmptyState } from "@/components/ui";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { NewProjectForm } from "./new-project-form";

export const metadata: Metadata = { title: "Projects" };

interface ProjectRow {
  id: string;
  title: string;
  description: string | null;
  kind: ProjectKind;
  created_at: string;
}

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  // Read path is supabase-js, not Prisma (R-02): the JWT travels with the
  // request and PostgREST evaluates RLS against it, with no session state to
  // leak. RLS returns only projects this user is a member of — there is no
  // WHERE clause here and there must not be one.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, title, description, kind, created_at")
    .order("created_at", { ascending: false });

  const projects = (data ?? []) as ProjectRow[];

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Projects</h1>
        <form action="/auth/sign-out" method="post">
          <button className="text-muted hover:text-ink text-sm underline underline-offset-4">
            Sign out
          </button>
        </form>
      </header>

      {error && (
        <p role="alert" className="text-danger text-sm">
          Could not load projects.
        </p>
      )}

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="A project is a thesis, a systematic review, or a lab paper. It's the unit of membership, permissions, and encryption — start one below."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => {
            const caps = capabilities(project.kind);
            return (
              <li key={project.id}>
                <Card className="hover:border-accent/50 transition-colors">
                  <Link href={`/projects/${project.id}`} className="block">
                    <h2 className="text-ink font-medium">{project.title}</h2>
                    {project.description && (
                      <p className="text-muted mt-1 line-clamp-2 text-sm">
                        {project.description}
                      </p>
                    )}
                    <p className="text-muted mt-3 font-mono text-xs tracking-wide uppercase">
                      {project.kind.replace(/_/g, " ")}
                      {caps.protocolRequired && " · protocol required"}
                    </p>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <section className="border-border border-t pt-8">
        <h2 className="text-ink mb-4 text-lg font-medium">New project</h2>
        <NewProjectForm />
      </section>
    </main>
  );
}
