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

export function renderInlineNodes(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "bold":
        return (
          <strong key={index} className="font-semibold text-ink">
            {renderInlineNodes(node.children)}
          </strong>
        );
      case "italic":
        return (
          <em key={index} className="italic">
            {renderInlineNodes(node.children)}
          </em>
        );
      case "bold_italic":
        return (
          <strong key={index} className="font-semibold text-ink">
            <em className="italic">{renderInlineNodes(node.children)}</em>
          </strong>
        );
      case "strike":
        return (
          <del key={index} className="line-through opacity-75">
            {renderInlineNodes(node.children)}
          </del>
        );
      case "code":
        return (
          <code
            key={index}
            className="rounded-md bg-surface/80 px-1.5 py-0.5 font-mono text-[0.85em] text-ink border border-border/50 font-normal"
          >
            {node.value}
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
            {renderInlineNodes(node.children)}
          </a>
        );
      }
      case "br":
        return <br key={index} />;
    }
  });
}

export function renderBlock(block: BlockNode, index: number): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p key={index} className="leading-relaxed text-pretty">
          {renderInlineNodes(block.inline)}
        </p>
      );
    case "heading": {
      switch (block.level) {
        case 1:
          return (
            <h2 key={index} className="text-ink text-xl font-semibold mt-4 mb-2 tracking-tight">
              {renderInlineNodes(block.inline)}
            </h2>
          );
        case 2:
          return (
            <h3 key={index} className="text-ink text-lg font-semibold mt-3.5 mb-1.5 tracking-tight">
              {renderInlineNodes(block.inline)}
            </h3>
          );
        case 3:
          return (
            <h4 key={index} className="text-ink text-base font-semibold mt-3 mb-1">
              {renderInlineNodes(block.inline)}
            </h4>
          );
        default:
          return (
            <h5 key={index} className="text-ink text-ui font-medium mt-2 mb-0.5">
              {renderInlineNodes(block.inline)}
            </h5>
          );
      }
    }
    case "ul":
      return (
        <ul key={index} className="list-disc list-outside ml-5 space-y-1 my-2 leading-relaxed">
          {block.items.map((item, itemIdx) => (
            <li key={itemIdx} className="pl-1">
              {renderInlineNodes(item.inline)}
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={index} className="list-decimal list-outside ml-5 space-y-1 my-2 leading-relaxed">
          {block.items.map((item, itemIdx) => (
            <li key={itemIdx} className="pl-1">
              {renderInlineNodes(item.inline)}
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
          {renderInlineNodes(block.inline)}
        </blockquote>
      );
    case "code_block":
      return (
        <pre
          key={index}
          className="bg-surface/80 rounded-xl p-3.5 font-mono text-fine border border-border/50 overflow-x-auto text-ink my-2.5 shadow-xs"
        >
          <code className="block leading-normal">{block.code}</code>
        </pre>
      );
    case "hr":
      return <hr key={index} className="border-rule/80 my-4" />;
  }
}

/**
 * Renders formatted markdown text with Porcupine theme tokens and safe React elements.
 * When `collapsible` is true, long multi-paragraph text is gracefully expandable.
 */
export function FormattedText({
  text,
  className,
  collapsible = false,
  maxCollapsedHeight = 160,
}: {
  text?: string | null;
  className?: string;
  collapsible?: boolean;
  maxCollapsedHeight?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!text || text.trim() === "") return null;
  const blocks = parseMarkdown(text);
  const isLong = text.length > 280 || blocks.length > 2;

  if (collapsible && isLong && !expanded) {
    return (
      <div className={cx("relative", className)}>
        <div
          style={{ maxHeight: `${maxCollapsedHeight}px` }}
          className="overflow-hidden space-y-3 leading-relaxed transition-all duration-300"
        >
          {blocks.map((block, index) => renderBlock(block, index))}
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
      {blocks.map((block, index) => renderBlock(block, index))}
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
