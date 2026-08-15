import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getProject } from "@/lib/project";
import { getCurrentUser } from "@/lib/supabase/server";

import { KeysClient } from "./keys-client";

export const metadata: Metadata = { title: "Encryption" };

export default async function KeysPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <main id="main" className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Encryption"
        description="This project's content key, and who holds a copy of it. The server stores only sealed copies it cannot open."
      />
      <KeysClient projectId={id} />
    </main>
  );
}
