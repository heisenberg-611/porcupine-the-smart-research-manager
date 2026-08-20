import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getProject } from "@/lib/project";
import { getCurrentUser } from "@/lib/supabase/server";

import { MessagesClient } from "./messages-client";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    /*
     * Wider than a prose column.
     *
     * `max-w-3xl` is a reading measure — right for an abstract, wrong for a
     * conversation that carries a channel list, message rows with names and
     * times, reaction chips and a margin for replies. At 768px all of that
     * competes for the same space and the result reads as cramped.
     */
    /*
     * Fills the column instead of growing past it.
     *
     * The project shell already gives the content column a definite height and
     * its own scrollbar, with the sidebar outside it. A conversation taller
     * than that column therefore scrolled the column — and below `lg`, where
     * the shell has no fixed height, the whole page — carrying the sidebar
     * with it. `h-full` plus `min-h-0` on the children hands the leftover
     * space to the message log, which is the only thing that should scroll.
     */
    <main
      id="main"
      className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-6 lg:h-full lg:min-h-0"
    >
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Messages"
        description="Encrypted in this browser. The server stores who wrote what and when, and cannot read any of it — including the names of the channels."
      />
      <MessagesClient projectId={id} />
    </main>
  );
}
