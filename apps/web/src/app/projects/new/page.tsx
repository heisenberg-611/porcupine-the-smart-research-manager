import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";

import { NewProjectForm } from "../new-project-form";

export const metadata: Metadata = { title: "New project" };

/**
 * Creating a project, on its own page.
 *
 * It used to sit under the project list, which put an eight-field form —
 * including an irreversible choice of project kind — permanently beneath
 * whatever you actually came to /projects to do. On an account with twenty
 * projects you scrolled past all of them to reach it, and on a new account the
 * list's empty state had to link DOWN the page to a form the reader had
 * already scrolled past.
 *
 * The kind especially deserves a page of its own: it is fixed at creation and
 * decides which screens the project has, which is not a decision to make in a
 * form squeezed under a list.
 */
export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  return (
    <main id="main" className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <PageHeader
        backHref="/projects"
        backLabel="Projects"
        title="New project"
        description="A project is a thesis, a systematic review, or a lab paper. It is the unit of membership, permissions and encryption — and its kind decides which screens it has, so it is worth reading before you fill it in."
      />

      <NewProjectForm />
    </main>
  );
}
