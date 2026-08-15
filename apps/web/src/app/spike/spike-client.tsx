"use client";

import { autocompletion } from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { KeyBinding } from "@codemirror/view";

import { Button } from "@/components/ui";
import { collectLabels, collectOutline, countWords, lint } from "@/lib/latex/analyse";
import {
  closeEnvironmentOnBrace,
  makeLatexCompletions,
} from "@/lib/latex/editor-support";
import { useCompiler } from "@/lib/latex/use-compiler";

import {
  DEFAULT_ENTRY,
  deleteFile,
  loadProject,
  renameFile,
  saveFile,
  setEntry as persistEntry,
  type ProjectFiles,
} from "@/lib/latex/project-store";

import { CompilerPanel } from "./compiler-panel";
import { FileTree } from "./file-tree";
import { PackageManager } from "./package-manager";

/**
 * Compile from the keyboard.
 *
 * Overleaf uses Ctrl/Cmd-Enter and so does everything else that compiles
 * something; reaching for the mouse after every edit is what makes a
 * compile-preview loop feel slow even when the compile is fast.
 */
const COMPILE_KEY: KeyBinding = {
  key: "Mod-Enter",
  run: () => {
    compileFromKeyboard();
    return true;
  },
  preventDefault: true,
};

const SPLIT_KEY = "porcupine.latex.split";
const FONT_KEY = "porcupine.latex.fontsize";
/** Below 10px nothing is legible; above 24 the editor holds three words. */
const MIN_FONT = 10;
const MAX_FONT = 24;
/** Neither pane is useful below a fifth of the width. */
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

/** Set by the component; the keymap is created once, outside React. */
let compileFromKeyboard: () => void = () => {};

const DEFAULT_TEX = `\\documentclass{article}
\\begin{document}
\\section{Welcome to Porcupine LaTeX Studio}
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
 * What this is still not: SyncTeX click-through between source and PDF, and
 * it saves nowhere but this browser.
 */
export function SpikeClient() {
  const { compile, busy, step, outcome, error, restart } = useCompiler();
  const [files, setFiles] = useState<ProjectFiles>(new Map());
  const [entry, setEntryState] = useState(DEFAULT_ENTRY);
  const [active, setActive] = useState(DEFAULT_ENTRY);
  const [dark, setDark] = useState(false);
  const editor = useRef<EditorView | null>(null);
  const [packagesToken, setPackagesToken] = useState("0:0");
  const [showPackages, setShowPackages] = useState(false);
  const [wrap, setWrap] = useState(true);
  /** Editor width as a percentage of the split. Dragged, and remembered. */
  const [split, setSplit] = useState(50);
  /** Editor type size in px. Asked for, and the reason is eyesight. */
  const [fontSize, setFontSize] = useState(14);
  const [dragging, setDragging] = useState(false);
  const panes = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const size = Number(localStorage.getItem(FONT_KEY));
    if (Number.isFinite(size) && size >= MIN_FONT && size <= MAX_FONT) {
      setFontSize(size);
    }

    const saved = Number(localStorage.getItem(SPLIT_KEY));
    if (Number.isFinite(saved) && saved >= MIN_SPLIT && saved <= MAX_SPLIT) {
      setSplit(saved);
    }
  }, []);

  const changeFont = useCallback((next: number) => {
    if (!Number.isFinite(next)) return;
    const clamped = Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(next)));
    setFontSize(clamped);
    try {
      localStorage.setItem(FONT_KEY, String(clamped));
    } catch {
      // The size still applies; it just will not be remembered.
    }
  }, []);

  const moveSplit = useCallback((next: number) => {
    const clamped = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, next));
    setSplit(clamped);
    try {
      localStorage.setItem(SPLIT_KEY, String(Math.round(clamped)));
    } catch {
      // The split still moves; it just will not be remembered.
    }
  }, []);

  /*
   * Pointer capture, not window listeners.
   *
   * Capture keeps the events coming to the handle even when the pointer leaves
   * it — which it always does, since dragging means moving away from where you
   * started — and it ends cleanly if the pointer is lost.
   */
  const onDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || !panes.current) return;
      const box = panes.current.getBoundingClientRect();
      moveSplit(((event.clientX - box.left) / box.width) * 100);
    },
    [dragging, moveSplit],
  );

  /*
   * Built once, not per render.
   *
   * CodeMirror reconfigures itself whenever this array changes identity, and a
   * reconfigure on every keystroke throws away the completion state — the
   * popup opens and closes again before it can be read.
   */
  const extensions = useMemo(
    () => [
      StreamLanguage.define(stex),
      autocompletion({
        override: [makeLatexCompletions(() => projectRef.current)],
        // LaTeX is typed continuously, so a popup that steals the keyboard on
        // its own is worse than one asked for. It opens on `\`, on a word,
        // and on Ctrl-Space.
        activateOnTyping: true,
        closeOnBlur: true,
      }),
      closeEnvironmentOnBrace,
      /*
       * Highest precedence, or it does nothing.
       *
       * CodeMirror's own `defaultKeymap` — which `basicSetup` installs —
       * already binds Mod-Enter, to `insertBlankLine`. Extensions passed after
       * basicSetup sit at LOWER precedence, so the default won every time and
       * Cmd-Enter quietly added a blank line instead of compiling.
       */
      Prec.highest(keymap.of([COMPILE_KEY])),
      ...(wrap ? [EditorView.lineWrapping] : []),
      EditorView.theme({
        "&": { fontSize: `${fontSize}px` },
        // The gutter has to follow, or the line numbers stop lining up with
        // the lines they number.
        ".cm-gutters": { fontSize: `${fontSize}px` },
      }),
    ],
    [wrap, fontSize],
  );

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

  /*
   * The project survives a reload — all of it.
   *
   * Losing an hour's LaTeX to a refresh is what makes people stop trusting an
   * editor. Writes go through per file rather than being batched: a batch is
   * a window in which a crash loses work, and it would buy nothing but writes
   * nobody is waiting on.
   */
  useEffect(() => {
    void (async () => {
      const project = await loadProject();

      if (project.files.size === 0) {
        // A first-run project rather than an empty one: an editor that opens
        // on a blank buffer with no `\documentclass` teaches nothing.
        project.files.set(DEFAULT_ENTRY, DEFAULT_TEX);
        await saveFile(DEFAULT_ENTRY, DEFAULT_TEX);
      }

      setFiles(project.files);
      setEntryState(project.entry);
      setActive(project.files.has(project.entry) ? project.entry : DEFAULT_ENTRY);
    })();
  }, []);

  /** Every file, as the worker wants them. */
  const asRecord = useCallback(() => Object.fromEntries(files), [files]);

  /**
   * The text files, for everything that reads the document rather than
   * compiling it — completions, the outline, the word count, the checks.
   */
  const textFiles = useMemo(() => {
    const map = new Map<string, string>();
    for (const [name, contents] of files) {
      if (typeof contents === "string") map.set(name, contents);
    }
    return map;
  }, [files]);

  const labels = useMemo(() => collectLabels(textFiles), [textFiles]);
  const problems = useMemo(() => lint(textFiles), [textFiles]);
  const paths = useMemo(() => [...files.keys()], [files]);

  /*
   * Read through a ref, not captured.
   *
   * The completion extension is built once — rebuilding it on every keystroke
   * throws away the open popup — so it cannot close over `labels` directly, or
   * it would offer whatever existed when the editor was created.
   */
  const projectRef = useRef({ labels, paths });
  projectRef.current = { labels, paths };

  compileFromKeyboard = () => compile(asRecord(), entry, packagesToken);

  const edit = useCallback(
    (next: string) => {
      setFiles((current) => new Map(current).set(active, next));
      void saveFile(active, next);
    },
    [active],
  );

  /** The open file's text. Binary files are listed but never opened. */
  const openFile = files.get(active);
  const text = typeof openFile === "string" ? openFile : "";

  const outline = useMemo(
    // Recomputed as you type, which is what makes it an outline rather than a
    // snapshot of the last compile.
    () => collectOutline(text, active),
    [text, active],
  );
  const words = useMemo(() => countWords(text), [text]);

  const createFile = useCallback(
    (name: string) => {
      if (files.has(name)) {
        setActive(name);
        return;
      }
      // A new `.tex` gets nothing but a comment: a stub `\documentclass` in a
      // file meant to be `\input` from the root is a mistake that produces a
      // baffling error much later.
      const seed = name.endsWith(".bib") ? "" : `% ${name}\n`;
      setFiles((current) => new Map(current).set(name, seed));
      setActive(name);
      void saveFile(name, seed);
    },
    [files],
  );

  /**
   * Figures and data, carried into the compile as bytes.
   *
   * Text arrives as text so it can be edited; anything else is stored as bytes
   * and shown in the list but not opened. Decoding a PNG into a string would
   * corrupt it silently, which is worse than refusing to show it.
   */
  const uploadFiles = useCallback((list: FileList) => {
    void (async () => {
      for (const file of Array.from(list)) {
        const editableName = /\.(tex|bib|cls|sty|txt|md|csv)$/i.test(file.name);
        const contents = editableName
          ? await file.text()
          : new Uint8Array(await file.arrayBuffer());

        setFiles((current) => new Map(current).set(file.name, contents));
        await saveFile(file.name, contents);
      }
    })();
  }, []);

  const rename = useCallback(
    (from: string, to: string) => {
      setFiles((current) => {
        const next = new Map(current);
        const contents = next.get(from);
        if (contents === undefined) return current;
        next.delete(from);
        next.set(to, contents);
        return next;
      });
      void renameFile(from, to);

      // The root document following its own rename, and the open tab with it.
      if (entry === from) {
        setEntryState(to);
        void persistEntry(to);
      }
      if (active === from) setActive(to);
    },
    [active, entry],
  );

  const remove = useCallback(
    (name: string) => {
      // The root is not deletable from the tree, so this cannot orphan the
      // compile — but the open tab still has to go somewhere real.
      setFiles((current) => {
        const next = new Map(current);
        next.delete(name);
        return next;
      });
      void deleteFile(name);
      if (active === name) setActive(entry);
    },
    [active, entry],
  );

  const chooseEntry = useCallback((name: string) => {
    setEntryState(name);
    void persistEntry(name);
  }, []);

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
      <header className="border-rule bg-canvas flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6 relative z-20">
        <h1 className="text-ink text-[15px] font-semibold tracking-tight">Porcupine LaTeX Studio</h1>

        <div className="flex items-center gap-3">
          <span aria-live="polite" className="text-ink-soft text-sm font-mono font-medium px-3 py-1.5 bg-surface border border-rule rounded-md shadow-sm">
            {busy ? (step ?? "Working") : outcome ? describe(outcome.status) : "Ready"}
          </span>
          <Button
            variant="ghost"
            onClick={() => setShowPackages((v) => !v)}
            aria-expanded={showPackages}
          >
            Packages
          </Button>
          <Button
            variant="ghost"
            onClick={restart}
            title="Throw away the TeX engine and start a fresh one"
          >
            Restart
          </Button>
          <Button
            onClick={() => compile(asRecord(), entry, packagesToken)}
            disabled={busy}
            variant="primary"
          >
            {busy ? "Compiling…" : "Compile PDF"}
          </Button>
        </div>
      </header>

      {showPackages && (
        <div className="border-rule bg-surface shrink-0 border-b px-4 py-3">
          <h2 className="text-ink text-ui mb-2 font-medium">Packages in this browser</h2>
          <PackageManager onChange={setPackagesToken} />
        </div>
      )}

      <div ref={panes} className="bg-surface flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          aria-label="LaTeX source"
          // The basis only means anything once the panes sit side by side; on
          // a narrow screen they stack and each takes half the height.
          style={{ flexBasis: `${split}%` }}
          className="border-rule bg-canvas relative z-10 flex min-h-0 flex-1 border-b shadow-[1px_0_10px_rgba(0,0,0,0.02)] lg:flex-none lg:border-b-0"
        >
          <div className="flex w-52 shrink-0 flex-col">
            <FileTree
              files={files}
              active={active}
              entry={entry}
              onOpen={setActive}
              onCreate={createFile}
              onUpload={uploadFiles}
              onRename={rename}
              onDelete={remove}
              onSetEntry={chooseEntry}
            />

            {/* The outline of the OPEN file, not the project.

              A project-wide outline would need the root's `\input` order to
              mean anything, and reading it out of the source is guesswork the
              moment anyone writes a conditional include. What is on screen is
              what this answers for. */}
            {outline.length > 0 && (
              <nav
                aria-label="Outline"
                className="border-rule bg-surface/60 flex max-h-64 flex-col border-t border-r"
              >
                <p className="border-rule text-muted text-fine border-b px-2 py-1.5 font-medium">
                  Outline
                </p>
                <ul className="min-h-0 flex-1 overflow-auto py-1">
                  {outline.map((heading, i) => (
                    <li key={`${heading.line}-${i}`}>
                      <button
                        type="button"
                        onClick={() => goToLine(heading.line)}
                        title={heading.title}
                        style={{ paddingLeft: `${0.5 + heading.level * 0.5}rem` }}
                        className="text-muted hover:text-ink hover:bg-surface focus-visible:ring-accent text-fine w-full truncate py-1 pr-2 text-left focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {heading.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-rule bg-canvas flex h-11 shrink-0 items-center justify-between gap-3 border-b pr-4 pl-2">
              <div className="flex h-full items-center pt-1.5">
                <div className="bg-raised border-rule border-t-accent border-b-raised relative z-10 -mb-[1px] flex h-full items-center gap-2 rounded-t-md border-x border-t-[3px] border-b px-4">
                  <span className="text-ink font-mono text-sm font-medium">
                    {active}
                    {active === entry && (
                      <span className="text-accent" title="Root document">
                        {" "}
                        ▸ root
                      </span>
                    )}
                  </span>
                </div>
              </div>
              <span className="text-muted text-fine flex items-center gap-4">
                {/* LaTeX paragraphs are often one very long line, so wrapping is
                  on by default — but anyone editing a table wants the columns
                  to stay put. */}
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={wrap}
                    onChange={(e) => setWrap(e.target.checked)}
                    className="accent-accent"
                  />
                  Wrap
                </label>
                <span className="tabular-nums" title="Words, excluding markup">
                  {words} {words === 1 ? "word" : "words"}
                </span>

                <label className="flex items-center gap-1">
                  {/* A number field rather than +/- buttons: someone who wants
                    19px can say so, and the arrows still give one-step
                    nudging. */}
                  <span className="sr-only">Editor text size in pixels</span>
                  A
                  <input
                    type="number"
                    min={MIN_FONT}
                    max={MAX_FONT}
                    value={fontSize}
                    onChange={(e) => changeFont(Number(e.target.value))}
                    aria-label="Editor text size in pixels"
                    className="border-border bg-raised text-ink w-12 rounded border px-1 py-0.5 text-right"
                  />
                </label>

                <span aria-hidden>⌘↵ compile</span>
              </span>
            </div>
            {/*
            `relative` + `absolute inset-0`, and it is the whole reason the
            editor scrolls.

            CodeMirror's `height="100%"` sets `height: 100%` on `.cm-editor`,
            and a percentage resolves only against a parent with a DEFINITE
            height. A flex child sized by `flex-1` has none, so it fell back to
            `auto`: the editor grew to fit the document — measured at 1681px
            for 92 lines — and `.cm-scroller` never had anything to scroll, so
            a long file simply ran off the bottom of the page.
          */}
            <div className="relative min-h-0 flex-1">
              <CodeMirror
                // `absolute inset-0` goes on the COMPONENT, which is where the
                // class lands on the wrapper div react-codemirror renders. An
                // extra div around it does not help: `.cm-editor`'s `height:100%`
                // resolves against that wrapper, and a wrapper with no height of
                // its own leaves the percentage as `auto`.
                className="absolute inset-0"
                value={text}
                height="100%"
                theme={dark ? githubDark : githubLight}
                extensions={extensions}
                onChange={edit}
                onCreateEditor={(view) => {
                  editor.current = view;
                }}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  bracketMatching: true,
                  closeBrackets: true,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                  autocompletion: false,
                }}
              />
            </div>
          </div>
        </section>

        {/*
          The handle between the panes.

          A `separator` with a value, not a bare div: dragging is a pointer
          gesture, and this would otherwise be the only control on the screen
          that cannot be worked without one. Arrows move it, Home and End throw
          it to either extreme, double-click evens the panes up.
        */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the editor and preview"
          aria-valuenow={Math.round(split)}
          aria-valuemin={MIN_SPLIT}
          aria-valuemax={MAX_SPLIT}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
          }}
          onPointerMove={onDrag}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setDragging(false);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 2;
            if (e.key === "ArrowLeft") moveSplit(split - step);
            else if (e.key === "ArrowRight") moveSplit(split + step);
            else if (e.key === "Home") moveSplit(MIN_SPLIT);
            else if (e.key === "End") moveSplit(MAX_SPLIT);
            else return;
            e.preventDefault();
          }}
          onDoubleClick={() => moveSplit(50)}
          title="Drag to resize · double-click to even them up"
          className={cx(
            "group relative z-20 hidden shrink-0 cursor-col-resize items-center justify-center lg:flex",
            "focus-visible:ring-accent w-3 transition-colors focus-visible:ring-2 focus-visible:outline-none",
            dragging ? "bg-accent/10" : "hover:bg-accent/5",
          )}
        >
          {/* Visible Drag Handle */}
          <div className="bg-rule group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent flex h-8 w-1.5 flex-col items-center justify-center gap-1 rounded-full opacity-60 transition-colors group-hover:opacity-100" />
        </div>

        <section
          aria-label="PDF preview"
          className="bg-surface z-10 flex min-h-0 flex-1 flex-col shadow-[-1px_0_10px_rgba(0,0,0,0.02)]"
        >
          <div className="border-rule bg-canvas flex h-11 shrink-0 items-center justify-between gap-3 border-b pr-4 pl-2">
            <div className="flex h-full items-center pt-1.5">
              <div className="bg-surface border-rule border-b-surface text-ink-soft relative z-10 -mb-[1px] flex h-full items-center gap-2 rounded-t-md border-x border-t-[3px] border-b border-t-transparent px-4">
                <span className="text-sm font-medium">Preview</span>
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-6">
            {outcome?.pdfUrl ? (
              <div className="bg-raised border-border aspect-[1/1.414] w-full max-w-[850px] overflow-hidden rounded-sm border shadow-xl ring-1 ring-black/5 transition-shadow hover:shadow-2xl dark:ring-white/5">
                <iframe
                  // Titled, because an untitled frame is an unlabelled landmark
                  // and a screen reader announces it as "frame".
                  title="Compiled PDF"
                  src={outcome.pdfUrl}
                  // An iframe eats pointer events, so a drag that crossed into
                  // the preview simply stopped. Disabling them for the duration
                  // is what lets the handle travel the whole width.
                  style={dragging ? { pointerEvents: "none" } : undefined}
                  className="h-full w-full border-0 bg-white"
                />
              </div>
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
        checks={problems}
        entry={entry}
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

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
