"use client";

import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";

import { Button } from "@/components/ui";
import { useCompiler } from "@/lib/latex/use-compiler";

import { CompilerPanel } from "./compiler-panel";
import { PackageManager } from "./package-manager";

const ENTRY = "main.tex";
const DRAFT_KEY = "porcupine.latex.spike";

const DEFAULT_TEX = `\\documentclass{article}
\\begin{document}
\\section{Compiled in this browser}
Tectonic (XeTeX) as WebAssembly. Nothing left the machine to typeset this.

Math: $E = mc^2$

Edit the source and press Compile.
\\end{document}`;

/**
 * The LaTeX spike: does client-side TeX actually work, and at what cost.
 *
 * Compilation runs in a worker (`lib/latex/`), which is not a refinement — the
 * engine's `compile()` is synchronous and takes seconds, so on the main thread
 * React could set "Compiling…" and then block before the browser painted it.
 * The button never changed and the page stopped responding until the PDF
 * appeared.
 *
 * What this spike is still not: multi-file projects, SyncTeX click-through,
 * or saving anywhere but this browser. It answers the feasibility question and
 * stops.
 */
export function SpikeClient() {
  const { compile, busy, step, outcome, error } = useCompiler();
  const [source, setSource] = useState(DEFAULT_TEX);
  const [dark, setDark] = useState(false);
  const [restored, setRestored] = useState(false);
  const editor = useRef<EditorView | null>(null);
  const [packagesToken, setPackagesToken] = useState("0:0");
  const [showPackages, setShowPackages] = useState(false);

  /**
   * Jump to the line a diagnostic points at.
   *
   * The whole value of a parsed problem list is that it takes you to the
   * cause; a line number you have to go and find by hand is a line number in a
   * log file, which is what the Log tab is already for.
   */
  const goToLine = useCallback((line: number) => {
    const view = editor.current;
    if (!view) return;

    // TeX counts from 1, CodeMirror's doc.line does too — but clamp, because
    // the log can name a line past the end of the file after an edit.
    const target = Math.min(Math.max(line, 1), view.state.doc.lines);
    const info = view.state.doc.line(target);

    view.dispatch({
      selection: { anchor: info.from },
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  // The draft survives a reload. Losing an hour's LaTeX to a refresh is the
  // kind of thing that makes people stop trusting a tool, and this is four
  // lines.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setSource(saved);
    } catch {
      // Storage denied. The editor still works; it just will not remember.
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(DRAFT_KEY, source);
    } catch {
      // As above.
    }
  }, [source, restored]);

  /*
   * CodeMirror needs to be told which theme to use — it does not read the
   * page's CSS variables — so the app's three-state theme has to be resolved
   * to a boolean here, and re-resolved when either the explicit choice or the
   * system preference changes.
   */
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const resolve = () => {
      const chosen = document.documentElement.getAttribute("data-theme");
      setDark(chosen === "dark" || (chosen !== "light" && media.matches));
    };

    resolve();
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    media.addEventListener("change", resolve);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", resolve);
    };
  }, []);

  return (
    <div className="text-ink flex h-full flex-col overflow-hidden">
      <header className="border-rule bg-surface flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <h1 className="text-ink text-ui font-medium">LaTeX studio — spike</h1>

        <div className="flex items-center gap-3">
          {/* Announced, not merely displayed: a compile can take fifteen
              seconds on a cold start and the only feedback used to be a
              disabled button. */}
          <span aria-live="polite" className="text-muted text-fine">
            {busy ? (step ?? "Working") : outcome ? describe(outcome.status) : "Ready"}
          </span>
          <Button
            variant="ghost"
            className="border-border border"
            onClick={() => setShowPackages((v) => !v)}
            aria-expanded={showPackages}
          >
            Packages
          </Button>
          <Button
            onClick={() => compile({ [ENTRY]: source }, ENTRY, packagesToken)}
            disabled={busy}
            variant="primary"
          >
            {busy ? "Compiling…" : "Compile"}
          </Button>
        </div>
      </header>

      {showPackages && (
        <div className="border-rule bg-surface shrink-0 border-b px-4 py-3">
          <h2 className="text-ink text-ui mb-2 font-medium">Packages in this browser</h2>
          <PackageManager onChange={setPackagesToken} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          aria-label="LaTeX source"
          className="border-rule flex min-h-0 flex-1 flex-col border-b lg:border-r lg:border-b-0"
        >
          <p className="border-rule bg-surface text-muted text-fine shrink-0 border-b px-4 py-1.5 font-mono">
            {ENTRY}
          </p>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CodeMirror
              value={source}
              height="100%"
              theme={dark ? githubDark : githubLight}
              extensions={[StreamLanguage.define(stex)]}
              onChange={setSource}
              onCreateEditor={(view) => {
                editor.current = view;
              }}
              className="h-full"
              basicSetup={{ lineNumbers: true, foldGutter: true }}
            />
          </div>
        </section>

        <section
          aria-label="PDF preview"
          className="bg-surface flex min-h-0 flex-1 flex-col"
        >
          <p className="border-rule bg-surface text-muted text-fine shrink-0 border-b px-4 py-1.5">
            Preview
          </p>
          <div className="min-h-0 flex-1 p-4">
            {outcome?.pdfUrl ? (
              <iframe
                // Titled, because an untitled frame is an unlabelled landmark
                // and a screen reader announces it as "frame".
                title="Compiled PDF"
                src={outcome.pdfUrl}
                className="border-border bg-raised mx-auto h-full w-full max-w-[850px] border"
              />
            ) : (
              <p className="text-muted text-ui flex h-full items-center justify-center">
                {busy ? (step ?? "Compiling…") : "No PDF yet. Press Compile."}
              </p>
            )}
          </div>
        </section>
      </div>

      <CompilerPanel
        outcome={outcome}
        error={error}
        entry={ENTRY}
        onGoToLine={goToLine}
      />
    </div>
  );
}

/** The engine's four outcomes, in words. `errors` still produces a PDF. */
function describe(status: string): string {
  switch (status) {
    case "spotless":
      return "Compiled cleanly";
    case "warnings":
      return "Compiled with warnings";
    case "errors":
      return "Compiled — TeX reported errors but produced a PDF";
    case "failed":
      return "Failed — no PDF";
    default:
      return status;
  }
}
