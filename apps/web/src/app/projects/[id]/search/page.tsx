import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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

  // As elsewhere: no membership check here. RLS returns nothing for a project
  // this user is not a member of, so "not found" and "not permitted" give the
  // same response — which is what we want, since telling them apart confirms
  // the project exists.
  const { data: project } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  const { count } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("project_id", id);

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <div>
        <Link href={`/projects/${id}`} className="text-muted hover:text-ink text-sm">
          ← {project.title}
        </Link>
        <h1 className="text-ink mt-2 text-2xl font-semibold">Find papers</h1>
        <p className="text-muted mt-1 text-sm">
          Searches OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar together,
          then merges records that describe the same paper.
        </p>
      </div>

      <SearchClient projectId={id} hasQuestions={(count ?? 0) > 0} />
    </main>
  );
}
