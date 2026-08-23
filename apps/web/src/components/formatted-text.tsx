"use client";

import { useState, type ReactNode } from "react";

import {
  parseMarkdown,
  type BlockNode,
  type InlineNode,
} from "@/lib/markdown";

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
              ? "bg-amber-400 text-black font-bold ring-2 ring-accent ring-offset-1 shadow-xs dark:bg-amber-300"
              : "bg-amber-200/90 text-black dark:bg-amber-400/40 dark:text-ink font-medium",
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
          <strong key={index} className="font-semibold text-ink">
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
          <strong key={index} className="font-semibold text-ink">
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
            className="rounded-md bg-surface/80 px-1.5 py-0.5 font-mono text-[0.85em] text-ink border border-border/50 font-normal"
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
            className="text-accent underline underline-offset-2 hover:opacity-80 transition-opacity font-medium"
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
            <h2 key={index} className="text-ink text-xl font-semibold mt-4 mb-2 tracking-tight">
              {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
            </h2>
          );
        case 2:
          return (
            <h3 key={index} className="text-ink text-lg font-semibold mt-3.5 mb-1.5 tracking-tight">
              {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
            </h3>
          );
        case 3:
          return (
            <h4 key={index} className="text-ink text-base font-semibold mt-3 mb-1">
              {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
            </h4>
          );
        default:
          return (
            <h5 key={index} className="text-ink text-ui font-medium mt-2 mb-0.5">
              {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
            </h5>
          );
      }
    }
    case "ul":
      return (
        <ul key={index} className="list-disc list-outside ml-5 space-y-1 my-2 leading-relaxed">
          {block.items.map((item, itemIdx) => (
            <li key={itemIdx} className="pl-1">
              {renderInlineNodes(item.inline, query, activeMatchIndex, tracker)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={index} className="list-decimal list-outside ml-5 space-y-1 my-2 leading-relaxed">
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
          className="border-l-2 border-accent/60 pl-3.5 py-1 italic text-muted/90 my-2.5 bg-surface/30 rounded-r-lg"
        >
          {renderInlineNodes(block.inline, query, activeMatchIndex, tracker)}
        </blockquote>
      );
    case "code_block":
      return (
        <pre
          key={index}
          className="bg-surface/80 rounded-xl p-3.5 font-mono text-fine border border-border/50 overflow-x-auto text-ink my-2.5 shadow-xs"
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
                      className={cx(
                        "px-4 py-2.5 font-semibold text-ink",
                        alignClass,
                      )}
                    >
                      {renderInlineNodes(h.inline, query, activeMatchIndex, tracker)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {block.rows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="hover:bg-surface/70 transition-colors"
                >
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
                          "px-4 py-2.5 align-top leading-relaxed text-ink-soft",
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
          className="overflow-hidden space-y-3 leading-relaxed transition-all duration-300"
        >
          {renderedBlocks}
        </div>
        <div className="from-transparent via-canvas/80 to-canvas absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b pointer-events-none" />
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-accent hover:text-accent/80 text-fine font-medium mt-2 inline-flex items-center gap-1 focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none rounded transition-colors"
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
          className="text-accent hover:text-accent/80 text-fine font-medium mt-2 inline-flex items-center gap-1 focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none rounded transition-colors"
        >
          Show less ↑
        </button>
      )}
    </div>
  );
}
