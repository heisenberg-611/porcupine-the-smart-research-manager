"use client";

import { useState, type ReactNode } from "react";

import { parseMarkdown, type BlockNode, type InlineNode } from "@/lib/markdown";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export interface SearchMatchTracker {
  count: number;
}

export function highlightText(
  text: string,
  query?: string,
  activeMatchIndex?: number,
  tracker?: SearchMatchTracker,
): ReactNode[] {
  if (!query || !query.trim()) return [text];

  const trimmed = query.trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  if (parts.length === 1) return [text];

  return parts.map((part, i) => {
    if (part.toLowerCase() === trimmed.toLowerCase()) {
      const matchIdx = tracker ? tracker.count++ : 0;
      const isActive = activeMatchIndex !== undefined && matchIdx === activeMatchIndex;

      return (
        <mark
          key={i}
          data-search-match="true"
          data-match-index={matchIdx}
          className={cx(
            "rounded-xs px-0.5 transition-all",
            isActive
              ? "ring-accent bg-amber-400 font-bold text-black shadow-xs ring-2 ring-offset-1 dark:bg-amber-300 dark:text-black"
              : "bg-amber-200/90 font-medium text-black dark:bg-amber-400/30 dark:text-amber-200",
          )}
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}

export function renderInlineNodes(
  nodes: InlineNode[],
  query?: string,
  activeMatchIndex?: number,
  tracker?: SearchMatchTracker,
): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return highlightText(node.value, query, activeMatchIndex, tracker);
      case "bold":
        return (
          <strong key={index} className="text-ink font-semibold">
            {renderInlineNodes(node.children, query, activeMatchIndex, tracker)}
          </strong>
        );
      case "italic":
        return (
          <em key={index} className="italic">
            {renderInlineNodes(node.children, query, activeMatchIndex, tracker)}
          </em>
        );
      case "bold_italic":
        return (
          <strong key={index} className="text-ink font-semibold">
            <em className="italic">
              {renderInlineNodes(node.children, query, activeMatchIndex, tracker)}
            </em>
          </strong>
        );
      case "strike":
        return (
          <del key={index} className="line-through opacity-75">
            {renderInlineNodes(node.children, query, activeMatchIndex, tracker)}
          </del>
        );
      case "code":
        return (
          <code
            key={index}
            className="bg-surface/80 text-ink border-border/50 rounded-md border px-1.5 py-0.5 font-mono text-[0.85em] font-normal"
          >
            {highlightText(node.value, query, activeMatchIndex, tracker)}
          </code>
        );
      case "link": {
        const isExternal = !node.href.startsWith("/") && !node.href.startsWith("#");
        return (
          <a
            key={index}
            href={node.href}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noopener noreferrer nofollow" : undefined}
            className="text-accent font-medium underline underline-offset-2 transition-opacity hover:opacity-80"
          >
            {renderInlineNodes(node.children, query, activeMatchIndex, tracker)}
          </a>
        );
      }
      case "br":
        return <br key={index} />;
    }
  });
}

export function renderBlock(
  block: BlockNode,
  index: number,
  query?: string,
  activeMatchIndex?: number,
  tracker?: SearchMatchTracker,
): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p key={index} className="leading-relaxed text-pretty">
          {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
        </p>
      );
    case "heading": {
      switch (block.level) {
        case 1:
          return (
            <h2
              key={index}
              className="text-ink mt-4 mb-2 text-xl font-semibold tracking-tight"
            >
              {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
            </h2>
          );
        case 2:
          return (
            <h3
              key={index}
              className="text-ink mt-3.5 mb-1.5 text-lg font-semibold tracking-tight"
            >
              {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
            </h3>
          );
        case 3:
          return (
            <h4 key={index} className="text-ink mt-3 mb-1 text-base font-semibold">
              {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
            </h4>
          );
        default:
          return (
            <h5 key={index} className="text-ink text-ui mt-2 mb-0.5 font-medium">
              {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
            </h5>
          );
      }
    }
    case "ul":
      return (
        <ul
          key={index}
          className="my-2 ml-5 list-outside list-disc space-y-1 leading-relaxed"
        >
          {block.items.map((item, itemIdx) => (
            <li key={itemIdx} className="pl-1">
              {renderInlineNodes(item.inline, query, activeMatchIndex, tracker)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol
          key={index}
          className="my-2 ml-5 list-outside list-decimal space-y-1 leading-relaxed"
        >
          {block.items.map((item, itemIdx) => (
            <li key={itemIdx} className="pl-1">
              {renderInlineNodes(item.inline, query, activeMatchIndex, tracker)}
            </li>
          ))}
        </ol>
      );
    case "blockquote":
      return (
        <blockquote
          key={index}
          className="border-accent/60 text-muted/90 bg-surface/30 my-2.5 rounded-r-lg border-l-2 py-1 pl-3.5 italic"
        >
          {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
        </blockquote>
      );
    case "code_block":
      return (
        <pre
          key={index}
          className="bg-surface/80 text-fine border-border/50 text-ink my-2.5 overflow-x-auto rounded-xl border p-3.5 font-mono shadow-xs"
        >
          <code className="block leading-normal">
            {highlightText(block.code, query, activeMatchIndex, tracker)}
          </code>
        </pre>
      );
    case "hr":
      return <hr key={index} className="border-rule/80 my-4" />;
    case "table":
      return (
        <div
          key={index}
          className="border-border/70 bg-surface/50 my-3.5 overflow-x-auto rounded-xl border shadow-xs"
        >
          <table className="divide-border/60 text-ink text-ui w-full divide-y text-left text-sm">
            <thead className="bg-raised/80 font-semibold">
              <tr>
                {block.headers.map((h, hIdx) => {
                  const alignClass =
                    h.align === "center"
                      ? "text-center"
                      : h.align === "right"
                        ? "text-right"
                        : "text-left";
                  return (
                    <th
                      key={hIdx}
                      className={cx("text-ink px-4 py-2.5 font-semibold", alignClass)}
                    >
                      {renderInlineNodes(h.inline, query, activeMatchIndex, tracker)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {block.rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-surface/70 transition-colors">
                  {row.map((cell, cIdx) => {
                    const alignClass =
                      cell.align === "center"
                        ? "text-center"
                        : cell.align === "right"
                          ? "text-right"
                          : "text-left";
                    return (
                      <td
                        key={cIdx}
                        className={cx(
                          "text-ink-soft px-4 py-2.5 align-top leading-relaxed",
                          alignClass,
                        )}
                      >
                        {renderInlineNodes(cell.inline, query, activeMatchIndex, tracker)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/**
 * Renders formatted markdown text with Porcupine theme tokens and safe React elements.
 * Supports keyword highlighting (`searchQuery`), active match navigation (`activeMatchIndex`),
 * and expandable collapsed view.
 */
export function FormattedText({
  text,
  className,
  collapsible = false,
  maxCollapsedHeight = 160,
  searchQuery,
  activeMatchIndex,
  onMatchCountChange,
}: {
  text?: string | null;
  className?: string;
  collapsible?: boolean;
  maxCollapsedHeight?: number;
  searchQuery?: string;
  activeMatchIndex?: number;
  onMatchCountChange?: (count: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!text || text.trim() === "") return null;
  const blocks = parseMarkdown(text);
  const isLong = text.length > 280 || blocks.length > 2;

  const tracker: SearchMatchTracker = { count: 0 };
  const renderedBlocks = blocks.map((block, index) =>
    renderBlock(block, index, searchQuery, activeMatchIndex, tracker),
  );

  // Notify parent of total matches found
  if (onMatchCountChange) {
    onMatchCountChange(tracker.count);
  }

  if (collapsible && isLong && !expanded) {
    return (
      <div className={cx("relative", className)}>
        <div
          style={{ maxHeight: `${maxCollapsedHeight}px` }}
          className="space-y-3 overflow-hidden leading-relaxed transition-all duration-300"
        >
          {renderedBlocks}
        </div>
        <div className="via-canvas/80 to-canvas pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent" />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-accent hover:text-accent/80 text-fine focus-visible:ring-accent mt-2 inline-flex items-center gap-1 rounded font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          Show full description ↓
        </button>
      </div>
    );
  }

  return (
    <div className={cx("space-y-3 leading-relaxed", className)}>
      {renderedBlocks}
      {collapsible && isLong && expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-accent hover:text-accent/80 text-fine focus-visible:ring-accent mt-2 inline-flex items-center gap-1 rounded font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          Show less ↑
        </button>
      )}
    </div>
  );
}
