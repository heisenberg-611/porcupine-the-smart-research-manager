"use client";

import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { useCompiler } from "@/lib/latex/use-compiler";

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

  const diagnostics = outcome?.diagnostics ?? [];

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
            onClick={() => compile({ [ENTRY]: source }, ENTRY)}
            disabled={busy}
            variant="primary"
          >
            {busy ? "Compiling…" : "Compile"}
          </Button>
        </div>
      </header>

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

      {(error || diagnostics.length > 0 || outcome?.unsupported.length) && (
        <section
          aria-label="Compiler output"
          className="border-rule bg-surface flex h-48 shrink-0 flex-col border-t"
        >
          <h2 className="border-rule text-ink text-fine shrink-0 border-b px-4 py-1.5 font-medium">
            Compiler output
          </h2>
          <div className="text-fine min-h-0 flex-1 overflow-auto px-4 py-2 font-mono">
            {error && <p className="text-danger">{error}</p>}

            {/* Named packages, not "compilation failed". The engine reports
                what it could not find; saying so is the difference between a
                fixable problem and a dead end. */}
            {outcome?.unsupported.map((name) => (
              <p key={name} className="text-danger">
                No installed package provides {name}.
              </p>
            ))}

            {diagnostics.map((d, i) => (
              <p
                key={`${d.message}-${i}`}
                className={d.severity === "error" ? "text-danger" : "text-muted"}
              >
                {d.severity}
                {d.line ? ` (line ${d.line})` : ""}: {d.message}
              </p>
            ))}
          </div>
        </section>
      )}
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
