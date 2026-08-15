import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  COMMANDS,
  DOCUMENT_CLASSES,
  ENVIRONMENTS,
  PACKAGES,
  TIKZ_LIBRARIES,
} from "./editor-vocabulary";

/**
 * Completions, in the places LaTeX actually needs them.
 *
 * Four contexts, and telling them apart is the whole value. A list of every
 * control sequence offered everywhere is a list nobody reads; `\begin{` should
 * offer environments and nothing else, `\usepackage{` should offer packages,
 * and a bare backslash should offer commands with the ones people use most at
 * the top.
 */

/** `\begin{`, `\end{` — environments, and completing one closes it. */
const ENVIRONMENT_AT = /\\(begin|end)\{([^}]*)$/;
/** `\usepackage[opts]{`, `\RequirePackage{` — package names. */
const PACKAGE_AT = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)$/;
const CLASS_AT = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)$/;
const TIKZ_AT = /\\usetikzlibrary\{([^}]*)$/;
/** A control sequence being typed. */
const COMMAND_AT = /\\([a-zA-Z]*)$/;

export function latexCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 200), context.pos);

  const environment = ENVIRONMENT_AT.exec(before);
  if (environment) {
    const isBegin = environment[1] === "begin";
    return {
      from: context.pos - (environment[2]?.length ?? 0),
      options: ENVIRONMENTS.map((env) =>
        isBegin
          ? // Completing `\begin{figure}` writes the `\end{figure}` too. Writing
            // one without the other is the most common way a LaTeX document
            // breaks, and the error it produces names a line far from the cause.
            snippetCompletion(environmentSnippet(env.label, env.body), {
              label: env.label,
              ...(env.detail !== undefined ? { detail: env.detail } : {}),
              type: "class",
              boost: env.boost ?? 0,
            })
          : ({
              label: env.label,
              ...(env.detail !== undefined ? { detail: env.detail } : {}),
              type: "class",
              boost: env.boost ?? 0,
              apply: `${env.label}}`,
            } satisfies Completion),
      ),
      validFor: /^[\w*]*$/,
    };
  }

  const pkg = PACKAGE_AT.exec(before);
  if (pkg) {
    return {
      from: context.pos - (pkg[1]?.length ?? 0),
      options: PACKAGES.map((p) => ({
        label: p.label,
        ...(p.detail !== undefined ? { detail: p.detail } : {}),
        type: "namespace",
      })),
      validFor: /^[\w-]*$/,
    };
  }

  const cls = CLASS_AT.exec(before);
  if (cls) {
    return {
      from: context.pos - (cls[1]?.length ?? 0),
      options: DOCUMENT_CLASSES.map((c) => ({
        label: c.label,
        ...(c.detail !== undefined ? { detail: c.detail } : {}),
        type: "namespace",
      })),
      validFor: /^[\w-]*$/,
    };
  }

  const tikz = TIKZ_AT.exec(before);
  if (tikz) {
    // Only what follows the last comma: `\usetikzlibrary{calc, arr` is
    // completing `arr`, not the whole list.
    const typed = (tikz[1] ?? "").split(",").pop() ?? "";
    return {
      from: context.pos - typed.trimStart().length,
      options: TIKZ_LIBRARIES.map((label) => ({ label, type: "namespace" })),
      validFor: /^[\w.]*$/,
    };
  }

  const command = COMMAND_AT.exec(before);
  if (command) {
    // `explicit` means the user pressed the key deliberately, so offer the
    // whole list; otherwise wait for a letter, or every `\` interrupts typing.
    if (!context.explicit && (command[1] ?? "").length === 0) return null;

    return {
      from: context.pos - (command[1]?.length ?? 0) - 1,
      options: COMMANDS.map((c) =>
        c.snippet
          ? snippetCompletion(c.snippet, {
              label: c.label,
              ...(c.detail !== undefined ? { detail: c.detail } : {}),
              type: "function",
              boost: c.boost ?? 0,
            })
          : ({
              label: c.label,
              ...(c.detail !== undefined ? { detail: c.detail } : {}),
              type: "keyword",
              boost: c.boost ?? 0,
            } satisfies Completion),
      ),
      validFor: /^\\[a-zA-Z]*$/,
    };
  }

  return null;
}

function environmentSnippet(name: string, body?: string): string {
  const inner = body ? `\t${body.replace(/\n/g, "\n\t")}` : "\t#{}";
  return `${name}}\n${inner}\n\\end{${name}}`;
}

/**
 * Close an environment typed by hand.
 *
 * The completion list handles `\begin{fig` → Tab, but plenty of people type
 * the whole thing. Closing the brace on `\begin{figure}` writes the matching
 * `\end{figure}` and leaves the cursor between them.
 *
 * Deliberately only fires on a manually typed `}` at the end of a `\begin{…}`
 * — not on paste, and not mid-line, where the user is more likely editing an
 * environment that already has its closing tag.
 *
 * `Prec.high` because `closeBrackets` registers an input handler of its own
 * and would otherwise consume the keystroke first, typing over the brace it
 * inserted and returning before this ever ran.
 */
export const closeEnvironmentOnBrace = Prec.high(
  EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== "}") return false;

    const line = view.state.doc.lineAt(from);
    const before = view.state.sliceDoc(line.from, from);
    const match = /\\begin\{([A-Za-z][\w*]*)$/.exec(before);
    if (!match) return false;

    /*
     * The closing brace may already be there.
     *
     * `closeBrackets` inserts `}` the moment `{` is typed, so by the time
     * someone finishes `\begin{figure` the line already ends in `}` and their
     * final keystroke is typing OVER it rather than inserting. The first
     * version only handled the other case — nothing after the cursor — so
     * hand-typing an environment did nothing at all, which is the common path.
     */
    const rest = view.state.sliceDoc(to, line.to);
    const end = rest === "}" ? to + 1 : rest === "" ? to : -1;
    if (end === -1) return false;

    const name = match[1]!;
    const indent = /^\s*/.exec(line.text)?.[0] ?? "";
    const insert = `}\n${indent}\t\n${indent}\\end{${name}}`;

    view.dispatch({
      changes: { from, to: end, insert },
      // Between the two, one tab in — where the content goes.
      selection: { anchor: from + 2 + indent.length + 1 },
      userEvent: "input.complete",
    });

    return true;
  }),
);
