import type { NextRequest } from "next/server";

import { toCsv } from "@/lib/export/csv";
import { toXlsx, type XlsxCell } from "@/lib/export/xlsx";
import {
  exportValue,
  fetchEvidenceRows,
  parseEvidenceQuery,
  visibleFields,
  type EvidenceRow,
} from "@/lib/evidence";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * CSV and XLSX export (4.4).
 *
 * The export honours the filter, sort, grouping and COLUMN SELECTION currently
 * on the URL, so "export what I am looking at" does that rather than dumping
 * the table. It ignores paging: exporting page 2 of 6 is never what anyone
 * means.
 *
 * No authorisation logic here beyond requiring a session. Every row comes back
 * through evidence_rows(), which is SECURITY INVOKER over RLS-protected
 * tables, so a non-member gets an empty export by the same mechanism that
 * gives them an empty page. Re-checking membership here would add a second
 * rule to keep in step with the first.
 */

// The row cap. 300 x 20 is the Phase 1 trial's budget; 5,000 leaves headroom
// for a large review while keeping the response bounded, since this builds the
// whole file in memory before sending it.
const EXPORT_LIMIT = 5000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first", { status: 401 });

  const { id } = await params;
  const url = request.nextUrl;
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";

  const supabase = await createClient();

  const protocol = await must(
    supabase
      .from("protocols")
      .select("id, name, version, protocol_fields(key, label, order)")
      .eq("project_id", id)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "the protocol",
  );

  if (!protocol)
    return new Response("This project has no active protocol", { status: 404 });

  const allFields = [
    ...((protocol as unknown as { protocol_fields: FieldRow[] }).protocol_fields ?? []),
  ].sort((a, b) => a.order - b.order);

  const query = parseEvidenceQuery(Object.fromEntries(url.searchParams));

  // The columns too, not just the rows. Someone who narrows the table to five
  // fields and clicks Export means five fields; handing them twenty is the
  // export quietly disagreeing with the screen it came from.
  const fields = visibleFields(allFields, query);
  const rows = await fetchEvidenceRows(id, protocol.id, query, EXPORT_LIMIT);

  /*
   * Column headers are the field KEYS, not the labels.
   *
   * This is the reason keys are immutable (week 2, 2.1). A label is prose and
   * people improve it; if the header were the label, two exports of the same
   * review would disagree about what a column is called and any script joining
   * on it would break silently. The label is human-facing and lives on screen.
   */
  const header = [
    "title",
    "year",
    "status",
    "answered",
    "fields",
    ...fields.map((f) => f.key),
  ];

  const cellsFor = (row: EvidenceRow): (string | number | null)[] => [
    row.work_title,
    row.published_year,
    row.status,
    row.answered,
    row.field_total,
    ...fields.map((f) => exportValue(row.cells?.[f.key])),
  ];

  const stamp = new Date().toISOString().slice(0, 10);
  const base = `evidence-${slug(protocol.name)}-v${protocol.version}-${stamp}`;

  if (format === "xlsx") {
    const sheet: XlsxCell[][] = [header, ...rows.map(cellsFor)];
    const body = toXlsx(sheet, "Evidence");

    return new Response(new Uint8Array(body), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${base}.xlsx"`,
        // The table changes whenever anyone saves an extraction; a cached
        // export is a wrong export.
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
