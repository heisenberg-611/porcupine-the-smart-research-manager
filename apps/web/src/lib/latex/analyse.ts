/**
 * What can be known about a document without compiling it.
 *
 * Labels, section structure, a word count, and the mistakes that do not need
 * TeX to find. The plan calls these "suggestions without AI", and the point is
 * that every one of them is deterministic and local: the same document always
 * gives the same answers, and nothing leaves the browser to get them.
 *
 * Scanned with regular expressions rather than a grammar. That is a real
 * limit — a `\section` inside a verbatim block will be counted — and it is the
 * right trade until there is a Lezer LaTeX grammar to parse with. The plan
 * says as much: do not block on the grammar.
 */

/** Comments are stripped before anything else looks at the text. */
export function stripComments(source: string): string {
  return source.replace(/(^|[^\\])%.*$/gm, "$1");
}

export interface Label {
  key: string;
  file: string;
  line: number;
  /** The nearest preceding sectioning command, as context in a list. */
  context: string;
}

const LABEL = /\\label\s*\{([^}]+)\}/g;
const REFERENCE = /\\(?:page|eq|auto|c|C)?ref\s*\{([^}]+)\}/g;
const SECTION =
  /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*\{([^}]*)\}/g;

export interface Outline {
  level: number;
  title: string;
  file: string;
  line: number;
}

const DEPTH: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
};

/** Every `\label` in the project, with where it is and what it sits under. */
export function collectLabels(files: Map<string, string>): Label[] {
  const labels: Label[] = [];

  for (const [file, source] of files) {
    const clean = stripComments(source);
    const lines = clean.split("\n");
    let context = "";

    lines.forEach((text, index) => {
      const section = new RegExp(SECTION.source).exec(text);
      if (section?.[2]) context = section[2];

      for (const match of text.matchAll(new RegExp(LABEL.source, "g"))) {
        if (match[1]) {
          labels.push({ key: match[1], file, line: index + 1, context });
        }
      }
    });
  }

  return labels;
}

export function collectOutline(source: string, file: string): Outline[] {
  const clean = stripComments(source);
  const out: Outline[] = [];

  clean.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(new RegExp(SECTION.source, "g"))) {
      const kind = match[1];
      if (!kind) continue;
      out.push({
        level: DEPTH[kind] ?? 5,
        title: (match[2] ?? "").trim() || "(untitled)",
        file,
        line: index + 1,
      });
    }
  });

  return out;
}

/**
 * Words, excluding the markup.
 *
 * A LaTeX file's character count is not its word count and nobody has ever
 * wanted it to be: `\includegraphics[width=0.8\textwidth]{fig/plot.pdf}` is
 * zero words. Commands, their bracketed options, maths, and whole verbatim
 * environments come out; the braced ARGUMENTS of sectioning commands stay,
 * because a chapter title is words a supervisor counts.
 *
 * It will not agree with `texcount` to the word. It is close enough to answer
 * "am I near the limit", which is the only question anyone asks it.
 */
export function countWords(source: string): number {
  let text = stripComments(source);

  // Whole environments whose contents are not prose.
  text = text.replace(
    /\\begin\{(verbatim|lstlisting|minted|tikzpicture|equation\*?|align\*?|tabular)\}[\s\S]*?\\end\{\1\}/g,
    " ",
  );
  // Display and inline maths.
  text = text.replace(/\$\$[\s\S]*?\$\$/g, " ").replace(/\$[^$]*\$/g, " ");
  // Sectioning and text-formatting commands keep their argument.
  text = text.replace(
    /\\(?:part|chapter|section|subsection|subsubsection|paragraph|textbf|textit|emph|texttt|underline)\*?\s*\{([^}]*)\}/g,
    " $1 ",
  );
  // Everything else: the command, its options, and its braced arguments go.
  text = text.replace(/\\[a-zA-Z@]+\*?(\s*\[[^\]]*\])*(\s*\{[^}]*\})*/g, " ");
  text = text.replace(/[{}\\~^_&]/g, " ");

  return text.split(/\s+/).filter((word) => /[a-zA-Z0-9]/.test(word)).length;
}

export interface Problem {
  severity: "error" | "warning";
  file: string;
  line: number;
  message: string;
}

/**
 * The mistakes that do not need a compile.
 *
 * Every one of these is something TeX will eventually complain about, usually
 * with a message pointing somewhere other than the cause — an unmatched
 * `\begin` is reported at the end of the file, and a misspelt `\ref` produces
 * a `??` in the PDF and a warning most people never read. Finding them here
 * costs nothing and says where they are.
 */
export function lint(files: Map<string, string>): Problem[] {
  const problems: Problem[] = [];
  const labels = collectLabels(files);
  const defined = new Set(labels.map((l) => l.key));
  const used = new Set<string>();

  // A label defined twice makes every reference to it point at whichever came
  // last, silently.
  const seen = new Map<string, Label>();
  for (const label of labels) {
    const first = seen.get(label.key);
    if (first) {
      problems.push({
        severity: "warning",
        file: label.file,
        line: label.line,
        message: `Label "${label.key}" is already defined in ${first.file} line ${first.line}.`,
      });
    } else {
      seen.set(label.key, label);
    }
  }

  for (const [file, source] of files) {
    const clean = stripComments(source);
    const lines = clean.split("\n");

    /** Open environments, so the report names the one that never closed. */
    const stack: { name: string; line: number }[] = [];
    let braces = 0;

    lines.forEach((text, index) => {
      const line = index + 1;

      for (const match of text.matchAll(/\\begin\s*\{([^}]+)\}/g)) {
        stack.push({ name: match[1] ?? "", line });
      }

      for (const match of text.matchAll(/\\end\s*\{([^}]+)\}/g)) {
        const name = match[1] ?? "";
        const open = stack.pop();
        if (!open) {
          problems.push({
            severity: "error",
            file,
            line,
            message: `\\end{${name}} with no matching \\begin.`,
          });
        } else if (open.name !== name) {
          problems.push({
            severity: "error",
            file,
            line,
            message: `\\end{${name}} closes \\begin{${open.name}} from line ${open.line}.`,
          });
        }
      }

      for (const match of text.matchAll(new RegExp(REFERENCE.source, "g"))) {
        const key = match[1];
        if (!key) continue;
        used.add(key);
        if (!defined.has(key)) {
          problems.push({
            severity: "warning",
            file,
            line,
            message: `\\ref{${key}} has no matching \\label anywhere in the project.`,
          });
        }
      }

      // Escaped braces do not count, and neither does anything in maths —
      // close enough without a parser, and it catches the real case, which is
      // a `{` typed and never closed.
      const bare = text.replace(/\\[{}]/g, "");
      braces += (bare.match(/\{/g)?.length ?? 0) - (bare.match(/\}/g)?.length ?? 0);
    });

    for (const open of stack) {
      problems.push({
        severity: "error",
        file,
        line: open.line,
        message: `\\begin{${open.name}} is never closed.`,
      });
    }

    if (braces !== 0) {
      problems.push({
        severity: "warning",
        file,
        line: lines.length,
        message:
          braces > 0
            ? `${braces} unclosed ${braces === 1 ? "brace" : "braces"} in this file.`
            : `${-braces} closing ${braces === -1 ? "brace" : "braces"} too many in this file.`,
      });
    }
  }

  // Reported last and only as information: an unused label is not a mistake,
  // it is usually a section someone is about to reference.
  for (const label of labels) {
    if (!used.has(label.key)) {
      problems.push({
        severity: "warning",
        file: label.file,
        line: label.line,
        message: `Label "${label.key}" is never referenced.`,
      });
    }
  }

  return problems;
}
