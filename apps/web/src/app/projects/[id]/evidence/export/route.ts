import type { NextRequest } from "next/server";

import { toCsv } from "@/lib/export/csv";
import { toEvidenceMarkdown } from "@/lib/export/evidence-markdown";
import { toXlsx, type XlsxCell } from "@/lib/export/xlsx";
import {
  exportValue,
  fetchEvidenceRows,
  parseEvidenceQuery,
  resolveProtocol,
  visibleFields,
  type EvidenceRow,
} from "@/lib/evidence";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * CSV, XLSX and Markdown export (4.4).
 *
 * The export honours the filter, sort, grouping and COLUMN SELECTION currently
 * on the URL, so "export what I am looking at" does that rather than dumping
 * the table. It ignores paging: exporting page 2 of 6 is never what anyone
 * means.
 *
 * Includes full paper metadata (DOI, authors, year, venue, arXiv, PMID, PDF links)
 * and formatted/colored layout for XLSX spreadsheets.
 */

const EXPORT_LIMIT = 5000;

interface WorkMeta {
  title: string | null;
  authors: unknown;
  venue: string | null;
  published_year: number | null;
  doi: string | null;
  arxiv_id: string | null;
  pmid: string | null;
  oa_pdf_url: string | null;
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
  return names.join(", ");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first", { status: 401 });

  const { id } = await params;
  const url = request.nextUrl;
  const format = url.searchParams.get("format") ?? "csv";

  const supabase = await createClient();

  const query = parseEvidenceQuery(Object.fromEntries(url.searchParams));

  const protocols = ((await must(
    supabase
      .from("protocols")
      .select("id, name, version, is_active, protocol_fields(key, label, order)")
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

  const chosen = resolveProtocol(
    protocols.map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      isActive: p.is_active,
    })),
    query.protocolId,
  );
  const protocol = chosen ? protocols.find((p) => p.id === chosen.id)! : null;

  if (!protocol)
    return new Response("This project has no protocol to export", { status: 404 });

  const allFields = [...(protocol.protocol_fields ?? [])].sort(
    (a, b) => a.order - b.order,
  );

  const fields = visibleFields(allFields, query);
  const rows = await fetchEvidenceRows(id, protocol.id, query, EXPORT_LIMIT);

  // Fetch full bibliographic paper metadata for all exported papers
  const projectWorkIds = [...new Set(rows.map((r) => r.project_work_id))];
  const { data: projectWorksData } = projectWorkIds.length
    ? await supabase
        .from("project_works")
        .select(
          "id, works(title, authors, venue, published_year, doi, arxiv_id, pmid, oa_pdf_url)",
        )
        .in("id", projectWorkIds)
    : { data: [] };

  const worksMap = new Map<string, WorkMeta | null>(
    (projectWorksData ?? []).map((pw: any) => [pw.id, pw.works as WorkMeta | null]),
  );

  /*
   * Comprehensive columns: Paper Metadata followed by Protocol extraction field keys.
   */
  const header = [
    "title",
    "authors",
    "year",
    "venue",
    "doi",
    "doi_url",
    "arxiv_id",
    "pmid",
    "pdf_url",
    "status",
    "answered_fields",
    "total_fields",
    ...fields.map((f) => f.key),
  ];

  const cellsFor = (row: EvidenceRow): (string | number | null)[] => {
    const work = worksMap.get(row.project_work_id);
    const authors = formatAuthors(work?.authors);
    const year = work?.published_year ?? row.published_year ?? null;
    const doi = work?.doi ?? null;
    const doiUrl = doi ? `https://doi.org/${doi}` : null;
    const arxivId = work?.arxiv_id ?? null;
    const pmid = work?.pmid ?? null;
    const pdfUrl = work?.oa_pdf_url ?? null;

    return [
      row.work_title || work?.title || "Untitled",
      authors || null,
      year,
      work?.venue ?? null,
      doi,
      doiUrl,
      arxivId,
      pmid,
      pdfUrl,
      row.status,
      row.answered,
      row.field_total,
      ...fields.map((f) => exportValue(row.cells?.[f.key])),
    ];
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const base = `evidence-${slug(protocol.name)}-v${protocol.version}-${stamp}`;

  if (format === "md" || format === "markdown") {
    const enrichedRows = rows.map((row) => {
      const work = worksMap.get(row.project_work_id);
      return {
        ...row,
        authors: formatAuthors(work?.authors) || null,
        venue: work?.venue ?? null,
        doi: work?.doi ?? null,
        doi_url: work?.doi ? `https://doi.org/${work.doi}` : null,
        arxiv_id: work?.arxiv_id ?? null,
        pmid: work?.pmid ?? null,
        oa_pdf_url: work?.oa_pdf_url ?? null,
      };
    });

    const md = toEvidenceMarkdown({
      protocolName: protocol.name,
      protocolVersion: protocol.version,
      fields,
      rows: enrichedRows,
    });

    return new Response(md, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${base}.md"`,
        "cache-control": "no-store",
      },
    });
  }

  if (format === "xlsx") {
    const sheet: XlsxCell[][] = [header, ...rows.map(cellsFor)];
    const body = toXlsx(sheet, protocol.name || "Evidence");

    return new Response(new Uint8Array(body), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${base}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }

  const csv = toCsv(
    header,
    rows.map((row) => cellsFor(row).map((v) => (v === null ? "" : String(v)))),
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${base}.csv"`,
      "cache-control": "no-store",
    },
  });
}

interface FieldRow {
  key: string;
  label: string;
  order: number;
}

/** Filename-safe, since the protocol name is user-supplied. */
function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "protocol"
  );
}
