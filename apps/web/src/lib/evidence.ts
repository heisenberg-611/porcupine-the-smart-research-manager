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
  /**
   * Which protocol's extractions to show. `null` means "the default one".
   *
   * A project can hold several protocols at once — a v2 that supersedes a v1,
   * or two running in parallel — and an extraction belongs to exactly one of
   * them. Until this existed, both this page and the export silently rendered
   * whichever was active with the highest version, so an extraction made
   * against any other protocol had no screen at all. It was still in the
   * database and still counted in the totals; it simply could not be looked
   * at, which is indistinguishable from having been deleted.
   *
   * In the URL like everything else here, so "the v1 table" is a link.
   */
  protocolId: string | null;
  sort: string;
  dir: "asc" | "desc";
  filterKey: string | null;
  filterText: string | null;
  groupKey: string | null;
  onlyIncomplete: boolean;
  /**
   * Which field columns to show, in this order. `null` means all of them.
   *
   * In the URL rather than in localStorage, and that is the whole design.
   * Twenty columns is not a rendering problem, it is a "which five do I care
   * about today" problem — and the answer to that is exactly the thing a
   * researcher wants to send to a supervisor. State held per-browser would
   * make the link mean something different at each end, which is worse than
   * not having the feature.
   *
   * The cost, stated plainly: a column choice does not survive to the next
   * visit. Per-person persistence needs a table to hang it on, and this phase
   * does not touch the database. See the deferred saved-views note in
   * docs/09-phase-2c-usability-build-plan.md.
   */
  columns: string[] | null;
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
    protocolId: one("protocol"),
    sort: one("sort") ?? "title",
    dir: one("dir") === "desc" ? "desc" : "asc",
    filterKey: one("fk"),
    filterText: one("q"),
    groupKey: one("group"),
    onlyIncomplete: one("incomplete") === "1",
    // Split, trimmed, de-duplicated. Which keys are REAL is decided by the
    // page against the protocol's own fields — an unknown key here must be
    // dropped rather than rendered as an empty column, because the obvious
    // failure mode of a URL parameter is someone editing it by hand.
    columns: (() => {
      const raw = one("cols");
      if (raw === null) return null;
      const keys = [
        ...new Set(
          raw
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        ),
      ];
      return keys;
    })(),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
}

export function evidenceSearchParams(query: EvidenceQuery, page: number): string {
  const params = new URLSearchParams();
  if (query.protocolId) params.set("protocol", query.protocolId);
  if (query.sort !== "title") params.set("sort", query.sort);
  if (query.dir !== "asc") params.set("dir", query.dir);
  if (query.filterKey) params.set("fk", query.filterKey);
  if (query.filterText) params.set("q", query.filterText);
  if (query.groupKey) params.set("group", query.groupKey);
  if (query.onlyIncomplete) params.set("incomplete", "1");
  if (query.columns) params.set("cols", query.columns.join(","));
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Which field columns this query shows, in protocol order.
 *
 * Shared by the page and the export for the same reason `fetchEvidenceRows`
 * is: the export is not a second rendering of the table, it IS the table.
 * "Export what I am looking at" has to mean the columns too, or someone
 * narrows the table to five fields, exports, and gets twenty — which is the
 * kind of disagreement nobody notices until a reviewer asks.
 *
 * Two rules, both deliberate:
 *
 *   * Unknown keys are DROPPED, not rendered. `?cols=` is a URL parameter and
 *     the obvious thing to do with one is edit it; a typo must not become an
 *     empty column with a blank header.
 *   * Order comes from the PROTOCOL, never from the parameter. Protocol order
 *     is the order the questions are asked, the order they were answered, and
 *     the order the export uses. Letting a URL reshuffle it would make two
 *     views of one review disagree about what the third column means.
 *
 * An empty result falls back to everything: a table with no field columns is
 * a list of titles, and the way back from it is not obvious.
 */
export function visibleFields<T extends { key: string }>(
  allFields: T[],
  query: EvidenceQuery,
): T[] {
  if (!query.columns) return allFields;
  const wanted = new Set(query.columns);
  const chosen = allFields.filter((f) => wanted.has(f.key));
  return chosen.length > 0 ? chosen : allFields;
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

export interface ProtocolChoice {
  id: string;
  name: string;
  version: number;
  isActive: boolean;
}

/**
 * Which protocol a query is asking for.
 *
 * Shared by the page and the export for the same reason `fetchEvidenceRows` is:
 * an export that resolved the protocol differently from the screen would hand
 * back a table of different columns for the same URL, and nobody would notice
 * until the numbers were already in a manuscript.
 *
 * An unknown or deleted id falls back to the default rather than erroring. A
 * protocol id in a URL is exactly the kind of thing that gets shared, kept in a
 * bookmark, and then outlives the protocol.
 */
export function resolveProtocol<T extends ProtocolChoice>(
  protocols: T[],
  requested: string | null,
): T | null {
  if (protocols.length === 0) return null;

  if (requested) {
    const match = protocols.find((p) => p.id === requested);
    if (match) return match;
  }

  // The default, and the behaviour everything had before this parameter
  // existed: the active protocol with the highest version. Falls through to
  // the newest of any kind when none is active, so a project whose protocols
  // have all been retired still renders its evidence rather than an empty page.
  const active = protocols.filter((p) => p.isActive);
  const pool = active.length > 0 ? active : protocols;
  return pool.reduce((best, p) => (p.version > best.version ? p : best), pool[0]!);
}
