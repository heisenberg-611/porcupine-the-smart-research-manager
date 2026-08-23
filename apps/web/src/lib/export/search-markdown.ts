import type { ScoredWork } from "@Porcupine/discovery";

export interface SearchExportOptions {
  terms: string;
  fromYear?: number | string | null | undefined;
  toYear?: number | string | null | undefined;
  ranked: readonly ScoredWork[];
  counts?: Array<{ provider: string; count: number }> | undefined;
  failures?: Array<{ provider: string; message: string }> | undefined;
  generatedAt?: Date | undefined;
}

/**
 * Format search results into a clean, comprehensive Markdown document
 * optimized for AI analysis, LLM screening prompts, and human literature review.
 */
export function formatSearchExportMarkdown(options: SearchExportOptions): string {
  const {
    terms,
    fromYear,
    toYear,
    ranked,
    counts = [],
    failures = [],
    generatedAt = new Date(),
  } = options;

  const dateStr = generatedAt.toISOString().slice(0, 10);
  const timeStr = generatedAt.toISOString().slice(11, 19) + " UTC";

  const yearRangeText =
    fromYear && toYear
      ? `${fromYear} – ${toYear}`
      : fromYear
        ? `From ${fromYear}`
        : toYear
          ? `Up to ${toYear}`
          : "All years";

  const sourceCountsText =
    counts.length > 0
      ? counts.map((c) => `${c.provider} (${c.count})`).join(", ")
      : "None reported";

  const lines: string[] = [];

  // Header & Overview
  lines.push(`# Literature Search Export: ${terms}`);
  lines.push("");
  lines.push("## Search Overview");
  lines.push(`- **Query Terms:** ${terms}`);
  lines.push(`- **Year Filter:** ${yearRangeText}`);
  lines.push(`- **Total Results:** ${ranked.length} deduplicated papers`);
  lines.push(`- **Exported At:** ${dateStr} ${timeStr}`);
  lines.push(`- **Database Sources:** ${sourceCountsText}`);

  if (failures.length > 0) {
    const failureList = failures.map((f) => `${f.provider} (${f.message})`).join("; ");
    lines.push(`- **Source Warnings:** Some databases did not respond: ${failureList}`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");

  // AI Prompt Template & Screening Guidance
  lines.push("## AI Prompt & Research Guidance");
  lines.push(
    `> **Prompt Template for LLM / AI Analysis:**\n` +
      `> "I have exported ${ranked.length} candidate research papers for the query **'${terms}'**.\n` +
      `> Please review the titles and abstracts of the candidate papers below according to my research goals.\n` +
      `> \n` +
      `> **Instructions:**\n` +
      `> 1. **Screen for Relevance:** Identify which papers are most directly relevant to [insert your specific research criteria / questions].\n` +
      `> 2. **Key Thematic Clusters:** Group the candidate papers into 3–5 overarching themes or methodological approaches.\n` +
      `> 3. **Top Shortlist:** Provide a curated shortlist of the top 10 recommended papers to prioritize reading, referencing their \`[Paper #]\` and DOI/arXiv link, with a 2-sentence justification for each.\n` +
      `> 4. **Exclusion Suggestions:** Highlight any papers that appear to be false-positive keyword matches or out of scope."`,
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // Candidate Papers List
  lines.push(`## Candidate Papers (${ranked.length})`);
  lines.push("");

  if (ranked.length === 0) {
    lines.push("*No papers matched this search query.*");
    lines.push("");
    return lines.join("\n");
  }

  ranked.forEach((item, index) => {
    const paperNum = index + 1;
    const work = item.work;

    // Title
    lines.push(`### [Paper ${paperNum}] ${work.title}`);
    lines.push("");

    // Authors formatting
    const authorList: string[] = [];
    if (Array.isArray(work.authors) && work.authors.length > 0) {
      for (const a of work.authors) {
        if (!a) continue;
        if (typeof a === "string") {
          authorList.push(a);
        } else if (typeof a === "object" && "name" in a && typeof a.name === "string") {
          const aff = a.affiliation ? ` (${a.affiliation})` : "";
          authorList.push(`${a.name}${aff}`);
        }
      }
    }
    const authorsText = authorList.length > 0 ? authorList.join(", ") : "Unknown authors";
    lines.push(`- **Authors:** ${authorsText}`);

    // Publication info
    const yearText = work.publishedYear ? String(work.publishedYear) : "Unknown year";
    const venueText = work.venue ? work.venue : "Not specified";
    const typeText = work.type ? work.type : "article";
    lines.push(`- **Publication:** ${yearText} · Venue: *${venueText}* · Type: ${typeText}`);

    // Identifiers & Links
    const identifiers: string[] = [];
    if (work.doi) {
      identifiers.push(`[DOI: ${work.doi}](https://doi.org/${work.doi})`);
    }
    if (work.arxivId) {
      identifiers.push(`[arXiv: ${work.arxivId}](https://arxiv.org/abs/${work.arxivId})`);
    }
    if (work.pmid) {
      identifiers.push(`[PMID: ${work.pmid}](https://pubmed.ncbi.nlm.nih.gov/${work.pmid})`);
    }
    if (work.openalexId) {
      identifiers.push(
        `[OpenAlex: ${work.openalexId}](https://openalex.org/${work.openalexId})`,
      );
    }
    if (work.oaPdfUrl) {
      identifiers.push(`[Open Access PDF](${work.oaPdfUrl})`);
    }

    const identifiersText = identifiers.length > 0 ? identifiers.join(" · ") : "None reported";
    lines.push(`- **Links & Identifiers:** ${identifiersText}`);

    // Citations & OA
    const oaStatusText = work.oaStatus ? work.oaStatus : work.oaPdfUrl ? "open access" : "unknown";
    lines.push(
      `- **Metrics & Access:** ${work.citedByCount.toLocaleString()} citations · OA: ${oaStatusText}`,
    );

    // Relevance scoring
    const matchedText =
      item.matched && item.matched.length > 0 ? item.matched.join(", ") : "None";
    lines.push(
      `- **Relevance:** Score ${(item.score * 100).toFixed(1)}% · Matched keywords: ${matchedText}`,
    );

    if (item.signals) {
      const sig = item.signals;
      lines.push(
        `  - Signals: Title match ${(sig.titleMatch * 100).toFixed(0)}% · Abstract match ${(sig.abstractMatch * 100).toFixed(0)}% · Recency ${(sig.recency * 100).toFixed(0)}% · Impact ${(sig.impact * 100).toFixed(0)}%`,
      );
    }

    // Abstract
    lines.push("");
    lines.push("#### Abstract");
    if (work.abstract && work.abstract.trim().length > 0) {
      lines.push(work.abstract.trim());
    } else {
      lines.push("*No abstract available for this record.*");
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * Generate a clean, URL- and filename-safe filename for search export.
 * e.g. "papers-spaced-repetition-medical-education-2026-08-23.md"
 */
export function generateSearchExportFilename(terms: string, date = new Date()): string {
  const dateStr = date.toISOString().slice(0, 10);
  const slugTerms =
    terms
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "search-results";

  return `papers-${slugTerms}-${dateStr}.md`;
}

/**
 * Trigger client-side download of the generated Markdown file in the browser.
 */
export function downloadSearchExportMarkdown(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
