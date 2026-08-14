import "server-only";

import { must } from "@/lib/supabase/query";
import { createClient } from "@/lib/supabase/server";

/**
 * The evidence table's read path, shared by the page and the export route.
 *
 * Shared deliberately. The export is not a second rendering of the table — it
 * IS the table, at a different page size. If the two built their queries
 * separately, an export could silently disagree with what was on screen about
 * which rows the filter matched, and nobody would find out until a reviewer
 * asked why the CSV had 41 rows and the page said 38.
 */

export interface EvidenceCell {
  value: unknown;
  text: string | null;
  anchorId: string | null;
  type: string;
  label: string;
  answered: boolean;
}

export interface EvidenceRow {
  extraction_id: string;
  project_work_id: string;
  work_title: string;
  published_year: number | null;
  status: string;
  extractor_id: string;
  group_label: string | null;
  cells: Record<string, EvidenceCell>;
  answered: number;
  field_total: number;
  total_rows: number;
}

export interface EvidenceQuery {
  sort: string;
  dir: "asc" | "desc";
  filterKey: string | null;
  filterText: string | null;
  groupKey: string | null;
  onlyIncomplete: boolean;
  limit: number;
  offset: number;
}

export const PAGE_SIZE = 50;

/**
 * Read the query off the URL.
 *
 * The URL is the state. That is not a stylistic choice: a filtered, sorted
 * evidence table is exactly the thing a researcher wants to send to a
 * supervisor, and state held in React would make that link meaningless.
 *
 * Everything is clamped or defaulted rather than trusted. `sort` is passed to
 * a function that only interprets known values, but `limit` reaches a LIMIT
 * clause, and an unclamped one is a free denial of service.
 */
export function parseEvidenceQuery(
  params: Record<string, string | string[] | undefined>,
): EvidenceQuery {
  const one = (key: string): string | null => {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    return first && first.length > 0 ? first : null;
  };

  const page = Math.max(1, Number.parseInt(one("page") ?? "1", 10) || 1);

  return {
    sort: one("sort") ?? "title",
    dir: one("dir") === "desc" ? "desc" : "asc",
    filterKey: one("fk"),
    filterText: one("q"),
    groupKey: one("group"),
    onlyIncomplete: one("incomplete") === "1",
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
}

export function evidenceSearchParams(query: EvidenceQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.sort !== "title") params.set("sort", query.sort);
  if (query.dir !== "asc") params.set("dir", query.dir);
  if (query.filterKey) params.set("fk", query.filterKey);
  if (query.filterText) params.set("q", query.filterText);
  if (query.groupKey) params.set("group", query.groupKey);
  if (query.onlyIncomplete) params.set("incomplete", "1");
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchEvidenceRows(
  projectId: string,
  protocolId: string,
  query: EvidenceQuery,
  limitOverride?: number,
): Promise<EvidenceRow[]> {
  const supabase = await createClient();

  return (await must(
    supabase.rpc("evidence_rows", {
      p_project_id: projectId,
      p_protocol_id: protocolId,
      p_sort: query.sort,
      p_dir: query.dir,
      p_filter_key: query.filterKey,
      p_filter_text: query.filterText,
      p_group_key: query.groupKey,
      p_only_incomplete: query.onlyIncomplete,
      p_limit: limitOverride ?? query.limit,
      p_offset: limitOverride === undefined ? query.offset : 0,
    }),
    "the evidence table",
  )) as unknown as EvidenceRow[];
}

/**
 * Render a cell for export.
 *
 * MULTI_ENUM arrives as a JSON array and must not be exported as `["a","b"]`,
 * which is what String() would give: nobody pivots on that. `value_text` is
 * already the flattened form the database keeps for search, so it is the right
 * answer everywhere except numbers — where the point is to stay a number.
 */
export function exportValue(cell: EvidenceCell | undefined): string | number | null {
  if (!cell || !cell.answered) return null;

  if (cell.type === "NUMBER" && typeof cell.value === "number") return cell.value;

  // A NUMBER field whose stored value is not a number — 'not reported' and the
  // like — falls through to text rather than becoming NaN or an empty cell.
  return cell.text ?? null;
}
