import { isProjectKind } from "@Porcupine/shared";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";

import { ProjectNav } from "@/components/project-nav";
import { ProjectSidebar } from "@/components/project-sidebar";
import { ProjectWorkflowBar } from "@/components/project-workflow-bar";
import { getProject, getProjectRole } from "@/lib/project";
import { projectSections } from "@/lib/project-sections";
import { getCurrentUser } from "@/lib/supabase/server";
import { getProjectWorkflowPipeline } from "@/lib/workflow-pipeline-server";

/**
 * Every screen inside a project gets the project's own navigation and fixed workflow status bar.
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

  const role = await getProjectRole(id, user.id);
  const isOwner = role === "OWNER";

  const kind = isProjectKind(project.kind) ? project.kind : "GENERAL";
  const sections = projectSections(kind);
  const { pipeline } = await getProjectWorkflowPipeline(project.id, kind);

  return (
    <>
      <ProjectNav
        projectId={project.id}
        projectTitle={project.title}
        sections={sections}
      />
      <div className="flex w-full lg:h-[calc(100dvh-var(--app-header-h))] lg:overflow-hidden overscroll-none">
        <ProjectSidebar
          projectId={project.id}
          projectTitle={project.title}
          sections={sections}
          isOwner={isOwner}
        />
        <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-hidden">
          <ProjectWorkflowBar pipeline={pipeline} projectId={project.id} />
          <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:overflow-y-auto lg:overscroll-y-contain lg:px-12">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
