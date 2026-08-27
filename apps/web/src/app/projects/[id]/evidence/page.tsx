import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ButtonLink, EmptyState, PageHeader, TableScroll } from "@/components/ui";
import {
  evidenceSearchParams,
  resolveProtocol,
  fetchEvidenceRows,
  parseEvidenceQuery,
  PAGE_SIZE,
  visibleFields,
  type EvidenceCell,
  type EvidenceRow,
} from "@/lib/evidence";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { ColumnChooser } from "./column-chooser";
import { EvidenceControls } from "./evidence-controls";

export const metadata: Metadata = { title: "Evidence" };

interface FieldRow {
  id: string;
  key: string;
  label: string;
  type: string;
  order: number;
}

interface WorkMeta {
  title: string | null;
  authors: unknown;
  venue: string | null;
  published_year: number | null;
  doi: string | null;
  arxiv_id: string | null;
  pmid: string | null;
  oa_pdf_url: string | null;
  screen_status?: string;
}

function formatAuthors(authors: unknown): string {
  if (!Array.isArray(authors)) return "";
  const names = authors
    .map((a) => {
      if (typeof a === "string") return a;
      if (typeof a === "object" && a && "name" in a) return String(a.name);
      return null;
    })
    .filter((n): n is string => !!n);
  if (names.length === 0) return "";
  return names.length > 2
    ? `${names[0]}, ${names[1]} et al.`
    : names.join(", ");
}

function fullAuthors(authors: unknown): string {
  if (!Array.isArray(authors)) return "";
  return authors
    .map((a) => {
      if (typeof a === "string") return a;
      if (typeof a === "object" && a && "name" in a) return String(a.name);
      return null;
    })
    .filter((n): n is string => !!n)
    .join(", ");
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

  const query = parseEvidenceQuery(sp);

  /*
   * EVERY protocol, not just the newest active one.
   *
   * This query used to be `.eq("is_active", true).order(version desc).limit(1)`,
   * which meant an extraction made against any other protocol had no screen. It
   * was still in the database and still counted in the extraction totals; it
   * simply could not be looked at, and that is indistinguishable from having
   * been deleted by the person who made it.
   *
   * Which one this request means is decided by `resolveProtocol`, shared with
   * the export route so a link and its CSV cannot disagree about the columns.
   */
  const protocols = ((await must(
    supabase
      .from("protocols")
      .select(
        "id, name, version, is_active, protocol_fields(id, key, label, type, order)",
      )
      .eq("project_id", id)
      .order("version", { ascending: false }),
    "the protocols",
  )) ?? []) as unknown as Array<{
    id: string;
    name: string;
    version: number;
    is_active: boolean;
    protocol_fields: FieldRow[];
  }>;

  const choices = protocols.map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    isActive: p.is_active,
  }));

  const chosen = resolveProtocol(choices, query.protocolId);
  const protocol = chosen ? protocols.find((p) => p.id === chosen.id)! : null;

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

  const allFields = [...(protocol.protocol_fields ?? [])].sort(
    (a, b) => a.order - b.order,
  );

  /*
   * How much work sits under each protocol.
   *
   * Shown in the picker, because the question somebody arrives with is "where
   * did my extraction go" and a list of names cannot answer it. A count can.
   */
  const perProtocol = ((await must(
    supabase
      .from("extractions")
      .select("protocol_id")
      .eq("project_id", id)
      .neq("status", "DRAFT"),
    "extraction counts per protocol",
  )) ?? []) as unknown as Array<{ protocol_id: string }>;

  const countsByProtocol = new Map<string, number>();
  for (const row of perProtocol) {
    countsByProtocol.set(
      row.protocol_id,
      (countsByProtocol.get(row.protocol_id) ?? 0) + 1,
    );
  }

  // Shared with the export, so "export what I am looking at" includes the
  // columns. See visibleFields() for why order comes from the protocol.
  const fields = visibleFields(allFields, query);
  const rows = await fetchEvidenceRows(id, protocol.id, query);

  // Fetch full bibliographic metadata for visible evidence papers
  const projectWorkIds = [...new Set(rows.map((r) => r.project_work_id))];
  const { data: projectWorksData } = projectWorkIds.length
    ? await supabase
        .from("project_works")
        .select(
          "id, screen_status, works(title, authors, venue, published_year, doi, arxiv_id, pmid, oa_pdf_url)",
        )
        .in("id", projectWorkIds)
    : { data: [] };

  const worksMap = new Map<string, WorkMeta>(
    (projectWorksData ?? []).map((pw: any) => [
      pw.id,
      {
        title: pw.works?.title ?? null,
        authors: pw.works?.authors,
        venue: pw.works?.venue ?? null,
        published_year: pw.works?.published_year ?? null,
        doi: pw.works?.doi ?? null,
        arxiv_id: pw.works?.arxiv_id ?? null,
        pmid: pw.works?.pmid ?? null,
        oa_pdf_url: pw.works?.oa_pdf_url ?? null,
        screen_status: pw.screen_status,
      },
    ]),
  );

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
        fields={allFields.map((f) => ({ key: f.key, label: f.label }))}
        sort={query.sort}
        dir={query.dir}
        filterKey={query.filterKey}
        filterText={query.filterText}
        groupKey={query.groupKey}
        onlyIncomplete={query.onlyIncomplete}
        columns={query.columns}
        protocolId={protocol.id}
        protocols={choices.map((c) => ({
          ...c,
          extractions: countsByProtocol.get(c.id) ?? 0,
        }))}
      >
        {/* Hidden below `sm`, which is both a design call and a containment.

          Design: choosing among twenty columns is a desktop-shaped problem. On
          a phone the table is a horizontal scroll whatever you do, and the
          screen has no room for a twenty-item panel.

          Containment: with this control present, an existing mobile test found
          a cell link in the table below that was visible, enabled, stable and
          not clickable, with the filter form reported as intercepting the
          pointer. Five hypotheses were tried and rejected — the trailing
          column, the first column's width, Radix itself, `useSearchParams`
          widening the client boundary, and the control's own position. The
          mechanism is still unexplained and is recorded in the BUILD-LOG. What
          IS established is that it only happens on the narrow layout, so the
          narrow layout does not get the control. */}
        <div className="hidden sm:block">
          <ColumnChooser
            fields={allFields.map((f) => ({ key: f.key, label: f.label }))}
            selected={fields.map((f) => f.key)}
            search={evidenceSearchParams(query, page).replace(/^\?/, "")}
          />
        </div>
      </EvidenceControls>

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
          {/* The full table, from `md` up.

              Below that it is replaced entirely, not merely scrolled. A
              twenty-column table on a 390px screen is a horizontal scroll
              through a keyhole — you cannot compare rows, which is the only
              reason a table exists, and you cannot read a row either. It has
              also been the source of three separate rounds of unclickable
              cells on mobile, each one a different guess at the mechanism.
              Cards have no off-screen axis for a target to hide on. */}
          <div className="hidden md:block">
            <TableScroll label="Evidence table">
              {/*
                `min-w-full`, not `w-full`.
                
                With `w-full` the table is told to fit its container, so twenty
                columns are crammed into the viewport width and the one column
                with real prose in it — the paper title — loses. Titles wrapped
                to six lines, rows grew to about 110px each, and three rows
                filled the screen. A table you cannot compare rows in has given
                up the only thing it is for.
                
                `min-w-full` fills the container when there is room and lets the
                table grow past it when there is not, which is what the
                horizontal scroll around it already exists to handle.
              */}
              <table className="text-ui min-w-full text-left border-separate border-spacing-0">
                <caption className="sr-only">
                  Extractions, one row per paper, one column per protocol field
                </caption>
                {/* NOT sticky vertically, and that is a correction rather than an omission.
                  A sticky header offset by the app header's height was tried
                  here and is wrong inside this container: `TableScroll` sets
                  `overflow-x: auto`, which makes the div a scroll container on
                  BOTH axes, so `top: 4.5rem` positions the header 4.5rem below
                  the container's own top — permanently, over the first two
                  rows. The mobile run caught it as a link that was visible,
                  enabled, stable and not clickable, twice.

                  Doing it properly means giving the table its own vertical
                  scroll (a max-height on the container) so the header has
                  something to stick within. That changes how the whole page
                  scrolls and is too large a change to smuggle in beside a
                  column chooser. Recorded as open in the BUILD-LOG. */}
                <thead className="border-border text-muted text-fine uppercase">
                  <tr>
                    <SortableHeader
                      label="Paper Title"
                      sortKey="title"
                      query={query}
                      projectId={id}
                      sticky
                    />
                    <th scope="col" className="px-4 py-3 font-medium border-b border-border whitespace-nowrap">
                      Authors
                    </th>
                    <SortableHeader
                      label="Year"
                      sortKey="year"
                      query={query}
                      projectId={id}
                    />
                    <th scope="col" className="px-4 py-3 font-medium border-b border-border whitespace-nowrap">
                      Venue
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium border-b border-border whitespace-nowrap">
                      DOI
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium border-b border-border whitespace-nowrap">
                      PDF
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium border-b border-border whitespace-nowrap">
                      Status
                    </th>
                    <SortableHeader
                      label="Progress"
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
                <tbody>
                  {rows.map((row, index) => (
                    <Row
                      key={row.extraction_id}
                      row={row}
                      work={worksMap.get(row.project_work_id)}
                      previous={rows[index - 1]}
                      fields={fields}
                      projectId={id}
                      grouped={!!query.groupKey}
                    />
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>

          {/* Every field of every paper, vertically, on small screens. */}
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <li key={row.extraction_id}>
                <PaperCard
                  row={row}
                  work={worksMap.get(row.project_work_id)}
                  fields={fields}
                  projectId={id}
                />
              </li>
            ))}
          </ul>

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
      className={`px-4 py-3 font-medium whitespace-nowrap border-b border-border ${
        // The title column: fixed on horizontal scroll with clear visual separation
        sticky
          ? "bg-canvas sticky left-0 z-30 w-80 min-w-[18rem] max-w-[22rem] border-r border-border shadow-[4px_0_12px_-4px_rgba(0,0,0,0.1)] dark:shadow-[4px_0_16px_-4px_rgba(0,0,0,0.4)]"
          : ""
      }`}
    >
      <Link
        href={`/projects/${projectId}/evidence${search}`}
        className={`inline-flex min-h-11 items-center gap-1.5 ${active ? "text-ink font-semibold" : "hover:text-ink"}`}
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
  work,
}: {
  row: EvidenceRow;
  previous: EvidenceRow | undefined;
  fields: FieldRow[];
  projectId: string;
  grouped: boolean;
  work?: WorkMeta | undefined;
}) {
  const startsGroup = grouped && (!previous || previous.group_label !== row.group_label);
  const authorsShort = formatAuthors(work?.authors);
  const authorsAll = fullAuthors(work?.authors);
  const year = work?.published_year ?? row.published_year;
  const doi = work?.doi;
  const pdfUrl = work?.oa_pdf_url;
  const status = row.status || work?.screen_status || "SUBMITTED";
  const progressPercent =
    row.field_total > 0 ? Math.round((row.answered / row.field_total) * 100) : 0;

  return (
    <>
      {startsGroup && (
        <tr className="bg-surface">
          <th
            scope="colgroup"
            colSpan={fields.length + 8}
            className="text-fine text-muted sticky left-0 z-20 px-4 py-2 text-left font-medium uppercase border-b border-border bg-surface"
          >
            {row.group_label ?? "No answer"}
          </th>
        </tr>
      )}
      <tr data-evidence-item className="group hover:bg-surface/50 transition-colors">
        {/* Sticky Paper Title column */}
        <td className="bg-canvas group-hover:bg-surface/90 sticky left-0 z-10 w-80 min-w-[18rem] max-w-[22rem] px-4 py-3.5 border-r border-b border-border shadow-[4px_0_12px_-4px_rgba(0,0,0,0.1)] dark:shadow-[4px_0_16px_-4px_rgba(0,0,0,0.4)] transition-colors">
          <div className="flex flex-col gap-1">
            <Link
              href={`/projects/${projectId}/read/${row.project_work_id}`}
              className="text-ink font-semibold underline-offset-2 hover:text-accent hover:underline line-clamp-2 leading-snug"
              title={row.work_title}
            >
              {row.work_title}
            </Link>
            <div className="flex items-center gap-2 text-fine">
              <Link
                href={`/projects/${projectId}/extract/${row.project_work_id}`}
                className="text-accent hover:text-ink hover:underline font-medium text-xs inline-flex items-center gap-1"
              >
                <span>Extract Data</span>
                <span>→</span>
              </Link>
            </div>
          </div>
        </td>
        <td className="text-muted max-w-[13rem] px-4 py-3 text-fine border-b border-border">
          {authorsShort ? (
            <span title={authorsAll} className="line-clamp-2">
              {authorsShort}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="text-muted px-4 py-3 tabular-nums text-ui border-b border-border">{year ?? "—"}</td>
        <td className="text-muted max-w-[12rem] px-4 py-3 text-fine border-b border-border">
          {work?.venue ? (
            <span title={work.venue} className="line-clamp-2">
              {work.venue}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3 text-fine border-b border-border">
          {doi ? (
            <a
              href={`https://doi.org/${doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline font-mono text-xs inline-flex items-center gap-1 group/doi"
              title={`Open DOI: https://doi.org/${doi}`}
            >
              <span className="truncate max-w-[7.5rem]">{doi}</span>
              <span className="opacity-70 group-hover/doi:opacity-100">↗</span>
            </a>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-fine border-b border-border">
          {pdfUrl ? (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="border-accent/30 bg-accent/10 hover:bg-accent/20 text-accent inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs font-semibold border transition-colors"
              title="Open Open-Access PDF in new tab"
            >
              <span>PDF</span>
              <span className="text-[10px]">↗</span>
            </a>
          ) : (
            <Link
              href={`/projects/${projectId}/read/${row.project_work_id}`}
              className="text-muted hover:text-ink hover:underline text-xs"
            >
              Reader
            </Link>
          )}
        </td>
        <td className="px-4 py-3 border-b border-border">
          <span
            className={`inline-flex items-center rounded px-2 py-0.5 font-mono text-[10px] font-bold border ${
              status === "VERIFIED" || status === "RECONCILED"
                ? "bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300"
                : status === "SUBMITTED"
                ? "bg-accent/15 border-accent/30 text-accent"
                : "bg-surface border-border text-muted"
            }`}
          >
            {status}
          </span>
        </td>
        <td className="px-4 py-3 tabular-nums border-b border-border">
          <div className="flex flex-col gap-1 min-w-[5.5rem]">
            <div className="flex items-center justify-between text-fine">
              <span className="text-ink font-medium">
                {row.answered}/{row.field_total}
              </span>
              <span className="text-muted text-[10px]">{progressPercent}%</span>
            </div>
            <div className="bg-surface/80 border-border/50 h-1.5 w-full rounded-full border overflow-hidden">
              <div
                className="bg-accent h-full rounded-full transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
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
 * One paper, with every field it has an answer for.
 *
 * The same information the table row carries, laid out so it can be read
 * rather than scrolled past. Unanswered fields are listed too — a card that
 * silently omits them would launder missing data as absence of finding, which
 * is the same rule the table's dash exists for.
 */
function PaperCard({
  row,
  fields,
  projectId,
  work,
}: {
  row: EvidenceRow;
  fields: FieldRow[];
  projectId: string;
  work?: WorkMeta | undefined;
}) {
  const authorsShort = formatAuthors(work?.authors);
  const year = work?.published_year ?? row.published_year;
  const doi = work?.doi;
  const pdfUrl = work?.oa_pdf_url;
  const status = row.status || work?.screen_status || "SUBMITTED";
  const progressPercent =
    row.field_total > 0 ? Math.round((row.answered / row.field_total) * 100) : 0;

  return (
    <article
      data-evidence-item
      aria-label={row.work_title}
      className="border-border/70 bg-surface/40 rounded-2xl border p-4 shadow-xs flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/projects/${projectId}/read/${row.project_work_id}`}
          className="text-ink hover:text-accent font-semibold underline-offset-2 hover:underline text-base"
        >
          {row.work_title}
        </Link>
        <span
          className={`shrink-0 inline-flex items-center rounded px-2 py-0.5 font-mono text-[10px] font-bold border ${
            status === "VERIFIED" || status === "RECONCILED"
              ? "bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300"
              : status === "SUBMITTED"
              ? "bg-accent/15 border-accent/30 text-accent"
              : "bg-surface border-border text-muted"
          }`}
        >
          {status}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-fine text-muted">
        {authorsShort && <span>{authorsShort}</span>}
        {year && <span>{year}</span>}
        {work?.venue && <span>{work.venue}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
        <Link
          href={`/projects/${projectId}/extract/${row.project_work_id}`}
          className="border-border text-ink hover:bg-surface text-fine inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium transition-all"
        >
          <span>Extract Data</span>
          <span>→</span>
        </Link>
        <Link
          href={`/projects/${projectId}/read/${row.project_work_id}`}
          className="border-border text-muted hover:text-ink hover:bg-surface text-fine inline-flex items-center rounded-lg border px-2.5 py-1 font-medium transition-all"
        >
          Read Paper
        </Link>
        {pdfUrl && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="border-accent/30 bg-accent/10 hover:bg-accent/20 text-accent text-fine inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-mono font-semibold transition-all"
          >
            <span>PDF</span>
            <span className="text-[10px]">↗</span>
          </a>
        )}
        {doi && (
          <a
            href={`https://doi.org/${doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline font-mono text-fine inline-flex items-center gap-0.5"
          >
            <span>doi:{doi}</span>
            <span>↗</span>
          </a>
        )}
      </div>

      <div className="flex flex-col gap-1 pt-1">
        <div className="flex items-center justify-between text-fine">
          <span className="text-muted">Protocol Progress</span>
          <span className="text-ink font-medium">
            {row.answered}/{row.field_total} answered ({progressPercent}%)
          </span>
        </div>
        <div className="bg-surface/80 border-border/50 h-1.5 w-full rounded-full border overflow-hidden">
          <div
            className="bg-accent h-full rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <dl className="mt-2 flex flex-col gap-2 border-t border-border/40 pt-3">
        {fields.map((field) => {
          const cell = row.cells?.[field.key];
          return (
            <div key={field.id}>
              <dt className="text-muted text-fine">{field.label}</dt>
              <dd className="text-ui mt-0.5">
                {!cell || !cell.answered ? (
                  // Full `text-muted`, not a faded one. The table's dash can
                  // be `text-muted/60` because it is aria-hidden decoration
                  // with a screen-reader label beside it; this is real text a
                  // person reads, and at 70% it failed AA contrast.
                  <span className="text-muted italic">Not answered</span>
                ) : cell.anchorId ? (
                  <Link
                    href={`/projects/${projectId}/read/${row.project_work_id}?anchor=${cell.anchorId}`}
                    className="text-ink underline decoration-dotted underline-offset-4"
                  >
                    {cell.text}
                    <span className="sr-only"> — open the passage this came from</span>
                  </Link>
                ) : (
                  // No truncation here: the whole point of this layout is
                  // that the value is readable, and vertical space is the one
                  // thing a phone has.
                  <span className="text-ink-soft">{cell.text}</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </article>
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
      <td className="px-4 py-3 border-b border-border">
        <span className="text-muted/60" aria-hidden="true">
          —
        </span>
        <span className="sr-only">{label}: not answered</span>
      </td>
    );
  }

  const text = cell.text ?? "";

  /*
   * One line per cell, and the full value in the row's detail panel.
   *
   * The truncation has two reasons, one of them found the hard way. An
   * evidence table is scanned ACROSS a row and DOWN a column; a quoted passage
   * that wraps to five lines makes every other row on screen taller and
   * destroys both. Uniform rows are what makes twenty columns readable at all.
   *
   * The other reason is that a wrapped inline link's bounding box spans its
   * line boxes, so its centre point can land in the gap BETWEEN two lines —
   * where the click hits the cell instead of the link. The mobile e2e run
   * caught that: a link that was visible, enabled and stable, and not
   * clickable. A single-line block is a target the whole way across.
   *
   * There USED to be a `title` attribute carrying the full value. It went for
   * two reasons. A tooltip is not reachable by keyboard and is not announced,
   * so it was never an answer for everyone — and it put a second copy of every
   * cell's text into the HTML, on a page already sending 562 KB for fifty
   * rows. `RowDetail` is the accessible version of the same intent and costs
   * nothing until it is opened.
   */
  if (cell.anchorId) {
    return (
      <td className="px-4 py-3 border-b border-border">
        <Link
          href={`/projects/${projectId}/read/${projectWorkId}?anchor=${cell.anchorId}`}
          className="text-ink block max-w-[18rem] truncate underline decoration-dotted underline-offset-4"
        >
          {text}
          <span className="sr-only"> — open the passage this came from</span>
        </Link>
      </td>
    );
  }

  return (
    <td className="px-4 py-3 border-b border-border">
      <span className="text-ink-soft block max-w-[18rem] truncate">{text}</span>
    </td>
  );
}
