"use client";

import { useMemo, useState } from "react";

import type { Problem } from "@/lib/latex/analyse";
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
  checks,
  entry,
  onGoToLine,
}: {
  outcome: CompileOutcome | null;
  error: string | null;
  /**
   * Found by reading the source, not by compiling it.
   *
   * These are live: an unclosed `\begin` is reported while it is being typed,
   * rather than after a compile that fails with a message pointing at the end
   * of the file. Shown in the same place as everything else the compiler says,
   * because "what is wrong with my document" is one question.
   */
  checks: Problem[];
  /** The root document, so its own auxiliaries can be recognised as noise. */
  entry: string;
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
     * The preflight scan counts only when TeX could not finish.
     *
     * Its whole purpose is to save round trips when the engine aborts at the
     * first missing file. If a PDF came out, then every package the document
     * actually needed was found, and whatever the scan turned up is a guess
     * the compile has already disproved — a conditional branch, a
     * documentation driver, something behind an `\ifdefined`. Reporting those
     * anyway put thirty names in a red box on every successful compile.
     */
    if (outcome?.status === "failed") {
      for (const name of outcome.preflight) {
        if (!fatal.includes(name)) fatal.push(name);
      }
    }

    /*
     * Collapse the probing.
     *
     * TeX hunts. When it cannot find `biblatex.sty` it tries `.sty.tex`,
     * `.sty.sty`, `.sty.def` and half a dozen more; for a font it tries
     * `.pfb`, `.ttf`, `.TTC`, `.dfont` and the rest; and on the first pass it
     * asks for its own `.aux`, which by definition does not exist yet. A CLEAN
     * compile of a two-line document produced forty of these, not one of them
     * a problem.
     *
     * So: reduce each to a root, drop the job's own auxiliaries, drop anything
     * already named as fatal, and show what is left.
     */
    const jobname = entry.replace(/\.[^.]+$/, "");
    const roots = new Set<string>();

    for (const name of rest) {
      const root = probeRoot(name);
      if (fatal.some((f) => root === probeRoot(f))) continue;
      if (root === jobname || root.startsWith(`${jobname}.`)) continue;
      roots.add(root);
    }

    return { fatal, probed: [...roots] };
  }, [outcome, diagnostics, entry]);

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;
  const checkErrors = checks.filter((c) => c.severity === "error").length;
  const problemCount = errorCount + fatal.length + checkErrors + (error ? 1 : 0);

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
              checks={checks}
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
  checks,
  diagnostics,
  message,
  onGoToLine,
}: {
  error: string | null;
  fatal: string[];
  probed: string[];
  checks: Problem[];
  diagnostics: CompileOutcome["diagnostics"];
  message: string | null;
  onGoToLine: (line: number) => void;
}) {
  if (
    !error &&
    !message &&
    fatal.length === 0 &&
    checks.length === 0 &&
    diagnostics.length === 0
  ) {
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
          <strong>Failed:</strong> {explain(message)}
        </li>
      )}

      {fatal.length > 0 && (
        <li className="border-danger/40 bg-danger-soft/40 rounded border p-2">
          <p className="text-danger font-medium">
            {/* Named as PACKAGES, not filenames — "biblatex.sty" is what the
                engine reports, "the biblatex package" is what the reader has
                in their preamble — and linked, because the next thing anyone
                does is go and look for it. */}
            Not in this TeX distribution:{" "}
            {fatal.map((file, i) => {
              const pkg = packageName(file);
              const asker = requiredBy(file, diagnostics);
              return (
                <span key={file}>
                  {i > 0 && ", "}
                  <a
                    href={`https://ctan.org/pkg/${encodeURIComponent(pkg)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    {pkg}
                  </a>
                  {/* Which package asked. A dependency you have never heard of
                      is baffling on its own; "required by biblatex" makes it
                      obviously the next link in a chain rather than a mystery. */}
                  {asker && <span className="text-muted"> (required by {asker})</span>}
                </span>
              );
            })}
          </p>
          <p className="text-muted mt-1">
            Download {fatal.length === 1 ? "it" : "them"} from CTAN and drop the archive
            into <strong className="text-ink">Packages</strong>, or remove the{" "}
            <code className="font-mono">\usepackage</code> line.{" "}
            {/* Said once, plainly, because otherwise this looks like an endless
                game: LaTeX packages depend on other packages, TeX stops at the
                first one it cannot find, and you learn about the next only
                after supplying this one. */}
            LaTeX packages depend on other packages, and TeX reports only the first one
            missing — so expect another round or two. Several archives can be dropped in
            at once.
          </p>
        </li>
      )}

      {/* First, because they are found without compiling and are usually the
          reason the compile is about to fail. */}
      {checks.map((check, i) => (
        <li key={`check-${check.file}-${check.line}-${i}`} className="flex gap-2">
          <span
            className={cx(
              "shrink-0 font-mono",
              check.severity === "error" ? "text-danger" : "text-muted",
            )}
          >
            {check.severity}
          </span>
          <button
            type="button"
            onClick={() => onGoToLine(check.line)}
            className="text-accent focus-visible:ring-accent shrink-0 rounded font-mono underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {check.file}:{check.line}
          </button>
          <span className="text-ink-soft min-w-0">{check.message}</span>
        </li>
      ))}

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
          TeX also looked for {probed.slice(0, 6).join(", ")}
          {probed.length > 6 && ` and ${probed.length - 6} more`} and managed without.
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

/**
 * Strip the extensions TeX appends while hunting, down to one root.
 *
 * `lmroman10-bold.TTC`, `.pfb`, `.dfont` and `lmroman10-bold` are one font
 * asked for eight ways; `biblatex.sty.tex` and `biblatex.sty` are one package.
 */
function probeRoot(name: string): string {
  let root = name.split(/[:/]/)[0] ?? name;
  // Repeatedly, because the hunt stacks them: `biblatex.sty.tex`.
  for (let i = 0; i < 3; i++) {
    const next = root.replace(
      /\.(sty|cls|def|cfg|clo|ldf|fd|tex|bst|bbx|cbx|lbx|enc|map|tfm|vf|pfa|pfb|otf|ttf|ttc|TTC|TTF|dfont|aux|bbl|toc|out)$/,
      "",
    );
    if (next === root) break;
    root = next;
  }
  return root;
}

/** `biblatex.sty` → `biblatex`; tikz library files → the library's name. */
function packageName(file: string): string {
  const tikz = /^tikzlibrary(.+)\.code\.tex$/.exec(file);
  if (tikz) return `tikz library ${tikz[1]}`;
  return file.replace(/\.(sty|cls|def|code\.tex|tex)$/, "");
}

/**
 * Turn the engine's failure message into something true and useful.
 *
 * "terminal input forbidden" is accurate and unhelpful: it means TeX stopped
 * to ASK A QUESTION and there was nobody to answer. In practice that question
 * is almost always "I cannot find this file, what should I use instead?" —
 * which is a missing package, already named above, and not a mysterious
 * engine fault.
 */
function explain(message: string): string {
  if (/terminal input forbidden/i.test(message)) {
    return (
      "TeX stopped to ask a question and there is no terminal to answer it — " +
      "which almost always means a file it could not find. See the missing " +
      "packages above."
    );
  }
  return message;
}

/** Which file was being read when TeX could not find this one. */
function requiredBy(
  missing: string,
  diagnostics: CompileOutcome["diagnostics"],
): string | null {
  const source = diagnostics.find(
    (d) => d.severity === "error" && d.message.includes(missing) && d.file,
  );
  if (!source?.file) return null;

  const asker = packageName(source.file);
  return asker === packageName(missing) ? null : asker;
}

function rank(severity: string): number {
  return severity === "error" ? 0 : severity === "warning" ? 1 : 2;
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
