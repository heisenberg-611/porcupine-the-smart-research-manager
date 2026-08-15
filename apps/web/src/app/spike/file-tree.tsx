"use client";

import { useRef, useState } from "react";

import { isEditable, isText, type ProjectFiles } from "@/lib/latex/project-store";

/**
 * The files in the document.
 *
 * A flat list rather than a collapsible tree, deliberately. Paths carry their
 * directories (`chapters/intro.tex`) and sort into groups on their own, and a
 * tree widget for the eight files a thesis actually has is a lot of machinery
 * for a shallower structure than it implies.
 *
 * The root document is marked, because it is the only file that matters to the
 * compiler and it is not always `main.tex` — plenty of theses call it
 * `thesis.tex`, and a project that silently compiles the wrong file is baffling
 * in a way nothing on screen would explain.
 */
export function FileTree({
  files,
  active,
  entry,
  onOpen,
  onCreate,
  onUpload,
  onRename,
  onDelete,
  onSetEntry,
}: {
  files: ProjectFiles;
  active: string;
  entry: string;
  onOpen: (name: string) => void;
  onCreate: (name: string) => void;
  onUpload: (list: FileList) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  onSetEntry: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const upload = useRef<HTMLInputElement>(null);

  const names = [...files.keys()].sort((a, b) => a.localeCompare(b));

  function create(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    // A name with no extension compiles to nothing and confuses TeX's own
    // lookup, so it gets the obvious one rather than an error message.
    onCreate(/\.[a-z0-9]+$/i.test(name) ? name : `${name}.tex`);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="border-rule bg-surface/60 flex w-52 shrink-0 flex-col border-r">
      <div className="border-rule flex items-center justify-between gap-1 border-b px-2 py-1.5">
        <span className="text-muted text-fine font-medium">Files</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-label="New file"
            title="New file"
            className="text-muted hover:text-ink focus-visible:ring-accent rounded px-1.5 focus-visible:ring-2 focus-visible:outline-none"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => upload.current?.click()}
            aria-label="Upload figures or data"
            title="Upload figures or data"
            className="text-muted hover:text-ink focus-visible:ring-accent rounded px-1.5 focus-visible:ring-2 focus-visible:outline-none"
          >
            ↑
          </button>
          <input
            ref={upload}
            type="file"
            multiple
            className="sr-only"
            aria-label="Files to add to the project"
            onChange={(e) => {
              if (e.target.files) onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </span>
      </div>

      {adding && (
        <form onSubmit={create} className="border-rule border-b p-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => !draft && setAdding(false)}
            placeholder="chapters/intro.tex"
            aria-label="New file name"
            className="border-border bg-raised text-ink text-fine w-full rounded border px-2 py-1 font-mono"
          />
        </form>
      )}

      <ul className="min-h-0 flex-1 overflow-auto py-1">
        {names.map((name) => {
          const current = name === active;
          const isRoot = name === entry;
          const editable = isEditable(name) && isText(files.get(name)!);

          return (
            <li key={name} className="group flex items-center">
              <button
                type="button"
                onClick={() => editable && onOpen(name)}
                disabled={!editable}
                aria-current={current ? "true" : undefined}
                title={editable ? name : `${name} — binary, carried but not editable`}
                className={cx(
                  "text-fine focus-visible:ring-accent min-w-0 flex-1 truncate px-2 py-1 text-left font-mono",
                  "focus-visible:ring-2 focus-visible:outline-none",
                  current ? "bg-accent-soft text-ink" : "text-muted",
                  editable ? "hover:text-ink hover:bg-surface" : "cursor-default italic",
                )}
              >
                {isRoot && (
                  // The compiler's starting point, marked. Everything else is
                  // only reached if this file pulls it in.
                  <span className="text-accent" title="Root document">
                    ▸{" "}
                  </span>
                )}
                {name}
              </button>

              {/* Kept out of the way until the row is touched: eight rows each
                  carrying three permanent buttons is a toolbar, not a list. */}
              <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                {!isRoot && editable && name.endsWith(".tex") && (
                  <button
                    type="button"
                    onClick={() => onSetEntry(name)}
                    aria-label={`Compile ${name} as the root document`}
                    title="Make this the root document"
                    className="text-muted hover:text-accent px-1"
                  >
                    ▸
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const next = prompt("Rename to", name);
                    if (next && next !== name) onRename(name, next);
                  }}
                  aria-label={`Rename ${name}`}
                  className="text-muted hover:text-ink px-1"
                >
                  ✎
                </button>
                {!isRoot && (
                  <button
                    type="button"
                    onClick={() => onDelete(name)}
                    aria-label={`Delete ${name}`}
                    className="text-muted hover:text-danger px-1"
                  >
                    ×
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="border-rule text-muted text-fine border-t px-2 py-1.5">
        {names.length} {names.length === 1 ? "file" : "files"}
      </p>
    </div>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
