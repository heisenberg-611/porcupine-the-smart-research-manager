import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import Link from "next/link";
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
      className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 lg:h-full lg:min-h-0 lg:px-6"
    >
      {/*
        A compact header, because every pixel here is taken from the
        conversation.

        Measured before changing it: the full PageHeader plus the stacked
        channel controls left the message log 239px tall on a 900px screen —
        the reason the chat "felt so small" was mostly chrome, not the log.
        The encryption claim stays, because it is the thing this page is
        promising, but it says it in one line rather than three.
      */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-3">
          <Link
            href={`/projects/${id}`}
            className="text-muted hover:text-ink text-fine underline underline-offset-2"
          >
            {project.title}
          </Link>
          <h1 className="text-ink text-heading font-medium">Messages</h1>
        </div>
        <p className="text-muted text-fine">
          Encrypted in this browser — the server cannot read any of it, including the
          channel names.
        </p>
      </div>
      <MessagesClient projectId={id} />
    </main>
  );
}
