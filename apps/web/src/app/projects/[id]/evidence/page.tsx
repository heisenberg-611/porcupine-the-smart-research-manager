import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import {
  evidenceSearchParams,
  fetchEvidenceRows,
  parseEvidenceQuery,
  PAGE_SIZE,
  type EvidenceCell,
  type EvidenceRow,
} from "@/lib/evidence";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { EvidenceControls } from "./evidence-controls";

export const metadata: Metadata = { title: "Evidence" };

interface FieldRow {
  id: string;
  key: string;
  label: string;
  type: string;
  order: number;
}

interface CoverageRow {
  question_id: string;
  question_text: string;
  question_order: number;
  field_count: number;
  included_papers: number;
  papers_answered: number;
}

export default async function EvidencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const project = await must(
    supabase.from("projects").select("id, title").eq("id", id).maybeSingle(),
    "the project",
  );
  if (!project) notFound();

  const protocol = await must(
    supabase
      .from("protocols")
      .select("id, name, version, protocol_fields(id, key, label, type, order)")
      .eq("project_id", id)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "the protocol",
  );

  // No protocol is not an error, it is a stage of the work. Say what to do.
  if (!protocol) {
    return (
      <main id="main" className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-12">
        <PageHeader
          backHref={`/projects/${id}`}
          backLabel={project.title}
          title="Evidence"
        />
        <EmptyState
          title="There is no protocol yet"
          description="The evidence table is built from the protocol's fields, so it needs one first. A protocol is the list of questions you ask every paper."
          action={
            <ButtonLink href={`/projects/${id}/protocol`} variant="primary">
              Build the protocol
            </ButtonLink>
          }
        />
      </main>
    );
  }

  const fields = [
    ...((protocol as unknown as { protocol_fields: FieldRow[] }).protocol_fields ?? []),
  ].sort((a, b) => a.order - b.order);

  const query = parseEvidenceQuery(sp);
  const rows = await fetchEvidenceRows(id, protocol.id, query);

  const coverage = (await must(
    supabase
      .from("v_question_coverage")
      .select(
        "question_id, question_text, question_order, field_count, included_papers, papers_answered",
      )
      .eq("project_id", id)
      .order("question_order", { ascending: true }),
    "question coverage",
  )) as unknown as CoverageRow[];

  const total = rows[0]?.total_rows ?? 0;
  const page = Math.floor(query.offset / PAGE_SIZE) + 1;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/projects/${id}/evidence${evidenceSearchParams(query, p)}`;

  // 4.6. Only worth surfacing when it is a problem — a coverage panel that is
  // always green is furniture people learn to stop reading.
  const gaps = coverage.filter((c) => c.field_count > 0 && c.papers_answered === 0);

  return (
    <main id="main" className="mx-auto flex max-w-full flex-col gap-6 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Evidence"
        description={
          <>
            {protocol.name} v{protocol.version} · {total}{" "}
            {total === 1 ? "extraction" : "extractions"}
          </>
        }
      />

      {gaps.length > 0 && (
        <section
          aria-labelledby="coverage-gaps"
          className="border-danger/40 bg-danger-soft rounded-lg border p-4"
        >
          <h2 id="coverage-gaps" className="text-heading text-ink">
            {gaps.length === 1
              ? "One question has no evidence behind it"
              : `${gaps.length} questions have no evidence behind them`}
          </h2>
          <p className="text-ui text-ink-soft measure mt-1">
            Nothing has been extracted for these, so the review would currently answer
            them with nothing.
          </p>
          <ul className="text-ui text-ink-soft mt-3 flex list-disc flex-col gap-1 pl-5">
            {gaps.map((c) => (
              <li key={c.question_id}>{c.question_text}</li>
            ))}
          </ul>
        </section>
      )}

      <EvidenceControls
        projectId={id}
        fields={fields.map((f) => ({ key: f.key, label: f.label }))}
        sort={query.sort}
        dir={query.dir}
        filterKey={query.filterKey}
        filterText={query.filterText}
        groupKey={query.groupKey}
        onlyIncomplete={query.onlyIncomplete}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={
            query.filterText || query.onlyIncomplete
              ? "Nothing matches those filters"
              : "No extractions yet"
          }
          description={
            query.filterText || query.onlyIncomplete
              ? "Every extraction is still there — the filter is hiding them."
              : "Once someone extracts against the protocol, each paper becomes a row here."
          }
          action={
            query.filterText || query.onlyIncomplete ? (
              <ButtonLink href={`/projects/${id}/evidence`}>Clear the filters</ButtonLink>
            ) : (
              <ButtonLink href={`/projects/${id}/library`} variant="primary">
                Go to the library
              </ButtonLink>
            )
          }
        />
      ) : (
        <>
          {/* Horizontal scroll belongs to the table, never the page body — a
              20-column evidence table would otherwise drag the whole layout
              sideways on a laptop.

              The paper column is sticky from `sm` UP, not on a phone. A
              sticky column is opaque and sits on top of what scrolls under
              it; at 370px wide it covers most of the table, and the mobile
              e2e run caught exactly that — a cell link that could not be
              clicked because the title column was permanently over it. On a
              phone, scrolling the title away is better than losing a
              column. */}
          <div className="border-border overflow-x-auto rounded-lg border">
            <table className="text-ui w-full text-left">
              <caption className="sr-only">
                Extractions, one row per paper, one column per protocol field
              </caption>
              <thead className="border-border text-muted text-fine border-b uppercase">
                <tr>
                  <SortableHeader
                    label="Paper"
                    sortKey="title"
                    query={query}
                    projectId={id}
                    sticky
                  />
                  <SortableHeader
                    label="Year"
                    sortKey="year"
                    query={query}
                    projectId={id}
                  />
                  <SortableHeader
                    label="Done"
                    sortKey="answered"
                    query={query}
                    projectId={id}
                  />
                  {fields.map((f) => (
                    <SortableHeader
                      key={f.id}
                      label={f.label}
                      sortKey={`field:${f.key}`}
                      query={query}
                      projectId={id}
                    />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {rows.map((row, index) => (
                  <Row
                    key={row.extraction_id}
                    row={row}
                    previous={rows[index - 1]}
                    fields={fields}
                    projectId={id}
                    grouped={!!query.groupKey}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-muted text-ui">
              {total} {total === 1 ? "extraction" : "extractions"}
              {lastPage > 1 && ` · page ${page} of ${lastPage}`}
            </p>

            <div className="flex flex-wrap gap-2">
              {page > 1 && <ButtonLink href={href(page - 1)}>Previous</ButtonLink>}
              {page < lastPage && <ButtonLink href={href(page + 1)}>Next</ButtonLink>}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

/**
 * A header that is also the sort control.
 *
 * A link, not a button: sorting is a different URL, so it should be
 * shareable, openable in a new tab, and survive a reload. `aria-sort` is what
 * a screen reader announces, and it belongs on the th rather than the link.
 */
function SortableHeader({
  label,
  sortKey,
  query,
  projectId,
  sticky = false,
}: {
  label: string;
  sortKey: string;
  query: ReturnType<typeof parseEvidenceQuery>;
  projectId: string;
  sticky?: boolean;
}) {
  const active = query.sort === sortKey;
  const nextDir = active && query.dir === "asc" ? "desc" : "asc";
  const search = evidenceSearchParams({ ...query, sort: sortKey, dir: nextDir }, 1);

  return (
    <th
      scope="col"
      aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-3 font-medium ${sticky ? "bg-canvas sm:sticky sm:left-0" : ""}`}
    >
      <Link
        href={`/projects/${projectId}/evidence${search}`}
        className={`inline-flex min-h-11 items-center gap-1 ${active ? "text-ink" : "hover:text-ink"}`}
      >
        {label}
        <span aria-hidden="true">{active ? (query.dir === "asc" ? "↑" : "↓") : ""}</span>
        <span className="sr-only">
          {active
            ? `, sorted ${query.dir === "asc" ? "ascending" : "descending"}. Activate to reverse.`
            : ", activate to sort by this column"}
        </span>
      </Link>
    </th>
  );
}

function Row({
  row,
  previous,
  fields,
  projectId,
  grouped,
}: {
  row: EvidenceRow;
  previous: EvidenceRow | undefined;
  fields: FieldRow[];
  projectId: string;
  grouped: boolean;
}) {
  const startsGroup = grouped && (!previous || previous.group_label !== row.group_label);

  return (
    <>
      {startsGroup && (
        <tr className="bg-surface">
          <th
            scope="colgroup"
            colSpan={fields.length + 3}
            className="text-fine text-muted px-4 py-2 text-left font-medium uppercase"
          >
            {row.group_label ?? "No answer"}
          </th>
        </tr>
      )}
      <tr>
        <td className="bg-canvas px-4 py-3 sm:sticky sm:left-0">
          <Link
            href={`/projects/${projectId}/read/${row.project_work_id}`}
            className="text-ink font-medium underline-offset-2 hover:underline"
          >
            {row.work_title}
          </Link>
        </td>
        <td className="text-muted px-4 py-3 tabular-nums">{row.published_year ?? "—"}</td>
        <td className="text-muted px-4 py-3 tabular-nums">
          {row.answered}/{row.field_total}
        </td>
        {fields.map((f) => (
          <Cell
            key={f.id}
            cell={row.cells?.[f.key]}
            label={f.label}
            projectId={projectId}
            projectWorkId={row.project_work_id}
          />
        ))}
      </tr>
    </>
  );
}

/**
 * One cell.
 *
 * 4.5: an unanswered cell must not look like an answered one. A blank <td> is
 * exactly what a short answer looks like at a glance, so a hole is drawn as a
 * dash with a screen-reader label — the incomplete row has to LOOK incomplete
 * or the table quietly launders missing data as absence of finding.
 *
 * 4.3: a cell with an anchor links to the passage it came from.
 */
function Cell({
  cell,
  label,
  projectId,
  projectWorkId,
}: {
  cell: EvidenceCell | undefined;
  label: string;
  projectId: string;
  projectWorkId: string;
}) {
  if (!cell || !cell.answered) {
    return (
      <td className="px-4 py-3">
        <span className="text-muted/60" aria-hidden="true">
          —
        </span>
        <span className="sr-only">{label}: not answered</span>
      </td>
    );
  }

  const text = cell.text ?? "";

  /*
   * One line per cell, with the full value in `title` and the whole thing in
   * the export.
   *
   * Two reasons, one of them found the hard way. An evidence table is scanned
   * ACROSS a row and DOWN a column; a quoted passage that wraps to five lines
   * makes every other row on screen taller and destroys both. Uniform rows are
   * what makes twenty columns readable at all.
   *
   * The other reason is that a wrapped inline link's bounding box spans its
   * line boxes, so its centre point can land in the gap BETWEEN two lines —
   * where the click hits the cell instead of the link. The mobile e2e run
   * caught that: a link that was visible, enabled and stable, and not
   * clickable. A single-line block is a target the whole way across.
   */
  if (cell.anchorId) {
    return (
      <td className="px-4 py-3">
        <Link
          href={`/projects/${projectId}/read/${projectWorkId}?anchor=${cell.anchorId}`}
          title={text}
          className="text-ink block max-w-[18rem] truncate underline decoration-dotted underline-offset-4"
        >
          {text}
          <span className="sr-only"> — open the passage this came from</span>
        </Link>
      </td>
    );
  }

  return (
    <td className="px-4 py-3">
      <span title={text} className="text-ink-soft block max-w-[18rem] truncate">
        {text}
      </span>
    </td>
  );
}
