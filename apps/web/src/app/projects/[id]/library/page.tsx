import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ButtonLink, EmptyState, PageHeader, TableScroll } from "@/components/ui";
import { AccessHelp } from "@/components/access-route";
import { Cite } from "@/components/cite";
import { SourceLinks } from "@/components/source-links";
import { getProject } from "@/lib/project";
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
    arxiv_id: string | null;
    pmid: string | null;
    oa_pdf_url: string | null;
  } | null;
}

/** The stored `authors` JSON, as the shape a citation needs. */
function parseAuthors(authors: unknown): { name: string }[] {
  if (!Array.isArray(authors)) return [];
  return authors
    .map((a) => (typeof a === "object" && a && "name" in a ? String(a.name) : null))
    .filter((n): n is string => !!n)
    .map((name) => ({ name }));
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

  const shell = await getProject(id);
  const project = await must(
    supabase.from("projects").select("id, title").eq("id", id).maybeSingle(),
    "the project",
  );

  if (!project) notFound();

  // RLS scopes this to the project; the filter is a view concern only.
  let query = supabase
    .from("project_works")
    .select(
      "id, screen_status, read_status, added_by, created_at, works(title, authors, venue, published_year, doi, arxiv_id, pmid, cited_by_count, oa_pdf_url)",
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
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Library"
        description={
          <>
            {total} {total === 1 ? "paper" : "papers"}
          </>
        }
      />

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
        <EmptyState
          title="Nothing here yet"
          description="Papers you find or import appear here, with their screening status."
          action={
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={`/projects/${id}/search`} variant="primary">
                Search for papers
              </ButtonLink>
              <ButtonLink href={`/projects/${id}/import`}>Import references</ButtonLink>
            </div>
          }
        />
      ) : (
        /* Horizontal scroll is on the wrapper, never the page body. */
        <TableScroll label="Papers in this project">
          <table className="text-ui w-full text-left">
            <caption className="sr-only">Papers in this project, newest first</caption>
            <thead className="border-border text-muted text-fine border-b uppercase">
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
                <tr key={row.id} className="hover:bg-surface/50 group transition-colors">
                  <td className="px-4 py-4">
                    <Link
                      href={`/projects/${id}/read/${row.id}`}
                      className="text-ink hover:text-accent text-lg font-semibold underline-offset-2 transition-colors hover:underline"
                    >
                      {row.works?.title ?? "Untitled"}
                    </Link>
                    <span className="text-muted text-fine mt-0.5 block">
                      <Link
                        href={`/projects/${id}/extract/${row.id}`}
                        className="hover:text-ink underline underline-offset-2"
                      >
                        Extract
                      </Link>
                      {" · "}
                      {authorLine(row.works?.authors)}
                      {row.works?.venue && ` · ${row.works.venue}`}
                    </span>
                    <SourceLinks
                      className="mt-1"
                      title={row.works?.title ?? "this paper"}
                      work={{
                        doi: row.works?.doi,
                        arxivId: row.works?.arxiv_id,
                        pmid: row.works?.pmid,
                        oaPdfUrl: row.works?.oa_pdf_url,
                      }}
                    />
                    <Cite
                      className="mt-1"
                      work={{
                        title: row.works?.title ?? "Untitled",
                        authors: parseAuthors(row.works?.authors),
                        venue: row.works?.venue,
                        publishedYear: row.works?.published_year,
                        doi: row.works?.doi,
                        arxivId: row.works?.arxiv_id,
                      }}
                    />
                    <AccessHelp
                      className="mt-1"
                      route={{
                        url: shell?.access_help_url ?? null,
                        label: shell?.access_help_label ?? null,
                      }}
                      doi={row.works?.doi}
                      title={row.works?.title ?? "this paper"}
                      oaPdfUrl={row.works?.oa_pdf_url}
                    />
                  </td>
                  <td className="text-muted px-4 py-3 tabular-nums">
                    {row.works?.published_year ?? "—"}
                  </td>
                  <td className="text-muted px-4 py-3 tabular-nums">
                    {row.works?.cited_by_count ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-muted text-fine font-mono">
                      {row.screen_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {rows.length === 200 && (
        <p className="text-muted text-ui">
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
      className={`text-ui inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 ${
        active ? "border-accent text-ink" : "border-border text-muted hover:text-ink"
      }`}
    >
      {label}
      <span className="text-muted text-fine tabular-nums">{count}</span>
    </Link>
  );
}
