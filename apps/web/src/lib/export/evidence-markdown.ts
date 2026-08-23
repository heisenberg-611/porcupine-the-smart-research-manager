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
 * Clean text for inclusion in a single-line GFM Markdown table cell.
 */
function cleanTableText(text: string): string {
  return text
    .replace(/\r?\n/g, "<br>")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * Format the entire evidence synthesis table into a comprehensive Markdown document
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

  // AI Prompt & Analysis Context
  lines.push("<!--");
  lines.push("AI INSTRUCTIONS FOR SYSTEMATIC REVIEW & EVIDENCE SYNTHESIS:");
  lines.push("This document contains extracted research data across papers according to the specified protocol.");
  lines.push("Use this structured evidence to:");
  lines.push("1. Synthesize quantitative and qualitative outcomes across all included studies.");
  lines.push("2. Compare effect sizes, metrics, sample sizes, and interventions.");
  lines.push("3. Assess heterogeneity, consistency, gaps, and risk of bias across studies.");
  lines.push("4. Generate comprehensive summary tables and narrative findings for publication.");
  lines.push("-->");
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
      "Year",
      "Status",
      "Progress",
      ...fields.map((f) => f.label),
    ];
    lines.push(`| ${tableHeaders.join(" | ")} |`);
    lines.push(
      `| ${tableHeaders
        .map((_, i) => (i === 0 || i === 2 || i === 3 || i === 4 ? ":---:" : ":---"))
        .join(" | ")} |`,
    );

    rows.forEach((row, idx) => {
      const cells = [
        String(idx + 1),
        cleanTableText(row.work_title),
        row.published_year ? String(row.published_year) : "—",
        row.status,
        `${row.answered}/${row.field_total}`,
        ...fields.map((f) => {
          const val = exportCellValue(row.cells?.[f.key]);
          if (val === null || val === undefined || String(val).trim() === "") return "—";
          return cleanTableText(String(val));
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
      lines.push(
        `- **Status**: \`${row.status}\` · **Answered**: ${row.answered} / ${row.field_total} fields`,
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
