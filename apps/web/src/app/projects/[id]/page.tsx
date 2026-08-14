import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { InviteMemberForm } from "./invite-member-form";

export const metadata: Metadata = { title: "Project" };

interface MemberRow {
  id: string;
  user_id: string;
  access_role: string;
  history_access: string;
  joined_at: string | null;
  users: { display_name: string; email: string } | null;
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createClient();

  // No membership check in this file. RLS returns nothing for a project this
  // user is not a member of, so "not found" and "not permitted" are the same
  // response — which is also the behaviour we want, since distinguishing them
  // confirms the project exists.
  const project = await must(
    supabase
      .from("projects")
      .select("id, title, description, kind, ownership_model, created_at")
      .eq("id", id)
      .maybeSingle(),
    "the project",
  );

  if (!project) notFound();

  const memberData = await must(
    supabase
      .from("project_members")
      .select(
        "id, user_id, access_role, history_access, joined_at, users(display_name, email)",
      )
      .eq("project_id", id)
      .is("removed_at", null)
      .order("joined_at", { ascending: true }),
    "project members",
  );

  const members = (memberData ?? []) as unknown as MemberRow[];
  const me = members.find((m) => m.user_id === user.id);
  const canInvite = me?.access_role === "OWNER" || me?.access_role === "ADMIN";

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <div>
        <Link
          href="/projects"
          className="text-muted hover:text-ink text-ui underline underline-offset-4"
        >
          ← All projects
        </Link>
        <h1 className="text-ink text-title mt-3 font-semibold tracking-tight">
          {project.title}
        </h1>
        {project.description && (
          <p className="text-muted text-ui mt-2 text-pretty">{project.description}</p>
        )}
        <p className="text-muted text-fine mt-3 font-mono tracking-wide uppercase">
          {String(project.kind).replace(/_/g, " ")} ·{" "}
          {String(project.ownership_model).replace(/_/g, " ").toLowerCase()}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/projects/${id}/library`}
            className="border-border text-ink hover:bg-surface text-ui inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            Library
          </Link>
          <Link
            href={`/projects/${id}/search`}
            className="border-border text-ink hover:bg-surface text-ui inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            Find papers
          </Link>
          <Link
            href={`/projects/${id}/protocol`}
            className="border-border text-ink hover:bg-surface text-ui inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            Protocol
          </Link>
          <Link
            href={`/projects/${id}/evidence`}
            className="border-border text-ink hover:bg-surface text-ui inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            Evidence
          </Link>
          <Link
            href={`/projects/${id}/reconcile`}
            className="border-border text-ink hover:bg-surface text-ui inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            Reconcile
          </Link>
          <Link
            href={`/projects/${id}/prisma`}
            className="border-border text-ink hover:bg-surface text-ui inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            PRISMA
          </Link>
          <Link
            href={`/projects/${id}/progress`}
            className="border-border text-ink hover:bg-surface text-ui inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            Progress
          </Link>
          <Link
            href={`/projects/${id}/screen`}
            className="border-border text-ink hover:bg-surface text-ui inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            Screen
          </Link>
          <Link
            href={`/projects/${id}/import`}
            className="border-border text-ink hover:bg-surface text-ui inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            Import
          </Link>
        </div>
      </div>

      <section>
        <h2 className="text-ink text-heading mb-3 font-medium">
          Members <span className="text-muted font-normal">({members.length})</span>
        </h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.id}>
              <Card className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <div>
                  <p className="text-ink text-ui font-medium">
                    {member.users?.display_name ?? "Unknown"}
                    {member.user_id === user.id && (
                      <span className="text-muted font-normal"> — you</span>
                    )}
                  </p>
                  <p className="text-muted text-fine">{member.users?.email}</p>
                </div>
                <p className="text-muted text-fine font-mono tracking-wide uppercase">
                  {member.access_role}
                  {member.history_access === "FROM_JOIN" && " · from join"}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {canInvite && (
        <section className="border-border border-t pt-8">
          <h2 className="text-ink text-heading mb-1 font-medium">Add a member</h2>
          <p className="text-muted text-ui mb-4">
            They need a Porcupine account already. Email invitations arrive in Phase 1.
          </p>
          <InviteMemberForm projectId={project.id} />
        </section>
      )}
    </main>
  );
}
