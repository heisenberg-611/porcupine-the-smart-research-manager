"use client";

import { useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { createCollaborationFile, fetchFolderContents, shareFileAction } from "./actions";

interface DriveFile {
  id: string | null | undefined;
  name: string | null | undefined;
  mimeType: string | null | undefined;
  webViewLink: string | null | undefined;
  iconLink: string | null | undefined;
  modifiedTime: string | null | undefined;
  createdTime?: string | null | undefined;
  owners?: Array<{ displayName?: string | null; photoLink?: string | null }> | null;
}

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
  const [folderStack, setFolderStack] = useState<{ id: string, name: string }[]>([{ id: rootFolderId, name: "Root" }]);
  const [currentFiles, setCurrentFiles] = useState<DriveFile[]>(initialFiles);
  const [isLoading, setIsLoading] = useState(false);

  const currentFolder = folderStack[folderStack.length - 1];

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
        window.open(res.data.url, "_blank");
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
              / {folderStack.slice(1).map(f => f.name).join(" / ")}
            </span>
          )}
        </div>
        
        <div className="flex flex-wrap items-end gap-4 p-5 border rounded-xl bg-surface border-border shadow-sm">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="newFileName" className="block text-fine text-muted font-medium mb-1.5 uppercase tracking-wider">New File Name</label>
            <Input 
              id="newFileName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Brainstorming Notes"
              className="h-10 bg-canvas"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button 
              onClick={() => handleCreate("doc")} 
              disabled={pendingType !== null}
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all active:scale-95 h-10 px-4"
            >
              {pendingType === "doc" ? "Creating..." : "+ Create Doc"}
            </Button>
            <Button 
              onClick={() => handleCreate("sheet")} 
              disabled={pendingType !== null}
              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all active:scale-95 h-10 px-4"
            >
              {pendingType === "sheet" ? "Creating..." : "+ Create Sheet"}
            </Button>
            <Button 
              onClick={() => handleCreate("slide")} 
              disabled={pendingType !== null}
              className="bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-all active:scale-95 h-10 px-4"
            >
              {pendingType === "slide" ? "Creating..." : "+ Create Slide"}
            </Button>
          </div>
        </div>

        {error && <p className="text-danger text-ui">{error}</p>}
      </div>

      <div className="flex flex-col gap-2">
        {folderStack.length > 1 && (
          <Button onClick={navigateUp} variant="ghost" className="self-start text-muted">
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
                <Card className="p-4 hover:border-accent transition-colors">
                  <div className="flex items-start gap-3">
                    <a 
                      href={file.webViewLink ?? "#"} 
                      target={file.mimeType === "application/vnd.google-apps.folder" ? "_self" : "_blank"} 
                      rel="noreferrer"
                      className="flex-1 flex items-start gap-3 group min-w-0"
                      onClick={(e) => handleFileClick(e, file)}
                    >
                      {file.iconLink && (
                        <img src={file.iconLink} alt="" className="w-6 h-6 object-contain mt-1" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-ink text-ui font-medium truncate group-hover:text-accent transition-colors">
                          {file.name}
                        </p>
                        
                        <div className="flex items-center gap-3 mt-1">
                          {file.owners && file.owners[0] && (
                            <div className="flex items-center gap-1.5 text-muted text-fine">
                              {file.owners[0].photoLink && (
                                <img src={file.owners[0].photoLink} alt="" className="w-4 h-4 rounded-full" />
                              )}
                              <span>{file.owners[0].displayName}</span>
                            </div>
                          )}
                          <p className="text-muted text-fine">
                            {file.createdTime ? `Created ${new Date(file.createdTime).toLocaleDateString()}` : file.modifiedTime ? `Modified ${new Date(file.modifiedTime).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                      </div>
                    </a>

                    <Button 
                      variant="ghost" 
                      onClick={(e) => {
                        e.preventDefault();
                        setSharingFileId(sharingFileId === file.id ? null : (file.id ?? null));
                        setShareEmail("");
                      }}
                    >
                      Share
                    </Button>
                  </div>

                  {sharingFileId === file.id && (
                    <div className="mt-4 pt-4 border-t border-border flex items-end gap-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex-1">
                        <label className="block text-fine text-muted mb-1">Email Address</label>
                        <Input 
                          value={shareEmail}
                          onChange={(e) => setShareEmail(e.target.value)}
                          placeholder="colleague@example.com"
                        />
                      </div>
                      <div>
                        <label className="block text-fine text-muted mb-1">Role</label>
                        <select 
                          className="h-10 px-3 rounded-lg border border-border bg-surface text-ui"
                          value={shareRole}
                          onChange={(e) => setShareRole(e.target.value as "reader" | "commenter" | "writer")}
                        >
                          <option value="reader">Viewer</option>
                          <option value="commenter">Commenter</option>
                          <option value="writer">Editor</option>
                        </select>
                      </div>
                      <Button 
                        onClick={(e) => file.id && handleShare(e, file.id)}
                        disabled={isSharing || !shareEmail}
                      >
                        {isSharing ? "Sharing..." : "Send Invite"}
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
