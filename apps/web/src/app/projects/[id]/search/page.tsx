import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getProject } from "@/lib/project";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { SearchClient } from "./search-client";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createClient();

  const project = await getProject(id);
  if (!project) notFound();

  // The keywords are already on the questions — the ranking uses them — so
  // offering them as one-click terms costs nothing and removes the blank-box
  // problem this page opens with.
  const questions = await must(
    supabase.from("questions").select("keywords").eq("project_id", id),
    "the research questions",
  );

  const rows = (questions ?? []) as unknown as { keywords: string[] | null }[];
  const suggestions = [
    ...new Set(rows.flatMap((q) => q.keywords ?? []).map((k) => k.trim())),
  ]
    .filter(Boolean)
    .slice(0, 8);

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Find papers"
        description={
          <>
            Searches OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar together,
            then merges records that describe the same paper.
          </>
        }
      />

      <SearchClient
        projectId={id}
        hasQuestions={rows.length > 0}
        suggestions={suggestions}
      />
    </main>
  );
}
