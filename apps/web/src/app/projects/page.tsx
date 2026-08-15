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
      {/* Sign out lives in the app shell now. Two of them meant two places to
          keep consistent, and the e2e could not tell which one it had clicked. */}
      <PageHeader
        title="Projects"
        actions={
          <ButtonLink href="/projects/new" variant="primary">
            New project
          </ButtonLink>
        }
      />

      {error && (
        <p role="alert" className="text-danger text-ui">
          Could not load projects.
        </p>
      )}

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="A project is a thesis, a systematic review, or a lab paper. It is the unit of membership, permissions and encryption, and its kind decides which screens it has."
          // The first screen a new account lands on. It had no action at all,
          // which is the one place EmptyState's own comment says never to
          // leave empty.
          // Was an in-page anchor to a form below the list. The form has a
          // page of its own now, so this points at it.
          action={
            <ButtonLink href="/projects/new" variant="primary">
              Start your first project
            </ButtonLink>
          }
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
                      <p className="text-muted text-ui mt-1 line-clamp-2">
                        {project.description}
                      </p>
                    )}
                    <p className="text-muted text-fine mt-3 font-mono tracking-wide uppercase">
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
    </main>
  );
}
