export interface EvidenceFieldInfo {
  key: string;
  label: string;
  order: number;
}

export interface EvidenceCellData {
  value?: unknown;
  text?: string | null;
  anchorId?: string | null;
  type?: string;
  label?: string;
  answered?: boolean;
}

export interface EvidenceRowData {
  work_title: string;
  published_year: number | null;
  status: string;
  answered: number;
  field_total: number;
  cells?: Record<string, EvidenceCellData | undefined>;
  extraction_id?: string;
  project_work_id?: string;
  extractor_id?: string;
  group_label?: string | null;
  total_rows?: number;
  authors?: string | null;
  venue?: string | null;
  doi?: string | null;
  doi_url?: string | null;
  arxiv_id?: string | null;
  pmid?: string | null;
  oa_pdf_url?: string | null;
}

export interface EvidenceMarkdownOptions {
  protocolName: string;
  protocolVersion: number;
  fields: readonly EvidenceFieldInfo[];
  rows: readonly EvidenceRowData[];
  generatedAt?: Date | undefined;
}

export function exportCellValue(cell: EvidenceCellData | undefined): string | number | null {
  if (!cell || !cell.answered) return null;
  if (cell.type === "NUMBER" && typeof cell.value === "number") return cell.value;
  return cell.text ?? null;
}

/**
 * Clean and summarize text for inclusion in a single-line GFM Markdown table cell.
 */
function formatSummaryCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const str = String(value).trim();
  if (str === "") return "—";

  // If it's a markdown table, provide a compact summary
  if (str.includes("|") && str.includes("\n")) {
    const tableLines = str.split("\n").filter((l) => l.trim().startsWith("|"));
    if (tableLines.length >= 2) {
      return `📊 Table (${Math.max(1, tableLines.length - 2)} rows)`;
    }
  }

  // If multi-line, take the first line and append line count
  const lines = str.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const first = lines[0] ?? "";
    const short = first.length > 50 ? first.slice(0, 47) + "..." : first;
    return short.replace(/\|/g, "\\|") + ` (${lines.length} lines)`;
  }

  const single = str.length > 80 ? str.slice(0, 77) + "..." : str;
  return single.replace(/\|/g, "\\|").trim();
}

/**
 * Format the entire evidence synthesis table into a comprehensive Markdown document
 * with complete paper metadata (DOI, authors, year, venue, arXiv, PMID, PDF links)
 * optimized for AI analysis, LLM meta-synthesis, and human review.
 */
export function toEvidenceMarkdown(options: EvidenceMarkdownOptions): string {
  const {
    protocolName,
    protocolVersion,
    fields,
    rows,
    generatedAt = new Date(),
  } = options;

  const dateStr = generatedAt.toISOString().slice(0, 10);
  const timeStr = generatedAt.toISOString().slice(11, 19) + " UTC";

  const lines: string[] = [];

  // Document Title
  lines.push(`# Evidence Synthesis: ${protocolName} (v${protocolVersion})`);
  lines.push("");

  // AI Prompt & Analysis Context (as a standard Markdown callout)
  lines.push("> **💡 AI Instructions for Systematic Review & Evidence Synthesis**");
  lines.push("> - **Synthesize Findings**: Synthesize quantitative and qualitative outcomes across all included studies.");
  lines.push("> - **Compare Metrics**: Compare effect sizes, metrics, sample sizes, and interventions.");
  lines.push("> - **Assess Bias & Gaps**: Assess heterogeneity, consistency, outliers, and risk of bias across studies.");
  lines.push("> - **Generate Tables**: Produce structured summary tables and narrative review sections for a manuscript.");
  lines.push("");

  // Overview
  lines.push("## Protocol & Synthesis Overview");
  lines.push(`- **Protocol**: ${protocolName} (v${protocolVersion})`);
  lines.push(`- **Total Included Papers**: ${rows.length}`);
  lines.push(
    `- **Extraction Fields (${fields.length})**: ${fields.map((f) => f.label).join(", ")}`,
  );
  lines.push(`- **Exported At**: ${dateStr} ${timeStr}`);
  lines.push("");

  // Evidence Matrix Summary Table
  lines.push("## Evidence Matrix Table");
  lines.push("");

  if (rows.length === 0) {
    lines.push("*No extractions found for this protocol.*");
    lines.push("");
  } else {
    const tableHeaders = [
      "#",
      "Paper Title",
      "Authors",
      "Year",
      "Venue",
      "DOI",
      "PDF",
      "Status",
      "Progress",
      ...fields.map((f) => f.label),
    ];
    lines.push(`| ${tableHeaders.join(" | ")} |`);
    lines.push(
      `| ${tableHeaders
        .map((_, i) =>
          i === 0 || i === 3 || i === 5 || i === 6 || i === 7 || i === 8 ? ":---:" : ":---",
        )
        .join(" | ")} |`,
    );

    rows.forEach((row, idx) => {
      const doiLink = row.doi
        ? `[DOI](https://doi.org/${row.doi})`
        : "—";
      const pdfLink = row.oa_pdf_url
        ? `[PDF](${row.oa_pdf_url})`
        : "—";

      const cells = [
        String(idx + 1),
        row.work_title.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim(),
        row.authors ? formatSummaryCell(row.authors) : "—",
        row.published_year ? String(row.published_year) : "—",
        row.venue ? formatSummaryCell(row.venue) : "—",
        doiLink,
        pdfLink,
        row.status,
        `${row.answered}/${row.field_total}`,
        ...fields.map((f) => {
          const val = exportCellValue(row.cells?.[f.key]);
          return formatSummaryCell(val);
        }),
      ];
      lines.push(`| ${cells.join(" | ")} |`);
    });

    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // Detailed per-paper extraction breakdown
  lines.push("## Detailed Extractions by Paper");
  lines.push("");

  if (rows.length === 0) {
    lines.push("*No detailed extractions to display.*");
    lines.push("");
  } else {
    rows.forEach((row, idx) => {
      lines.push(
        `### ${idx + 1}. ${row.work_title}${row.published_year ? ` (${row.published_year})` : ""}`,
      );
      lines.push("");

      // Bibliographic metadata
      const authorsText = row.authors ? row.authors : "Unknown authors";
      lines.push(`- **Authors:** ${authorsText}`);

      const pubParts: string[] = [];
      if (row.published_year) pubParts.push(String(row.published_year));
      if (row.venue) pubParts.push(`Venue: *${row.venue}*`);
      lines.push(
        `- **Publication:** ${pubParts.length > 0 ? pubParts.join(" · ") : "Not specified"}`,
      );

      // Links & Identifiers
      const links: string[] = [];
      if (row.doi) {
        links.push(`[DOI: ${row.doi}](https://doi.org/${row.doi})`);
      }
      if (row.arxiv_id) {
        links.push(`[arXiv: ${row.arxiv_id}](https://arxiv.org/abs/${row.arxiv_id})`);
      }
      if (row.pmid) {
        links.push(`[PMID: ${row.pmid}](https://pubmed.ncbi.nlm.nih.gov/${row.pmid})`);
      }
      if (row.oa_pdf_url) {
        links.push(`[Open Access PDF](${row.oa_pdf_url})`);
      }
      const linksText = links.length > 0 ? links.join(" · ") : "None reported";
      lines.push(`- **Identifiers & Links:** ${linksText}`);

      lines.push(
        `- **Status:** \`${row.status}\` · **Answered:** ${row.answered} / ${row.field_total} fields`,
      );
      lines.push("");

      fields.forEach((field) => {
        const cell = row.cells?.[field.key];
        const val = cell ? exportCellValue(cell) : null;
        lines.push(`#### ${field.label} (\`${field.key}\`)`);
        if (val === null || val === undefined || String(val).trim() === "") {
          lines.push("*Not answered*");
        } else {
          lines.push(String(val).trim());
        }
        lines.push("");
      });

      lines.push("---");
      lines.push("");
    });
  }

  return lines.join("\n");
}
