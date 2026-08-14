import { capabilities, OPEN_QUEUE_STATUSES, type ProjectKind } from "@porcupine/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { ScreenClient, type Member, type ScreenRow } from "./screen-client";

export const metadata: Metadata = { title: "Screen" };

interface Row {
  id: string;
  screen_status: string;
  exclude_reason: string | null;
  assignee_id: string | null;
  due_at: string | null;
  works: {
    title: string;
    authors: unknown;
    venue: string | null;
    published_year: number | null;
    abstract: string | null;
  } | null;
}

function authorLine(authors: unknown): string {
  if (!Array.isArray(authors)) return "Unknown authors";
  const names = authors
    .map((a) => (typeof a === "object" && a && "name" in a ? String(a.name) : null))
    .filter((n): n is string => !!n);
  if (names.length === 0) return "Unknown authors";
  return names.length > 3
    ? `${names.slice(0, 3).join(", ")} +${names.length - 3}`
    : names.join(", ");
}

export default async function ScreenPage({
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
    .select("id, title, kind")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

  const { data } = await supabase
    .from("project_works")
    .select(
      "id, screen_status, exclude_reason, assignee_id, due_at, works(title, authors, venue, published_year, abstract)",
    )
    .eq("project_id", id)
    .in("screen_status", ["IDENTIFIED", "SCREENING"])
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(100);

  const rows: ScreenRow[] = ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    screenStatus: row.screen_status,
    excludeReason: row.exclude_reason,
    assigneeId: row.assignee_id,
    dueAt: row.due_at,
    title: row.works?.title ?? "Untitled",
    authors: authorLine(row.works?.authors),
    venue: row.works?.venue ?? null,
    year: row.works?.published_year ?? null,
    abstract: row.works?.abstract ?? null,
  }));

  const { data: memberData } = await supabase
    .from("project_members")
    .select("user_id, users(display_name)")
    .eq("project_id", id)
    .is("removed_at", null);

  const members: Member[] = (
    (memberData ?? []) as unknown as Array<{
      user_id: string;
      users: { display_name: string } | null;
    }>
  ).map((m) => ({ userId: m.user_id, name: m.users?.display_name ?? "Unknown" }));

  // R-06: the UI branches on capabilities(kind), it does not merely label.
  const caps = capabilities(project.kind as ProjectKind);

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div>
        <Link href={`/projects/${id}`} className="text-muted hover:text-ink text-sm">
          ← {project.title}
        </Link>
        <h1 className="text-ink mt-2 text-2xl font-semibold">Screen</h1>
        <p className="text-muted mt-1 text-sm">
          {caps.exclusionReasonRequired
            ? "Exclusions need a reason, so the PRISMA diagram can report them by category."
            : "Include or exclude each paper. Decisions are recorded and can be revised."}
        </p>
      </div>

      <ScreenClient
        projectId={id}
        rows={rows}
        members={members}
        reasonRequired={caps.exclusionReasonRequired}
        currentUserId={user.id}
      />

      <p className="text-muted text-xs">
        Papers waiting: {OPEN_QUEUE_STATUSES.length > 0 ? rows.length : 0}
      </p>
    </main>
  );
}
