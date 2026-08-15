"use client";

import { useMemo, useState } from "react";

import type { CompileOutcome } from "@/lib/latex/use-compiler";

/**
 * What the compiler said.
 *
 * Two views, because they answer different questions. **Problems** is the
 * parsed list — what went wrong, where, and which package said so — and is
 * what you want ninety-five percent of the time. **Log** is the raw
 * `<jobname>.log`, because TeX's log is the ground truth and every LaTeX user
 * eventually needs to read it: the parser only surfaces what it recognises,
 * and the one line explaining a strange result is often not one of them.
 *
 * The panel is always available, including on success. A compile that reports
 * "spotless" and offers nothing to inspect gives you no way to check WHY it
 * was spotless — or to see the warnings TeX considered beneath mentioning.
 */
export function CompilerPanel({
  outcome,
  error,
  onGoToLine,
}: {
  outcome: CompileOutcome | null;
  error: string | null;
  /** Jump the editor to a line. Undefined when the diagnostic has no line. */
  onGoToLine: (line: number) => void;
}) {
  const [tab, setTab] = useState<"problems" | "log">("problems");
  const [open, setOpen] = useState(true);

  const diagnostics = useMemo(
    () =>
      [...(outcome?.diagnostics ?? [])].sort(
        (a, b) => rank(a.severity) - rank(b.severity),
      ),
    [outcome],
  );

  /*
   * Which missing files TeX actually complained about.
   *
   * The engine reports every file it asked for and did not get, and TeX asks
   * for a great many it copes without — `lstmisc0.sty` is a probe, not a
   * problem. Listing all of them as failures buries the one that matters
   * (`biblatex.sty`, say) among noise the user cannot act on.
   *
   * So: a missing file is a FAILURE if an error diagnostic names it, and a
   * note otherwise.
   */
  const { fatal, probed } = useMemo(() => {
    const errors = diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => d.message)
      .join("\n");

    const fatal: string[] = [];
    const rest: string[] = [];
    for (const name of outcome?.unsupported ?? []) {
      (errors.includes(name) ? fatal : rest).push(name);
    }

    /*
     * Drop the extension probing.
     *
     * When TeX cannot find `biblatex.sty` it tries `biblatex.sty.tex`,
     * `.sty.sty`, `.sty.def`, `.sty.cls` and half a dozen more before giving
     * up — every one of which comes back as a missing file. Reported plainly
     * that is ten lines about one absent package, and the reader has to work
     * out that nine of them are the same problem.
     */
    const probed = rest.filter((name) => !fatal.some((f) => name.startsWith(`${f}.`)));

    return { fatal, probed };
  }, [outcome, diagnostics]);

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const problemCount = errorCount + fatal.length + (error ? 1 : 0);

  return (
    <section
      aria-label="Compiler output"
      className="border-rule bg-surface flex shrink-0 flex-col border-t"
    >
      <div className="border-rule flex items-center gap-1 border-b px-2">
        <Tab
          active={open && tab === "problems"}
          onClick={() => (setTab("problems"), setOpen(true))}
        >
          Problems
          {problemCount > 0 && (
            <span className="bg-danger-soft text-danger ml-1.5 rounded-full px-1.5">
              {problemCount}
            </span>
          )}
          {problemCount === 0 && warningCount > 0 && (
            <span className="text-muted ml-1.5">{warningCount} warnings</span>
          )}
        </Tab>
        <Tab
          active={open && tab === "log"}
          onClick={() => (setTab("log"), setOpen(true))}
        >
          Log
        </Tab>

        <div className="flex-1" />

        {outcome && (
          <span className="text-muted text-fine px-2">
            {outcome.passesRun} {outcome.passesRun === 1 ? "pass" : "passes"}
          </span>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-muted hover:text-ink focus-visible:ring-accent text-fine min-h-9 rounded px-2 focus-visible:ring-2 focus-visible:outline-none"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <div className="text-fine h-56 overflow-auto px-3 py-2">
          {tab === "problems" ? (
            <ProblemList
              error={error}
              fatal={fatal}
              probed={probed}
              diagnostics={diagnostics}
              message={outcome?.message ?? null}
              onGoToLine={onGoToLine}
            />
          ) : outcome?.log ? (
            // The whole log, unedited. `whitespace-pre` rather than pre-wrap:
            // TeX wraps its own log at 79 columns and re-wrapping it again
            // makes the column-aligned parts unreadable.
            <pre className="text-ink-soft w-max font-mono leading-relaxed">
              {outcome.log}
            </pre>
          ) : (
            <p className="text-muted">No log yet. Compile to produce one.</p>
          )}
        </div>
      )}
    </section>
  );
}

function ProblemList({
  error,
  fatal,
  probed,
  diagnostics,
  message,
  onGoToLine,
}: {
  error: string | null;
  fatal: string[];
  probed: string[];
  diagnostics: CompileOutcome["diagnostics"];
  message: string | null;
  onGoToLine: (line: number) => void;
}) {
  if (!error && !message && fatal.length === 0 && diagnostics.length === 0) {
    return <p className="text-muted">Nothing to report.</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {error && (
        <li className="text-danger">
          <strong>Compiler:</strong> {error}
        </li>
      )}

      {message && (
        <li className="text-danger">
          <strong>Failed:</strong> {message}
        </li>
      )}

      {fatal.length > 0 && (
        <li className="border-danger/40 bg-danger-soft/40 rounded border p-2">
          <p className="text-danger font-medium">
            {/* Named as PACKAGES, not filenames. "biblatex.sty" is what the
                engine reports; "the biblatex package" is what the person is
                looking for in their preamble. */}
            Not in this TeX distribution: {fatal.map(packageName).join(", ")}
          </p>
          <p className="text-muted mt-1">
            The document cannot be typeset without {fatal.length === 1 ? "it" : "them"}.
            Remove the <code className="font-mono">\usepackage</code> line, or use one of
            the packages this distribution does ship.
          </p>
        </li>
      )}

      {diagnostics.map((d, i) => (
        <li key={`${d.message}-${i}`} className="flex gap-2">
          <span
            className={`shrink-0 font-mono ${
              d.severity === "error" ? "text-danger" : "text-muted"
            }`}
          >
            {d.severity}
          </span>

          {d.line ? (
            <button
              type="button"
              onClick={() => onGoToLine(d.line!)}
              className="text-accent focus-visible:ring-accent shrink-0 rounded font-mono underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {d.file ? `${d.file}:${d.line}` : `line ${d.line}`}
            </button>
          ) : (
            d.file && <span className="text-muted shrink-0 font-mono">{d.file}</span>
          )}

          <span className="text-ink-soft min-w-0">
            {d.message}
            {d.package && <span className="text-muted"> ({d.package})</span>}
          </span>
        </li>
      ))}

      {probed.length > 0 && (
        <li className="text-muted border-rule mt-1 border-t pt-1.5">
          {/* Kept, but out of the way. These are files TeX looked for and
              carried on without; showing them as errors sends people hunting
              for a problem that is not there. */}
          Also absent, and not needed: {probed.join(", ")}.
        </li>
      )}
    </ul>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-fine focus-visible:ring-accent -mb-px inline-flex min-h-9 items-center border-b-2 px-3 focus-visible:ring-2 focus-visible:outline-none ${
        active ? "border-accent text-ink" : "text-muted hover:text-ink border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

/** `biblatex.sty` → `biblatex`; tikz library files → the library's name. */
function packageName(file: string): string {
  const tikz = /^tikzlibrary(.+)\.code\.tex$/.exec(file);
  if (tikz) return `tikz library ${tikz[1]}`;
  return file.replace(/\.(sty|cls|def|code\.tex|tex)$/, "");
}

function rank(severity: string): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}
