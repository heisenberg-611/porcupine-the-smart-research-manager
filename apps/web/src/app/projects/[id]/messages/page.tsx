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
    <main id="main" className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
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
