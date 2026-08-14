import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card } from "@/components/ui";
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
  const { data: project } = await supabase
    .from("projects")
    .select("id, title, description, kind, ownership_model, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  const { data: memberData } = await supabase
    .from("project_members")
    .select(
      "id, user_id, access_role, history_access, joined_at, users(display_name, email)",
    )
    .eq("project_id", id)
    .is("removed_at", null)
    .order("joined_at", { ascending: true });

  const members = (memberData ?? []) as unknown as MemberRow[];
  const me = members.find((m) => m.user_id === user.id);
  const canInvite = me?.access_role === "OWNER" || me?.access_role === "ADMIN";

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <div>
        <Link
          href="/projects"
          className="text-muted hover:text-ink text-sm underline underline-offset-4"
        >
          ← All projects
        </Link>
        <h1 className="text-ink mt-3 text-2xl font-semibold tracking-tight">
          {project.title}
        </h1>
        {project.description && (
          <p className="text-muted mt-2 text-sm text-pretty">{project.description}</p>
        )}
        <p className="text-muted mt-3 font-mono text-xs tracking-wide uppercase">
          {String(project.kind).replace(/_/g, " ")} ·{" "}
          {String(project.ownership_model).replace(/_/g, " ").toLowerCase()}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/projects/${id}/library`}
            className="border-border text-ink hover:bg-surface inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Library
          </Link>
          <Link
            href={`/projects/${id}/search`}
            className="border-border text-ink hover:bg-surface inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Find papers
          </Link>
          <Link
            href={`/projects/${id}/progress`}
            className="border-border text-ink hover:bg-surface inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Progress
          </Link>
          <Link
            href={`/projects/${id}/screen`}
            className="border-border text-ink hover:bg-surface inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Screen
          </Link>
          <Link
            href={`/projects/${id}/import`}
            className="border-border text-ink hover:bg-surface inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Import
          </Link>
        </div>
      </div>

      <section>
        <h2 className="text-ink mb-3 text-lg font-medium">
          Members <span className="text-muted font-normal">({members.length})</span>
        </h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.id}>
              <Card className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <div>
                  <p className="text-ink text-sm font-medium">
                    {member.users?.display_name ?? "Unknown"}
                    {member.user_id === user.id && (
                      <span className="text-muted font-normal"> — you</span>
                    )}
                  </p>
                  <p className="text-muted text-xs">{member.users?.email}</p>
                </div>
                <p className="text-muted font-mono text-xs tracking-wide uppercase">
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
          <h2 className="text-ink mb-1 text-lg font-medium">Add a member</h2>
          <p className="text-muted mb-4 text-sm">
            They need a Porcupine account already. Email invitations arrive in Phase 1.
          </p>
          <InviteMemberForm projectId={project.id} />
        </section>
      )}
    </main>
  );
}
