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
  const [editingName, setEditingName] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  /** Deleting takes two clicks. There is no undo behind it. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);

  const names = [...files.keys()].sort((a, b) => a.localeCompare(b));

  const onDownload = (name: string) => {
    const contents = files.get(name);
    if (!contents) return;
    const blob = new Blob([contents as any]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
      <div className="border-rule flex h-11 shrink-0 items-center justify-between gap-1 border-b px-4">
        <span className="text-ink text-sm font-medium">Files</span>
        <span className="flex items-center gap-2">
          {/* Words, not glyphs. `+` and `↑` are guessable and this panel has
              room for the answer; a symbol whose meaning has to be hovered for
              is the same mistake as a button that only appears on hover. */}
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-muted hover:text-ink hover:bg-accent/5 focus-visible:ring-accent text-xs font-medium rounded px-2 py-1 transition-colors border border-transparent hover:border-rule shadow-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            New
          </button>
          <button
            type="button"
            onClick={() => upload.current?.click()}
            title="Add figures, data, or .tex files from your machine"
            className="text-muted hover:text-ink hover:bg-accent/5 focus-visible:ring-accent text-xs font-medium rounded px-2 py-1 transition-colors border border-transparent hover:border-rule shadow-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            Upload
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
          const renaming = editingName === name;

          if (renaming) {
            return (
              <li key={name} className="px-1 py-0.5">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = rename.trim();
                    if (next && next !== name) onRename(name, next);
                    setEditingName(null);
                  }}
                >
                  {/* An inline field, not `prompt()`. A native prompt blocks
                      the whole page, cannot be styled or cancelled with Escape
                      in the usual way, and is suppressed outright in some
                      browsers — a rename that silently does nothing. */}
                  <input
                    autoFocus
                    value={rename}
                    onChange={(e) => setRename(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setEditingName(null)}
                    onBlur={() => setEditingName(null)}
                    aria-label={`Rename ${name}`}
                    className="border-accent bg-raised text-ink text-fine w-full rounded border px-2 py-1 font-mono"
                  />
                </form>
              </li>
            );
          }

          return (
            <li key={name} className="flex items-center gap-0.5 pr-2">
              <button
                type="button"
                onClick={() => editable && onOpen(name)}
                disabled={!editable}
                aria-current={current ? "true" : undefined}
                title={editable ? name : `${name} — binary, carried but not editable`}
                className={cx(
                  "text-[13px] focus-visible:ring-accent min-w-0 flex-1 truncate px-3 py-1.5 text-left font-mono transition-colors",
                  "focus-visible:ring-2 focus-visible:outline-none",
                  current ? "bg-accent/10 text-ink font-medium" : "text-ink-soft",
                  editable ? "hover:text-ink hover:bg-surface/50" : "cursor-default italic opacity-70",
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

              {/*
                Always visible, and that is a correction.

                These were revealed on hover, on the reasoning that a permanent
                three-button strip per row reads as a toolbar rather than a
                list. It does — and it is still the wrong trade: a control you
                cannot see is a control that does not exist, hover does not
                happen at all on a touch screen, and the first person to use
                this asked where the delete button was. Quiet until pointed at
                is as far as this should go.
              */}
              <IconButton
                label={`Download ${name}`}
                onClick={() => onDownload(name)}
                hover="hover:text-accent"
              >
                ↓
              </IconButton>
              {!isRoot && editable && name.endsWith(".tex") && (
                <IconButton
                  label={`Make ${name} the root document`}
                  onClick={() => onSetEntry(name)}
                  hover="hover:text-accent"
                >
                  ▸
                </IconButton>
              )}
              <IconButton
                label={`Rename ${name}`}
                onClick={() => {
                  setEditingName(name);
                  setRename(name);
                }}
                hover="hover:text-ink"
              >
                ✎
              </IconButton>
              <IconButton
                label={
                  isRoot
                    ? `${name} is the root document and cannot be deleted`
                    : `Delete ${name}`
                }
                // Shown rather than hidden on the root: an absent button asks
                // the reader to work out why, and "you cannot delete the file
                // being compiled" is the answer.
                disabled={isRoot}
                onClick={() => {
                  if (confirmDelete === name) {
                    onDelete(name);
                    setConfirmDelete(null);
                  } else {
                    setConfirmDelete(name);
                  }
                }}
                hover="hover:text-danger"
                active={confirmDelete === name}
              >
                {confirmDelete === name ? "sure?" : "×"}
              </IconButton>
            </li>
          );
        })}
      </ul>

      <p className="border-rule text-muted text-fine border-t px-2 py-1.5">
        {names.length} {names.length === 1 ? "file" : "files"} · ▸ is the root
      </p>
    </div>
  );
}

/** A small, always-visible row action with a real accessible name. */
function IconButton({
  label,
  onClick,
  children,
  hover,
  disabled = false,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  hover: string;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "text-fine focus-visible:ring-accent shrink-0 rounded px-1.5 py-1 transition-colors",
        "focus-visible:ring-2 focus-visible:outline-none",
        disabled ? "text-muted/40 cursor-not-allowed" : `text-muted ${hover}`,
        active && "text-danger bg-danger-soft",
      )}
    >
      {children}
    </button>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
