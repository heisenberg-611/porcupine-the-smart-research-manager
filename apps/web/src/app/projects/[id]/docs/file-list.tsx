"use client";

import { useState, useRef } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import { createCollaborationFile, fetchFolderContents, shareFileAction } from "./actions";
import type { DriveFile } from "./drive-file";

export function FileList({
  projectId,
  files: initialFiles,
  rootFolderId,
}: {
  projectId: string;
  files: DriveFile[];
  rootFolderId: string;
}) {
  const [pendingType, setPendingType] = useState<"doc" | "sheet" | "slide" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const [sharingFileId, setSharingFileId] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"reader" | "commenter" | "writer">("reader");
  const [isSharing, setIsSharing] = useState(false);

  // Navigation state
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([
    { id: rootFolderId, name: "Root" },
  ]);
  const [currentFiles, setCurrentFiles] = useState<DriveFile[]>(initialFiles);
  const [isLoading, setIsLoading] = useState(false);

  const currentFolder = folderStack[folderStack.length - 1];

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  async function handleCreate(type: "doc" | "sheet" | "slide") {
    let defaultTitle = "New Document";
    if (type === "sheet") defaultTitle = "New Spreadsheet";
    if (type === "slide") defaultTitle = "New Presentation";

    const title = newName.trim() || defaultTitle;
    setPendingType(type);
    setError(null);

    const res = await createCollaborationFile({ projectId, title, type });
    if (!res.ok) {
      setError(res.error);
    } else {
      setNewName("");
      if (res.data?.url) {
        if (res.data.isFallback) {
          setFallbackUrl(res.data.url);
          dialogRef.current?.showModal();
        } else {
          window.open(res.data.url, "_blank");
        }
      }
      // Refresh the current folder
      await loadFolder(currentFolder!.id);
    }
    setPendingType(null);
  }

  async function loadFolder(folderId: string) {
    setIsLoading(true);
    setError(null);
    const res = await fetchFolderContents(folderId);
    if (!res.ok) {
      setError(res.error);
    } else if (res.data) {
      setCurrentFiles(res.data);
    } else {
      setError("Failed to load folder.");
    }
    setIsLoading(false);
  }

  function handleFileClick(e: React.MouseEvent, file: DriveFile) {
    if (file.mimeType === "application/vnd.google-apps.folder" && file.id && file.name) {
      e.preventDefault();
      const newStack = [...folderStack, { id: file.id, name: file.name }];
      setFolderStack(newStack);
      loadFolder(file.id);
    }
  }

  function navigateUp() {
    if (folderStack.length > 1) {
      const newStack = folderStack.slice(0, -1);
      setFolderStack(newStack);
      loadFolder(newStack[newStack.length - 1]!.id);
    }
  }

  async function handleShare(e: React.MouseEvent, fileId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!shareEmail.trim() || !fileId) return;

    setIsSharing(true);
    setError(null);
    const res = await shareFileAction({ fileId, email: shareEmail, role: shareRole });
    if (res.ok) {
      setSharingFileId(null);
      setShareEmail("");
      // Refresh the current folder to reflect any possible permission changes, though visually we might not show it
      await loadFolder(currentFolder!.id);
    } else {
      setError(res.error);
    }
    setIsSharing(false);
  }

  return (
    <section className="mt-8 space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-ink text-heading font-medium">Shared Files</h2>
          {folderStack.length > 1 && (
            <span className="text-muted text-ui font-mono">
              /{" "}
              {folderStack
                .slice(1)
                .map((f) => f.name)
                .join(" / ")}
            </span>
          )}
        </div>

        <div className="bg-surface border-border flex flex-wrap items-end gap-4 rounded-xl border p-5 shadow-sm">
          <div className="min-w-[200px] flex-1">
            <label
              htmlFor="newFileName"
              className="text-fine text-muted mb-1.5 block font-medium tracking-wider uppercase"
            >
              New File Name
            </label>
            <Input
              id="newFileName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Brainstorming Notes"
              className="bg-canvas h-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => handleCreate("doc")}
              disabled={pendingType !== null}
              className="h-10 bg-blue-600 px-4 text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95"
              busy={pendingType === "doc"}
              busyLabel="Creating…"
            >
              + Create Doc
            </Button>
            <Button
              onClick={() => handleCreate("sheet")}
              disabled={pendingType !== null}
              className="h-10 bg-emerald-600 px-4 text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-95"
              busy={pendingType === "sheet"}
              busyLabel="Creating…"
            >
              + Create Sheet
            </Button>
            <Button
              onClick={() => handleCreate("slide")}
              disabled={pendingType !== null}
              className="h-10 bg-amber-500 px-4 text-white shadow-sm transition-all hover:bg-amber-600 active:scale-95"
              busy={pendingType === "slide"}
              busyLabel="Creating…"
            >
              + Create Slide
            </Button>
          </div>
        </div>

        {error && <p className="text-danger text-ui">{error}</p>}
      </div>

      <div className="flex flex-col gap-2">
        {folderStack.length > 1 && (
          <Button onClick={navigateUp} variant="ghost" className="text-muted self-start">
            &larr; Back to parent
          </Button>
        )}

        {isLoading ? (
          <p className="text-muted text-ui py-4">Loading folder...</p>
        ) : currentFiles.length === 0 ? (
          <p className="text-muted text-ui py-4">This folder is empty.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {currentFiles.map((file) => (
              <li key={file.id ?? Math.random().toString()}>
                <Card className="hover:border-accent p-4 transition-colors">
                  <div className="flex items-start gap-3">
                    <a
                      href={file.webViewLink ?? "#"}
                      target={
                        file.mimeType === "application/vnd.google-apps.folder"
                          ? "_self"
                          : "_blank"
                      }
                      rel="noreferrer"
                      className="group flex min-w-0 flex-1 items-start gap-3"
                      onClick={(e) => handleFileClick(e, file)}
                    >
                      {file.iconLink && (
                        <img
                          src={file.iconLink}
                          alt=""
                          className="mt-1 h-6 w-6 object-contain"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-ink text-ui group-hover:text-accent truncate font-medium transition-colors">
                          {file.name}
                        </p>

                        <div className="mt-1 flex items-center gap-3">
                          {file.owners && file.owners[0] && (
                            <div className="text-muted text-fine flex items-center gap-1.5">
                              {file.owners[0].photoLink && (
                                <img
                                  src={file.owners[0].photoLink}
                                  alt=""
                                  className="h-4 w-4 rounded-full"
                                />
                              )}
                              <span>{file.owners[0].displayName}</span>
                            </div>
                          )}
                          <p className="text-muted text-fine">
                            {file.createdTime
                              ? `Created ${new Date(file.createdTime).toLocaleDateString()}`
                              : file.modifiedTime
                                ? `Modified ${new Date(file.modifiedTime).toLocaleDateString()}`
                                : ""}
                          </p>
                        </div>
                      </div>
                    </a>

                    <Button
                      variant="ghost"
                      onClick={(e) => {
                        e.preventDefault();
                        setSharingFileId(
                          sharingFileId === file.id ? null : (file.id ?? null),
                        );
                        setShareEmail("");
                      }}
                    >
                      Share
                    </Button>
                  </div>

                  {sharingFileId === file.id && (
                    <div
                      className="border-border mt-4 flex items-end gap-3 border-t pt-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex-1">
                        <label className="text-fine text-muted mb-1 block">
                          Email Address
                        </label>
                        <Input
                          value={shareEmail}
                          onChange={(e) => setShareEmail(e.target.value)}
                          placeholder="colleague@example.com"
                        />
                      </div>
                      <div>
                        <label className="text-fine text-muted mb-1 block">Role</label>
                        <Select
                          compact
                          value={shareRole}
                          onChange={(e) =>
                            setShareRole(
                              e.target.value as "reader" | "commenter" | "writer",
                            )
                          }
                        >
                          <option value="reader">Viewer</option>
                          <option value="commenter">Commenter</option>
                          <option value="writer">Editor</option>
                        </Select>
                      </div>
                      <Button
                        onClick={(e) => file.id && handleShare(e, file.id)}
                        disabled={!shareEmail}
                        busy={isSharing}
                        busyLabel="Sharing…"
                      >
                        Send Invite
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <dialog
        ref={dialogRef}
        className="bg-canvas border-rule text-ink m-auto w-[90vw] max-w-md rounded-[--radius-card] border p-6 shadow-xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
        onCancel={() => {
          dialogRef.current?.close();
          setFallbackUrl(null);
        }}
      >
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="text-warning mb-2 text-lg font-semibold tracking-tight">Created in Personal Drive</h3>
            <p className="text-muted text-sm leading-relaxed">
              Google Drive blocked creating this file in the shared project folder because of a permission limitation. 
            </p>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              As a fallback, the file has been successfully created in your personal Google Drive in a folder named <span className="font-semibold text-ink">Porcupine: Project Name (Personal)</span>. It is still linked to this project and visible to you here.
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button 
              variant="primary" 
              onClick={() => {
                dialogRef.current?.close();
                if (fallbackUrl) {
                  window.open(fallbackUrl, "_blank");
                }
                setFallbackUrl(null);
              }}
            >
              Open Document
            </Button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
