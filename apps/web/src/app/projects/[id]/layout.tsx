import { isProjectKind } from "@porcupine/shared";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";

import { ProjectNav } from "@/components/project-nav";
import { getProject } from "@/lib/project";
import { projectSections } from "@/lib/project-sections";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * Every screen inside a project gets the project's own navigation.
 *
 * This layout exists so the nav can be a SERVER component that knows the
 * project: it reads the kind, works out which sections that kind has, and
 * hands a finished list to the small client component that only needs the
 * pathname. The alternative — putting project state into the root header —
 * would have meant a context provider and a client fetch on every page.
 *
 * The query goes through `getProject()`, which is wrapped in React's `cache()`
 * — so the overview page below asks for the same row and pays nothing.
 * supabase-js queries are not deduplicated by anything the way `fetch` is, so
 * without that this layout would add a second identical round trip to every
 * project screen.
 *
 * No membership check here, for the same reason the pages omit it: RLS returns
 * nothing for a project this user is not in, so "not found" and "not
 * permitted" are one response — which is also what we want, since telling them
 * apart confirms the project exists.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const project = await getProject(id);

  if (!project) notFound();

  // A kind the app does not know about is a data problem, not a reason to
  // render a nav with everything switched off. Fall back to the most
  // restrictive set rather than guessing generously.
  const kind = isProjectKind(project.kind) ? project.kind : "GENERAL";

  return (
    <>
      <ProjectNav
        projectId={project.id}
        projectTitle={project.title}
        sections={projectSections(kind)}
      />
      {children}
    </>
  );
}
