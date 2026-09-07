/**
 * Smart Question Parser.
 *
 * Converts arbitrary user-pasted text (such as .env key-values, Markdown tables,
 * lists, pipe-delimited pairs, colon-separated lines, or JSON) into structured
 * Research Question items with question text and keywords.
 */

export interface ParsedQuestionItem {
  text: string;
  keywords: string[];
}

/**
 * Split comma or newline separated keywords and clean them.
 * Handles markdown backticks, quotes, and whitespace.
 */
export function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((k) => k.replace(/^[`#"'\s]+|[`#"'\s]+$/g, "").trim())
    .filter((k) => k.length > 0 && k.length <= 60);
}

/**
 * Remove surrounding quotes ('...' or "..." or `...`).
 */
function unquote(str: string): string {
  let trimmed = str.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Clean markdown bold/italic/code formatting:
 * **text** -> text, *text* -> text, `text` -> text
 */
function stripMarkdownFormatting(str: string): string {
  let res = str.trim();
  // Strip outer bold **...** or __...__
  if (
    (res.startsWith("**") && res.endsWith("**")) ||
    (res.startsWith("__") && res.endsWith("__"))
  ) {
    res = res.slice(2, -2).trim();
  }
  // Strip outer italic *...* or _..._
  if (
    (res.startsWith("*") && res.endsWith("*")) ||
    (res.startsWith("_") && res.endsWith("_"))
  ) {
    res = res.slice(1, -1).trim();
  }
  // Strip outer code backticks `...`
  if (res.startsWith("`") && res.endsWith("`")) {
    res = res.slice(1, -1).trim();
  }
  return res;
}

/**
 * Strip numbering, bullets, or leading list markers like:
 * "1. ", "1) ", "[1] ", "- ", "* ", "• "
 */
function stripListMarker(line: string): string {
  return line.replace(/^(\d+[\.\)]|\[\d+\]|[\-\*\•])\s+/, "").trim();
}

/**
 * Strip inline comments starting with '#' or '//' if not inside quotes.
 */
function stripComments(line: string): string {
  // If line starts with a comment, return empty
  if (/^\s*(#|\/\/)/.test(line)) return "";

  // Check for trailing comment, e.g. `RQ1=Value # comment`
  const hashIdx = line.indexOf(" #");
  if (hashIdx !== -1) {
    const before = line.slice(0, hashIdx);
    const quotesCount = (before.match(/["'`]/g) || []).length;
    if (quotesCount % 2 === 0) {
      return before.trim();
    }
  }

  const slashIdx = line.indexOf(" //");
  if (slashIdx !== -1) {
    const before = line.slice(0, slashIdx);
    const quotesCount = (before.match(/["'`]/g) || []).length;
    if (quotesCount % 2 === 0) {
      return before.trim();
    }
  }

  return line.trim();
}

/**
 * Check if a line is a markdown table separator (e.g. | --- | --- | or |:---|---:|)
 */
function isMarkdownTableSeparator(line: string): boolean {
  const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => /^:?-+:?$/.test(p));
}

/**
 * Check if cells look like a table header (e.g. "Research question", "Keywords", "Tags")
 */
function isMarkdownTableHeader(cells: string[]): boolean {
  if (cells.length === 0) return false;
  const headerTerms = [
    "research question",
    "question",
    "questions",
    "rq",
    "title",
    "tags",
    "keywords",
    "related tags",
    "related keywords",
    "topic",
    "category",
    "#",
    "no.",
    "id",
  ];
  return cells.some((cell) => {
    const normalized = cell.toLowerCase().replace(/[*_`#]/g, "").trim();
    return headerTerms.includes(normalized);
  });
}

/**
 * Helper to determine if a string looks like a short variable identifier (e.g. RQ1, QUESTION_1, Q1, RQ)
 * rather than a full question sentence.
 */
function isVariableKey(str: string): boolean {
  const trimmed = str.trim();
  if (trimmed.includes("?")) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 4 || trimmed.length > 30) return false;
  return /^[a-zA-Z0-9_\-\s]+$/.test(trimmed);
}

/**
 * Parse an entire raw pasted input into an array of question items.
 */
export function parseQuestionsInput(raw: string): ParsedQuestionItem[] {
  if (!raw || typeof raw !== "string") return [];

  const trimmed = raw.trim();
  if (!trimmed) return [];

  // 1. Try parsing JSON
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      const parsedJson = JSON.parse(trimmed);
      const items = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
      const results: ParsedQuestionItem[] = [];

      for (const item of items) {
        if (typeof item === "string" && item.trim()) {
          results.push({ text: cleanQuestionText(item), keywords: [] });
        } else if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const text = (
            typeof record.text === "string"
              ? record.text
              : typeof record.question === "string"
                ? record.question
                : typeof record.title === "string"
                  ? record.title
                  : typeof record.name === "string"
                    ? record.name
                    : ""
          ).trim();

          if (text) {
            let keywords: string[] = [];
            if (Array.isArray(record.keywords)) {
              keywords = record.keywords.map((k: unknown) => String(k).trim()).filter(Boolean);
            } else if (typeof record.keywords === "string") {
              keywords = splitKeywords(record.keywords);
            }
            results.push({ text: cleanQuestionText(text), keywords });
          }
        }
      }

      if (results.length > 0) {
        return deduplicateQuestions(results);
      }
    } catch {
      // Not valid JSON, continue with text parsing
    }
  }

  // 2. Check for Paragraph / Block structure with explicit "Keywords:" or "Tags:" lines
  const paragraphs = raw.split(/\n\s*\n+/);
  if (paragraphs.length > 1) {
    const parsedParagraphs: ParsedQuestionItem[] = [];
    let isBlockFormat = false;

    for (const para of paragraphs) {
      const lines = para
        .split("\n")
        .map((l) => stripComments(l))
        .map((l) => l.trim())
        .filter(Boolean);

      if (lines.length === 0) continue;

      if (lines.length >= 2) {
        const firstLine = lines[0] ?? "";
        const remainingLines = lines.slice(1).join(" ");
        const keywordMatch = remainingLines.match(/^(?:keywords?|tags?|matched)\s*[:=]\s*(.+)$/i);

        if (keywordMatch && keywordMatch[1]) {
          isBlockFormat = true;
          const text = cleanQuestionText(firstLine);
          const keywords = splitKeywords(keywordMatch[1]);
          if (text) {
            parsedParagraphs.push({ text, keywords });
          }
          continue;
        }
      }

      const singleResults = parseLineByLine(lines);
      parsedParagraphs.push(...singleResults);
    }

    if (isBlockFormat && parsedParagraphs.length > 0) {
      return deduplicateQuestions(parsedParagraphs);
    }
  }

  // 3. Line-by-line parsing (including markdown tables, .env, list items, etc.)
  const rawLines = raw.split("\n");
  const parsed = parseLineByLine(rawLines);
  return deduplicateQuestions(parsed);
}

/**
 * Line by line parser supporting Markdown tables, .env (KEY=VALUE), Pipe (|), Colon (:), and plain text.
 */
function parseLineByLine(lines: string[]): ParsedQuestionItem[] {
  const results: ParsedQuestionItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? "";
    line = stripComments(line);
    if (!line) continue;

    // Check if line is a markdown table separator (| --- | --- |)
    if (line.includes("|") && isMarkdownTableSeparator(line)) {
      continue;
    }

    // A. Pipe separator format & Markdown table rows:
    // e.g. `| **1. Question text?** | `tag1`, `tag2` |`
    // or `Question text | tag1, tag2`
    if (line.includes("|")) {
      const rawParts = line.split("|");
      // Strip leading and trailing empty entries caused by outer `|` borders
      const cells = rawParts.map((p) => p.trim()).filter((p, idx) => {
        if ((idx === 0 || idx === rawParts.length - 1) && p === "") return false;
        return true;
      });

      // Skip table header rows
      if (isMarkdownTableHeader(cells)) {
        continue;
      }

      if (cells.length >= 2) {
        let questionPart = "";
        let keywordsPart = "";

        // If there are 3+ cells, check if first cell is just index/ID (e.g. | 1 | Question | Keywords |)
        if (cells.length >= 3) {
          const firstCell = cells[0] ?? "";
          const secondCell = cells[1] ?? "";
          const thirdCell = cells.slice(2).join(",");

          if (/^(?:rq\d*|\d+|#\d+)$/i.test(firstCell.replace(/[*_`]/g, "").trim())) {
            questionPart = secondCell;
            keywordsPart = thirdCell;
          } else {
            questionPart = firstCell;
            keywordsPart = cells.slice(1).join(",");
          }
        } else {
          questionPart = cells[0] ?? "";
          keywordsPart = cells[1] ?? "";
        }

        const cleaned = cleanQuestionText(questionPart);
        if (cleaned) {
          results.push({
            text: cleaned,
            keywords: splitKeywords(keywordsPart),
          });
          continue;
        }
      } else if (cells.length === 1) {
        const cleaned = cleanQuestionText(cells[0] ?? "");
        if (cleaned) {
          results.push({ text: cleaned, keywords: [] });
          continue;
        }
      }
    }

    // Strip "export " prefix if present (e.g. `export RQ1="What is X?"`)
    line = line.replace(/^export\s+/, "").trim();

    // Strip leading list numbering or bullet markers: `1. `, `- `, etc.
    line = stripListMarker(line);
    if (!line) continue;

    // Check for explicit "Question: ..." / "Q: ..." / "RQ: ..." prefix
    const explicitQMatch = line.match(/^(?:question|rq\d*|q\d*)\s*:\s*(.+)$/i);
    if (explicitQMatch && explicitQMatch[1]) {
      line = explicitQMatch[1].trim();
    }

    // B. Equals separator format: .env style `KEY=VALUE` or `QUESTION=KEYWORDS`
    if (line.includes("=")) {
      const eqIdx = line.indexOf("=");
      const left = line.slice(0, eqIdx).trim();
      const right = line.slice(eqIdx + 1).trim();

      if (isVariableKey(left)) {
        const unquotedRight = unquote(right);
        if (unquotedRight.includes("|")) {
          const parts = unquotedRight.split("|");
          const qText = cleanQuestionText(parts[0] ?? "");
          const kws = splitKeywords(parts.slice(1).join(","));
          if (qText) {
            results.push({ text: qText, keywords: kws });
            continue;
          }
        }

        const cleaned = cleanQuestionText(unquotedRight);
        if (cleaned) {
          results.push({ text: cleaned, keywords: [] });
          continue;
        }
      } else {
        const qText = cleanQuestionText(unquote(left));
        const kws = splitKeywords(unquote(right));
        if (qText) {
          results.push({ text: qText, keywords: kws });
          continue;
        }
      }
    }

    // C. Colon separator format (if not just a prefix)
    if (line.includes(":") && (line.includes("?") || line.length > 30)) {
      const colonIdx = line.indexOf(":");
      const left = line.slice(0, colonIdx).trim();
      const right = line.slice(colonIdx + 1).trim();

      if (left.includes("?") || left.split(/\s+/).length >= 4) {
        const qText = cleanQuestionText(unquote(left));
        const kws = splitKeywords(unquote(right));
        if (qText && kws.length > 0) {
          results.push({ text: qText, keywords: kws });
          continue;
        }
      }
    }

    // D. Plain question line
    const plainText = cleanQuestionText(unquote(line));
    if (plainText) {
      results.push({ text: plainText, keywords: [] });
    }
  }

  return results;
}

/**
 * Clean question text: trim, remove stray quotes, strip bold/italic markdown, list markers.
 */
function cleanQuestionText(text: string): string {
  let cleaned = unquote(text.trim());
  cleaned = stripMarkdownFormatting(cleaned);
  cleaned = cleaned.replace(/^(?:question|rq\d*|q\d*)\s*[:\-\.]\s*/i, "").trim();
  cleaned = stripListMarker(cleaned);
  // Repeat strip markdown in case bold was around the numbering (e.g. **1. How does ...?**)
  cleaned = stripMarkdownFormatting(cleaned);
  cleaned = stripListMarker(cleaned);
  return cleaned.trim();
}

/**
 * Deduplicate questions by case-insensitive text match.
 */
function deduplicateQuestions(items: ParsedQuestionItem[]): ParsedQuestionItem[] {
  const seen = new Set<string>();
  const out: ParsedQuestionItem[] = [];

  for (const item of items) {
    const key = item.text.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}
