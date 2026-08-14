import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createClient();

  const project = await must(
    supabase.from("projects").select("id, title").eq("id", id).maybeSingle(),
    "the project",
  );

  if (!project) notFound();

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Import references"
        description={
          <>
            Bare identifiers are looked up so they arrive with an abstract and citation
            count, not just an id.
          </>
        }
      />

      <ImportClient projectId={id} />
    </main>
  );
}
