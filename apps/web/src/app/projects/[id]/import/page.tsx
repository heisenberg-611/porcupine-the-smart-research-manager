import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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

  const { data: project } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <div>
        <Link href={`/projects/${id}`} className="text-muted hover:text-ink text-sm">
          ← {project.title}
        </Link>
        <h1 className="text-ink mt-2 text-2xl font-semibold">Import references</h1>
        <p className="text-muted mt-1 text-sm">
          Bare identifiers are looked up so they arrive with an abstract and citation
          count, not just an id.
        </p>
      </div>

      <ImportClient projectId={id} />
    </main>
  );
}
