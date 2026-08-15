import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { listQuestions } from "./actions";
import { QuestionsClient } from "./questions-client";

export const metadata: Metadata = { title: "Research questions" };

export default async function QuestionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createClient();

  // As elsewhere: no membership check. RLS returns nothing for a project this
  // user is not in, so "not found" and "not permitted" are one response.
  const project = await must(
    supabase.from("projects").select("id, title").eq("id", id).maybeSingle(),
    "the project",
  );

  if (!project) notFound();

  const membership = await must(
    supabase
      .from("project_members")
      .select("access_role")
      .eq("project_id", id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle(),
    "your membership",
  );

  const role = (membership as { access_role?: string } | null)?.access_role;
  const canEdit = role === "OWNER" || role === "ADMIN";

  const questions = await listQuestions(id);
  if (!questions.ok) throw new Error(questions.error);

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Research questions"
        description={
          <>
            What this review is asking. Search ranks every result against the keywords
            here, and each result says which of them it matched — which is what makes a
            search strategy something you can defend rather than assert.
          </>
        }
      />

      <QuestionsClient projectId={id} initial={questions.data} canEdit={canEdit} />

      {!canEdit && (
        <p className="text-muted text-fine">
          {/* Said rather than shown as a set of disabled buttons: a control you
              cannot use is worse than one that is not there. */}
          Only an owner or admin can change the questions. They shape what
          everyone&rsquo;s searches return, so they are not edited casually.
        </p>
      )}
    </main>
  );
}
