/**
 * Safe markdown parser and AST builder for research project descriptions and notes.
 *
 * Designed to be:
 * 1. Safe by construction: parses into a typed AST rendered as React elements.
 *    Zero use of `dangerouslySetInnerHTML` or raw HTML strings.
 * 2. Complete: supports paragraphs, intra-paragraph line breaks, headings (#..####),
 *    ordered and unordered lists, blockquotes, code blocks, bold (** or __),
 *    italic (* or _), bold-italic (*** or ___), strikethrough (~~), inline code (`),
 *    markdown links ([text](url)), and autolinked URLs (https://... or www...).
 * 3. Sanitized: link destinations are checked against an allowlist of safe schemes
 *    (http, https, mailto, and relative paths). Dangerous schemes like `javascript:`
 *    or `data:` are rejected.
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "bold_italic"; children: InlineNode[] }
  | { type: "strike"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "br" };

export type BlockNode =
  | { type: "paragraph"; content: string; inline: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; content: string; inline: InlineNode[] }
  | { type: "ul"; items: Array<{ content: string; inline: InlineNode[] }> }
  | { type: "ol"; items: Array<{ content: string; inline: InlineNode[] }> }
  | { type: "blockquote"; content: string; inline: InlineNode[] }
  | { type: "code_block"; lang?: string | undefined; code: string }
  | { type: "hr" };

/**
 * Validates whether a URL is safe to be used in an anchor href.
 * Prevents XSS via javascript:, data:, vbscript:, etc.
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Relative paths, hash fragments, query strings
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("?")
  ) {
    return true;
  }

  // Scheme checks
  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:"
    );
  } catch {
    // If it starts with www., it will be normalized to https://www.
    if (trimmed.toLowerCase().startsWith("www.")) return true;
    return false;
  }
}

/**
 * Sanitizes and normalizes a URL for safe rendering.
 * Returns null if the URL is unsafe.
 */
export function sanitizeHref(url: string): string | null {
  const trimmed = url.trim();
  if (!isSafeUrl(trimmed)) return null;
  if (trimmed.toLowerCase().startsWith("www.")) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

const TRAILING_PUNCTUATION = /[.,;:!?'"\u2019\u201d\]}]+$/;

/**
 * Strips trailing sentence punctuation and balances trailing closing parentheses
 * so that URLs at the end of sentences (e.g. "see https://example.com.") or
 * URLs inside parentheses (e.g. "(https://example.com)") resolve cleanly.
 */
function cleanAutolink(raw: string): string {
  let cleaned = raw.replace(TRAILING_PUNCTUATION, "");
  let closes = (cleaned.match(/\)/g) ?? []).length;
  const opens = (cleaned.match(/\(/g) ?? []).length;
  while (closes > opens && cleaned.endsWith(")")) {
    cleaned = cleaned.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
    closes--;
  }
  return cleaned;
}

interface MatchCandidate {
  type: "code" | "bold_italic" | "bold" | "italic" | "strike" | "md_link" | "autolink" | "br";
  startIndex: number;
  endIndex: number;
  matchLength: number;
  raw: string;
  data?: {
    code?: string | undefined;
    inner?: string | undefined;
    label?: string | undefined;
    url?: string | undefined;
    href?: string | undefined;
  } | undefined;
}

/**
 * Parses inline markdown tokens into an AST of InlineNode items.
 */
export function parseInline(text: string): InlineNode[] {
  if (!text) return [];

  const nodes: InlineNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    const candidates: MatchCandidate[] = [];

    // 1. Inline code: `code`
    const codeMatch = remaining.match(/`([^`\n]+)`/);
    if (codeMatch && codeMatch.index !== undefined && codeMatch[1] !== undefined) {
      candidates.push({
        type: "code",
        startIndex: cursor + codeMatch.index,
        endIndex: cursor + codeMatch.index + codeMatch[0].length,
        matchLength: codeMatch[0].length,
        raw: codeMatch[0],
        data: { code: codeMatch[1] },
      });
    }

    // 2. Bold + Italic: ***text*** or ___text___
    const boldItalicMatch = remaining.match(/(?:\*\*\*([^\n]+?)\*\*\*|___([^\n]+?)___)/);
    if (boldItalicMatch && boldItalicMatch.index !== undefined) {
      const inner = boldItalicMatch[1] ?? boldItalicMatch[2];
      if (inner !== undefined) {
        candidates.push({
          type: "bold_italic",
          startIndex: cursor + boldItalicMatch.index,
          endIndex: cursor + boldItalicMatch.index + boldItalicMatch[0].length,
          matchLength: boldItalicMatch[0].length,
          raw: boldItalicMatch[0],
          data: { inner },
        });
      }
    }

    // 3. Bold: **text** or __text__
    const boldMatch = remaining.match(/(?:\*\*([^\n]+?)\*\*|__([^\n]+?)__)/);
    if (boldMatch && boldMatch.index !== undefined) {
      const inner = boldMatch[1] ?? boldMatch[2];
      if (inner !== undefined) {
        candidates.push({
          type: "bold",
          startIndex: cursor + boldMatch.index,
          endIndex: cursor + boldMatch.index + boldMatch[0].length,
          matchLength: boldMatch[0].length,
          raw: boldMatch[0],
          data: { inner },
        });
      }
    }

    // 4. Italic: *text* or _text_
    const italicMatch = remaining.match(/(?:\*([^\n*]+?)\*|_([^\n_]+?)_)/);
    if (italicMatch && italicMatch.index !== undefined) {
      const inner = italicMatch[1] ?? italicMatch[2];
      if (inner !== undefined) {
        candidates.push({
          type: "italic",
          startIndex: cursor + italicMatch.index,
          endIndex: cursor + italicMatch.index + italicMatch[0].length,
          matchLength: italicMatch[0].length,
          raw: italicMatch[0],
          data: { inner },
        });
      }
    }

    // 5. Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/~~([^\n~]+?)~~/);
    if (strikeMatch && strikeMatch.index !== undefined && strikeMatch[1] !== undefined) {
      candidates.push({
        type: "strike",
        startIndex: cursor + strikeMatch.index,
        endIndex: cursor + strikeMatch.index + strikeMatch[0].length,
        matchLength: strikeMatch[0].length,
        raw: strikeMatch[0],
        data: { inner: strikeMatch[1] },
      });
    }

    // 6. Markdown link: [label](url)
    const mdLinkMatch = remaining.match(/\[([^\]\n]+)\]\(([^)\s]+)\)/);
    if (
      mdLinkMatch &&
      mdLinkMatch.index !== undefined &&
      mdLinkMatch[1] !== undefined &&
      mdLinkMatch[2] !== undefined
    ) {
      const label = mdLinkMatch[1];
      const url = mdLinkMatch[2];
      const href = sanitizeHref(url);
      if (href) {
        candidates.push({
          type: "md_link",
          startIndex: cursor + mdLinkMatch.index,
          endIndex: cursor + mdLinkMatch.index + mdLinkMatch[0].length,
          matchLength: mdLinkMatch[0].length,
          raw: mdLinkMatch[0],
          data: { label, href },
        });
      }
    }

    // 7. Bare autolink: https://... or www...
    const autolinkMatch = remaining.match(/\b(https?:\/\/[^\s<>[\]]+|www\.[^\s<>[\]]+)/i);
    if (autolinkMatch && autolinkMatch.index !== undefined) {
      const cleaned = cleanAutolink(autolinkMatch[0]);
      if (cleaned) {
        const href = sanitizeHref(cleaned);
        if (href) {
          candidates.push({
            type: "autolink",
            startIndex: cursor + autolinkMatch.index,
            endIndex: cursor + autolinkMatch.index + cleaned.length,
            matchLength: cleaned.length,
            raw: cleaned,
            data: { label: cleaned, href },
          });
        }
      }
    }

    // 8. Line break: \n
    const brMatch = remaining.match(/\n/);
    if (brMatch && brMatch.index !== undefined) {
      candidates.push({
        type: "br",
        startIndex: cursor + brMatch.index,
        endIndex: cursor + brMatch.index + 1,
        matchLength: 1,
        raw: "\n",
      });
    }

    if (candidates.length === 0) {
      nodes.push({ type: "text", value: remaining });
      break;
    }

    // Pick earliest match. If tied, pick the longest match.
    candidates.sort((a, b) => {
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      return b.matchLength - a.matchLength;
    });

    const chosen = candidates[0];
    if (!chosen) {
      nodes.push({ type: "text", value: remaining });
      break;
    }

    // Push preceding plain text
    if (chosen.startIndex > cursor) {
      nodes.push({ type: "text", value: text.slice(cursor, chosen.startIndex) });
    }

    // Convert candidate to AST Node
    switch (chosen.type) {
      case "code":
        nodes.push({ type: "code", value: chosen.data?.code ?? "" });
        break;
      case "bold_italic":
        nodes.push({
          type: "bold_italic",
          children: parseInline(chosen.data?.inner ?? ""),
        });
        break;
      case "bold":
        nodes.push({
          type: "bold",
          children: parseInline(chosen.data?.inner ?? ""),
        });
        break;
      case "italic":
        nodes.push({
          type: "italic",
          children: parseInline(chosen.data?.inner ?? ""),
        });
        break;
      case "strike":
        nodes.push({
          type: "strike",
          children: parseInline(chosen.data?.inner ?? ""),
        });
        break;
      case "md_link":
        nodes.push({
          type: "link",
          href: chosen.data?.href ?? "",
          children: parseInline(chosen.data?.label ?? ""),
        });
        break;
      case "autolink":
        nodes.push({
          type: "link",
          href: chosen.data?.href ?? "",
          children: [{ type: "text", value: chosen.data?.label ?? "" }],
        });
        break;
      case "br":
        nodes.push({ type: "br" });
        break;
    }

    cursor = chosen.endIndex;
  }

  return nodes;
}

/**
 * Parses full markdown documents into an array of BlockNode blocks.
 */
export function parseMarkdown(text: string): BlockNode[] {
  if (!text || text.trim() === "") return [];

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawLines = normalized.split("\n");
  const blocks: BlockNode[] = [];

  let inCodeBlock = false;
  let codeLang: string | undefined = undefined;
  let codeLines: string[] = [];

  let currentListType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  let inBlockquote = false;
  let blockquoteLines: string[] = [];

  let paragraphLines: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length > 0) {
      const content = paragraphLines.join("\n").trim();
      if (content.length > 0) {
        blocks.push({
          type: "paragraph",
          content,
          inline: parseInline(content),
        });
      }
      paragraphLines = [];
    }
  }

  function flushList() {
    if (currentListType && listItems.length > 0) {
      const items = listItems
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => ({
          content: item,
          inline: parseInline(item),
        }));

      if (items.length > 0) {
        blocks.push({
          type: currentListType,
          items,
        });
      }
      currentListType = null;
      listItems = [];
    }
  }

  function flushBlockquote() {
    if (inBlockquote && blockquoteLines.length > 0) {
      const content = blockquoteLines.join("\n").trim();
      if (content.length > 0) {
        blocks.push({
          type: "blockquote",
          content,
          inline: parseInline(content),
        });
      }
      inBlockquote = false;
      blockquoteLines = [];
    }
  }

  function flushAll() {
    flushParagraph();
    flushList();
    flushBlockquote();
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line === undefined) continue;

    const trimmed = line.trim();

    // 1. Handling inside fenced code block
    if (inCodeBlock) {
      if (trimmed.startsWith("```")) {
        blocks.push({
          type: "code_block",
          lang: codeLang,
          code: codeLines.join("\n"),
        });
        inCodeBlock = false;
        codeLines = [];
        codeLang = undefined;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    // 2. Fenced code block opening
    if (trimmed.startsWith("```")) {
      flushAll();
      inCodeBlock = true;
      const lang = trimmed.slice(3).trim();
      codeLang = lang.length > 0 ? lang : undefined;
      codeLines = [];
      continue;
    }

    // 3. Blank line -> resets blocks
    if (trimmed === "") {
      flushAll();
      continue;
    }

    // 4. Horizontal rule: ---, ***, ___
    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
      flushAll();
      blocks.push({ type: "hr" });
      continue;
    }

    // 5. Headings: #..######
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      flushAll();
      const level = Math.min(Math.max(headingMatch[1].length, 1), 6) as 1 | 2 | 3 | 4 | 5 | 6;
      const content = headingMatch[2].trim();
      blocks.push({
        type: "heading",
        level,
        content,
        inline: parseInline(content),
      });
      continue;
    }

    // 6. Blockquote line: > quote
    const bqMatch = line.match(/^>\s?(.*)$/);
    if (bqMatch && bqMatch[1] !== undefined) {
      flushParagraph();
      flushList();
      inBlockquote = true;
      blockquoteLines.push(bqMatch[1]);
      continue;
    }

    // 7. Unordered list line: -, *, +, •
    const ulMatch = line.match(/^[*\-+•]\s+(.+)$/);
    if (ulMatch && ulMatch[1] !== undefined) {
      flushParagraph();
      flushBlockquote();
      if (currentListType !== "ul") {
        flushList();
        currentListType = "ul";
      }
      listItems.push(ulMatch[1]);
      continue;
    }

    // 8. Ordered list line: 1., 2., etc.
    const olMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (olMatch && olMatch[1] !== undefined) {
      flushParagraph();
      flushBlockquote();
      if (currentListType !== "ol") {
        flushList();
        currentListType = "ol";
      }
      listItems.push(olMatch[1]);
      continue;
    }

    // 9. Regular text / continuation
    if (inBlockquote) {
      blockquoteLines.push(line);
      continue;
    }

    if (currentListType !== null && (line.startsWith("  ") || line.startsWith("\t"))) {
      if (listItems.length > 0 && listItems[listItems.length - 1] !== undefined) {
        listItems[listItems.length - 1] += "\n" + line.trim();
        continue;
      }
    }

    flushList();
    paragraphLines.push(line);
  }

  // Final flush
  flushAll();

  // If unclosed code block, output what was collected
  if (inCodeBlock) {
    blocks.push({
      type: "code_block",
      lang: codeLang,
      code: codeLines.join("\n"),
    });
  }

  return blocks;
}
