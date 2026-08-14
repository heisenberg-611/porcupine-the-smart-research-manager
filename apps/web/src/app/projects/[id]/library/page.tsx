import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Library" };

const SCREEN_STATUSES = [
  "IDENTIFIED",
  "SCREENING",
  "INCLUDED",
  "EXCLUDED",
  "READING",
  "EXTRACTED",
  "SYNTHESIZED",
] as const;

interface LibraryRow {
  id: string;
  screen_status: string;
  read_status: string;
  added_by: string;
  created_at: string;
  works: {
    title: string;
    authors: unknown;
    venue: string | null;
    published_year: number | null;
    doi: string | null;
    cited_by_count: number;
    oa_pdf_url: string | null;
  } | null;
}

function authorLine(authors: unknown): string {
  if (!Array.isArray(authors)) return "";
  const names = authors
    .map((a) => (typeof a === "object" && a && "name" in a ? String(a.name) : null))
    .filter((n): n is string => !!n);
  if (names.length === 0) return "";
  return names.length > 3
    ? `${names.slice(0, 3).join(", ")} +${names.length - 3}`
    : names.join(", ");
}

export default async function LibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const { status } = await searchParams;
  const supabase = await createClient();

  const project = await must(
    supabase.from("projects").select("id, title").eq("id", id).maybeSingle(),
    "the project",
  );

  if (!project) notFound();

  // RLS scopes this to the project; the filter is a view concern only.
  let query = supabase
    .from("project_works")
    .select(
      "id, screen_status, read_status, added_by, created_at, works(title, authors, venue, published_year, doi, cited_by_count, oa_pdf_url)",
    )
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (status && (SCREEN_STATUSES as readonly string[]).includes(status)) {
    query = query.eq("screen_status", status);
  }

  const data = await must(query, "the library");
  const rows = (data ?? []) as unknown as LibraryRow[];

  // Counts for the filter chips, from a separate unfiltered read.
  const allData = await must(
    supabase.from("project_works").select("screen_status").eq("project_id", id),
    "library counts",
  );

  const counts = new Map<string, number>();
  for (const row of (allData ?? []) as Array<{ screen_status: string }>) {
    counts.set(row.screen_status, (counts.get(row.screen_status) ?? 0) + 1);
  }
  const total = (allData ?? []).length;

  return (
    <main id="main" className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-12">
      <div>
        <Link href={`/projects/${id}`} className="text-muted hover:text-ink text-sm">
          ← {project.title}
        </Link>
        <h1 className="text-ink mt-2 text-2xl font-semibold">Library</h1>
        <p className="text-muted mt-1 text-sm">
          {total} {total === 1 ? "paper" : "papers"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip
          href={`/projects/${id}/library`}
          active={!status}
          label="All"
          count={total}
        />
        {SCREEN_STATUSES.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => (
          <FilterChip
            key={s}
            href={`/projects/${id}/library?status=${s}`}
            active={status === s}
            label={s.charAt(0) + s.slice(1).toLowerCase()}
            count={counts.get(s) ?? 0}
          />
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="border-border text-muted rounded-lg border border-dashed p-8 text-center text-sm">
          <p>Nothing here yet.</p>
          <p className="mt-2">
            <Link href={`/projects/${id}/search`} className="text-accent underline">
              Search for papers
            </Link>{" "}
            or{" "}
            <Link href={`/projects/${id}/import`} className="text-accent underline">
              import references
            </Link>
            .
          </p>
        </div>
      ) : (
        /* Horizontal scroll is on the wrapper, never the page body. */
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Papers in this project, newest first</caption>
            <thead className="border-border text-muted border-b text-xs uppercase">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Title
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Year
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Citations
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${id}/read/${row.id}`}
                      className="text-ink font-medium underline-offset-2 hover:underline"
                    >
                      {row.works?.title ?? "Untitled"}
                    </Link>
                    <span className="text-muted mt-0.5 block text-xs">
                      {authorLine(row.works?.authors)}
                      {row.works?.venue && ` · ${row.works.venue}`}
                      {row.works?.oa_pdf_url && " · open access"}
                    </span>
                  </td>
                  <td className="text-muted px-4 py-3 tabular-nums">
                    {row.works?.published_year ?? "—"}
                  </td>
                  <td className="text-muted px-4 py-3 tabular-nums">
                    {row.works?.cited_by_count ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-muted font-mono text-xs">
                      {row.screen_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 200 && (
        <p className="text-muted text-sm">
          Showing the 200 most recent. Paging arrives with screening.
        </p>
      )}
    </main>
  );
}

function FilterChip({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${
        active ? "border-accent text-ink" : "border-border text-muted hover:text-ink"
      }`}
    >
      {label}
      <span className="text-muted text-xs tabular-nums">{count}</span>
    </Link>
  );
}
