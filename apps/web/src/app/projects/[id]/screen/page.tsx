import { capabilities, orderForMember, type ProjectKind } from "@porcupine/shared";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getProject } from "@/lib/project";
import { must } from "@/lib/supabase/query";
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
    doi: string | null;
    arxiv_id: string | null;
    pmid: string | null;
    oa_pdf_url: string | null;
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

  const shell = await getProject(id);
  const project = await must(
    supabase.from("projects").select("id, title, kind").eq("id", id).maybeSingle(),
    "the project",
  );

  if (!project) notFound();

  const data = await must(
    supabase
      .from("project_works")
      .select(
        "id, screen_status, exclude_reason, assignee_id, due_at, works(title, authors, venue, published_year, abstract, doi, arxiv_id, pmid, oa_pdf_url)",
      )
      .eq("project_id", id)
      .in("screen_status", ["IDENTIFIED", "SCREENING"])
      .order("relevance_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(100),
    "papers to screen",
  );

  // Every member is served the same relevance-ranked pool in a DIFFERENT
  // deterministic order.
  //
  // Before this, all four members of the exit trial were handed the same list
  // starting at position zero, so they screened the same papers: 20 decisions
  // produced 5 screened papers. The compare-and-swap refused the other 15
  // correctly, but fifteen refused decisions is still most of an afternoon.
  //
  // Ordering happens AFTER the relevance query, so the team is still working
  // the papers that matter — this distributes where each person starts, it
  // does not hand out different papers.
  const ordered = orderForMember(
    (data ?? []) as unknown as Array<Row & { id: string }>,
    user.id,
  );

  const rows: ScreenRow[] = ordered.map((row) => ({
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
    doi: row.works?.doi ?? null,
    arxivId: row.works?.arxiv_id ?? null,
    pmid: row.works?.pmid ?? null,
    oaPdfUrl: row.works?.oa_pdf_url ?? null,
  }));

  const memberData = await must(
    supabase
      .from("project_members")
      .select("user_id, users(display_name)")
      .eq("project_id", id)
      .is("removed_at", null),
    "project members",
  );

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
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Screen"
        description={
          <>
            {caps.exclusionReasonRequired
              ? "Exclusions need a reason, so the PRISMA diagram can report them by category."
              : "Include or exclude each paper. Decisions are recorded and can be revised."}
          </>
        }
      />

      <ScreenClient
        // Cached by the layout above, so this costs nothing.
        accessRoute={{
          url: shell?.access_help_url ?? null,
          label: shell?.access_help_label ?? null,
        }}
        projectId={id}
        rows={rows}
        members={members}
        reasonRequired={caps.exclusionReasonRequired}
        currentUserId={user.id}
      />
    </main>
  );
}
