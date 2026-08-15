/**
 * The LaTeX a completion list needs to know about.
 *
 * Curated rather than generated. A list scraped from a TeX distribution runs
 * to tens of thousands of control sequences, most of them internal, and
 * offering `\@makeother` alongside `\section` makes the useful ones harder to
 * reach — the point of a completion list is that the first few entries are
 * usually right.
 *
 * `snippet` uses CodeMirror's template syntax: `#{name}` marks a field the
 * cursor stops at, so `\frac` lands you in the numerator and Tab moves on.
 */

export interface Command {
  label: string;
  /** Shown to the right; says what it does in three or four words. */
  detail?: string;
  snippet?: string;
  /** Ordered within its group; lower sorts first. */
  boost?: number;
}

export const COMMANDS: readonly Command[] = [
  // ── Structure ────────────────────────────────────────────────────────────
  {
    label: "\\section",
    detail: "numbered section",
    snippet: "\\section{#{title}}",
    boost: 9,
  },
  {
    label: "\\subsection",
    detail: "subsection",
    snippet: "\\subsection{#{title}}",
    boost: 8,
  },
  { label: "\\subsubsection", snippet: "\\subsubsection{#{title}}" },
  { label: "\\paragraph", snippet: "\\paragraph{#{title}}" },
  { label: "\\chapter", detail: "book/report only", snippet: "\\chapter{#{title}}" },
  { label: "\\part", snippet: "\\part{#{title}}" },
  { label: "\\appendix" },
  { label: "\\tableofcontents" },
  { label: "\\listoffigures" },
  { label: "\\listoftables" },

  // ── Preamble ─────────────────────────────────────────────────────────────
  {
    label: "\\documentclass",
    detail: "required, once",
    snippet: "\\documentclass{#{article}}",
    boost: 7,
  },
  {
    label: "\\usepackage",
    detail: "load a package",
    snippet: "\\usepackage{#{name}}",
    boost: 9,
  },
  { label: "\\title", snippet: "\\title{#{title}}" },
  { label: "\\author", snippet: "\\author{#{name}}" },
  { label: "\\date", snippet: "\\date{#{\\today}}" },
  { label: "\\maketitle" },
  { label: "\\newcommand", snippet: "\\newcommand{\\#{name}}[#{0}]{#{body}}" },
  { label: "\\renewcommand", snippet: "\\renewcommand{\\#{name}}{#{body}}" },
  { label: "\\newenvironment", snippet: "\\newenvironment{#{name}}{#{begin}}{#{end}}" },
  { label: "\\setlength", snippet: "\\setlength{\\#{parskip}}{#{1em}}" },

  // ── Text ─────────────────────────────────────────────────────────────────
  { label: "\\textbf", detail: "bold", snippet: "\\textbf{#{text}}", boost: 9 },
  { label: "\\textit", detail: "italic", snippet: "\\textit{#{text}}", boost: 9 },
  { label: "\\texttt", detail: "monospace", snippet: "\\texttt{#{text}}" },
  { label: "\\emph", detail: "emphasis", snippet: "\\emph{#{text}}", boost: 8 },
  { label: "\\underline", snippet: "\\underline{#{text}}" },
  { label: "\\footnote", snippet: "\\footnote{#{text}}", boost: 7 },
  { label: "\\textsc", detail: "small caps", snippet: "\\textsc{#{text}}" },
  { label: "\\newpage" },
  { label: "\\clearpage" },
  { label: "\\noindent" },
  { label: "\\centering" },

  // ── References and citations ─────────────────────────────────────────────
  { label: "\\label", snippet: "\\label{#{key}}", boost: 8 },
  { label: "\\ref", snippet: "\\ref{#{key}}", boost: 8 },
  { label: "\\eqref", detail: "equation reference", snippet: "\\eqref{#{key}}" },
  { label: "\\pageref", snippet: "\\pageref{#{key}}" },
  { label: "\\cite", detail: "citation", snippet: "\\cite{#{key}}", boost: 8 },
  { label: "\\citep", detail: "natbib parenthetical", snippet: "\\citep{#{key}}" },
  { label: "\\citet", detail: "natbib textual", snippet: "\\citet{#{key}}" },
  { label: "\\bibliography", snippet: "\\bibliography{#{refs}}" },
  { label: "\\bibliographystyle", snippet: "\\bibliographystyle{#{plain}}" },
  { label: "\\printbibliography", detail: "biblatex" },
  { label: "\\url", snippet: "\\url{#{https://}}" },
  { label: "\\href", snippet: "\\href{#{url}}{#{text}}" },

  // ── Mathematics ──────────────────────────────────────────────────────────
  { label: "\\frac", snippet: "\\frac{#{a}}{#{b}}", boost: 9 },
  { label: "\\sqrt", snippet: "\\sqrt{#{x}}", boost: 7 },
  { label: "\\sum", snippet: "\\sum_{#{i=1}}^{#{n}}", boost: 7 },
  { label: "\\int", snippet: "\\int_{#{a}}^{#{b}}" },
  { label: "\\prod", snippet: "\\prod_{#{i=1}}^{#{n}}" },
  { label: "\\lim", snippet: "\\lim_{#{n \\to \\infty}}" },
  { label: "\\mathbb", detail: "blackboard bold", snippet: "\\mathbb{#{R}}" },
  { label: "\\mathcal", detail: "calligraphic", snippet: "\\mathcal{#{L}}" },
  { label: "\\mathbf", snippet: "\\mathbf{#{x}}" },
  { label: "\\text", detail: "text inside math", snippet: "\\text{#{words}}" },
  { label: "\\left" },
  { label: "\\right" },
  { label: "\\cdot" },
  { label: "\\times" },
  { label: "\\leq" },
  { label: "\\geq" },
  { label: "\\neq" },
  { label: "\\approx" },
  { label: "\\alpha" },
  { label: "\\beta" },
  { label: "\\gamma" },
  { label: "\\delta" },
  { label: "\\theta" },
  { label: "\\lambda" },
  { label: "\\mu" },
  { label: "\\pi" },
  { label: "\\sigma" },
  { label: "\\phi" },
  { label: "\\omega" },
  { label: "\\Delta" },
  { label: "\\Omega" },
  { label: "\\infty" },
  { label: "\\partial" },
  { label: "\\nabla" },

  // ── Figures, tables, code ────────────────────────────────────────────────
  {
    label: "\\includegraphics",
    detail: "needs graphicx",
    snippet: "\\includegraphics[width=#{0.8}\\textwidth]{#{file}}",
    boost: 7,
  },
  { label: "\\caption", snippet: "\\caption{#{text}}", boost: 7 },
  { label: "\\hline" },
  { label: "\\toprule", detail: "booktabs" },
  { label: "\\midrule", detail: "booktabs" },
  { label: "\\bottomrule", detail: "booktabs" },
  { label: "\\item", boost: 8 },
  { label: "\\input", snippet: "\\input{#{file}}" },
  { label: "\\include", snippet: "\\include{#{file}}" },
];

/** Environments, with what a fresh one should contain. */
export interface Environment {
  label: string;
  detail?: string;
  /** Lines placed between `\begin` and `\end`. */
  body?: string;
  boost?: number;
}

export const ENVIRONMENTS: readonly Environment[] = [
  { label: "document", detail: "the whole document", boost: 9 },
  { label: "itemize", detail: "bulleted list", body: "\\item #{}", boost: 9 },
  { label: "enumerate", detail: "numbered list", body: "\\item #{}", boost: 9 },
  { label: "description", body: "\\item[#{term}] #{}" },
  {
    label: "figure",
    detail: "floating figure",
    body: "\\centering\n\\includegraphics[width=0.8\\textwidth]{#{file}}\n\\caption{#{caption}}\n\\label{fig:#{key}}",
    boost: 8,
  },
  {
    label: "table",
    detail: "floating table",
    body: "\\centering\n\\caption{#{caption}}\n\\label{tab:#{key}}",
    boost: 8,
  },
  { label: "tabular", detail: "the grid itself", body: "#{c c c}" },
  { label: "equation", detail: "numbered display maths", body: "#{}", boost: 8 },
  { label: "equation*", detail: "unnumbered", body: "#{}" },
  { label: "align", detail: "aligned equations", body: "#{}", boost: 7 },
  { label: "align*", body: "#{}" },
  { label: "abstract", boost: 7 },
  { label: "quote" },
  { label: "quotation" },
  { label: "verbatim", detail: "literal text" },
  { label: "lstlisting", detail: "code, needs listings" },
  { label: "center" },
  { label: "flushleft" },
  { label: "flushright" },
  { label: "minipage", body: "#{}" },
  { label: "thebibliography", body: "\\bibitem{#{key}} #{}" },
  { label: "tikzpicture", detail: "needs tikz" },
  { label: "frame", detail: "beamer slide", body: "\\frametitle{#{title}}\n#{}" },
  { label: "theorem", detail: "needs amsthm" },
  { label: "proof", detail: "needs amsthm" },
];

/** Packages worth suggesting inside `\usepackage{}`. */
export const PACKAGES: readonly { label: string; detail?: string }[] = [
  { label: "amsmath", detail: "maths environments" },
  { label: "amssymb", detail: "maths symbols" },
  { label: "amsthm", detail: "theorems and proofs" },
  { label: "graphicx", detail: "\\includegraphics" },
  { label: "booktabs", detail: "decent table rules" },
  { label: "hyperref", detail: "links and PDF metadata" },
  { label: "geometry", detail: "page margins" },
  { label: "natbib", detail: "citations — shipped" },
  { label: "biblatex", detail: "citations — upload required" },
  { label: "listings", detail: "source code" },
  { label: "tikz", detail: "diagrams" },
  { label: "pgfplots", detail: "plots" },
  { label: "xcolor", detail: "colour" },
  { label: "caption", detail: "caption formatting" },
  { label: "subcaption", detail: "sub-figures" },
  { label: "microtype", detail: "better justification" },
  { label: "babel", detail: "languages" },
  { label: "csquotes", detail: "quotation marks" },
  { label: "siunitx", detail: "units" },
  { label: "multirow", detail: "spanning table cells" },
  { label: "longtable", detail: "tables across pages" },
  { label: "enumitem", detail: "list formatting" },
  { label: "fancyhdr", detail: "headers and footers" },
  { label: "setspace", detail: "line spacing" },
];

export const DOCUMENT_CLASSES: readonly { label: string; detail?: string }[] = [
  { label: "article", detail: "papers, short reports" },
  { label: "report", detail: "chapters, no parts" },
  { label: "book", detail: "chapters and parts" },
  { label: "beamer", detail: "slides" },
  { label: "letter" },
  { label: "memoir" },
  { label: "standalone", detail: "a single figure" },
];

/** TikZ libraries, for `\usetikzlibrary{}`. */
export const TIKZ_LIBRARIES: readonly string[] = [
  "arrows.meta",
  "shapes.geometric",
  "shapes.misc",
  "positioning",
  "calc",
  "fit",
  "backgrounds",
  "decorations.pathreplacing",
  "patterns",
  "matrix",
  "trees",
  "automata",
  "intersections",
  "through",
];
