import { OPEN_QUEUE_STATUSES, screenStatusLabel } from "@porcupine/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My queue" };

interface QueueRow {
  id: string;
  project_id: string;
  screen_status: string;
  due_at: string | null;
  projects: { title: string } | null;
  works: { title: string; published_year: number | null } | null;
}

/**
 * Everything assigned to me, across every project, soonest due first.
 *
 * Deliberately cross-project. A doctoral student is usually on their own
 * thesis and their supervisor's review at the same time, and a per-project
 * queue means they have to remember which projects to check — which is
 * exactly the "keeping tabs on a thousand things" problem this product
 * exists to remove.
 *
 * No RLS special-casing is needed: the policy already scopes project_works
 * to projects the caller is a member of, so filtering by assignee is purely
 * a narrowing.
 */
export default async function QueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const supabase = await createClient();

  const data = await must(
    supabase
      .from("project_works")
      .select(
        "id, project_id, screen_status, due_at, projects(title), works(title, published_year)",
      )
      .eq("assignee_id", user.id)
      .in("screen_status", OPEN_QUEUE_STATUSES as unknown as string[])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(200),
    "your queue",
  );

  const rows = (data ?? []) as unknown as QueueRow[];
  const now = Date.now();
  const overdue = rows.filter((r) => r.due_at && new Date(r.due_at).getTime() < now);

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div>
        <Link href="/projects" className="text-muted hover:text-ink text-sm">
          ← All projects
        </Link>
        <h1 className="text-ink mt-2 text-2xl font-semibold">My queue</h1>
        <p className="text-muted mt-1 text-sm">
          {rows.length === 0
            ? "Nothing assigned to you."
            : `${rows.length} assigned${overdue.length > 0 ? ` · ${overdue.length} overdue` : ""}`}
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {rows.map((row) => {
            const isOverdue = row.due_at ? new Date(row.due_at).getTime() < now : false;
            return (
              <li key={row.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="text-ink text-sm font-medium">
                    {row.works?.title ?? "Untitled"}
                  </p>
                  <p className="text-muted mt-0.5 text-xs">
                    <Link
                      href={`/projects/${row.project_id}`}
                      className="hover:text-ink underline underline-offset-2"
                    >
                      {row.projects?.title ?? "Project"}
                    </Link>
                    {" · "}
                    {screenStatusLabel(row.screen_status)}
                    {row.works?.published_year && ` · ${row.works.published_year}`}
                  </p>
                </div>

                {row.due_at && (
                  <span
                    className={`shrink-0 text-xs ${isOverdue ? "text-danger" : "text-muted"}`}
                  >
                    {/* Rendered from a timestamptz; the viewer's locale decides
                        the format. Never do date maths in local time (B-07). */}
                    {isOverdue ? "Overdue " : "Due "}
                    <time dateTime={row.due_at}>
                      {new Date(row.due_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
