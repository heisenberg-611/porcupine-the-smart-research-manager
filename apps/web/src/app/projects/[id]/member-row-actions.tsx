"use client";

import { useRef, useState } from "react";
import { Button, Select } from "@/components/ui";
import { updateMemberRole, removeMember } from "../actions";

export function MemberRowActions({
  projectId,
  userId,
  currentRole,
}: {
  projectId: string;
  userId: string;
  currentRole: string;
}) {
  const [running, setRunning] = useState<null | "role" | "remove">(null);
  const pending = running !== null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pendingRole, setPendingRole] = useState<"ADMIN" | "CONTRIBUTOR" | null>(null);

  async function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value as "ADMIN" | "CONTRIBUTOR" | "REVIEWER" | "OBSERVER";
    if (newRole === currentRole) return;

    const isPromotingToEditor =
      (newRole === "ADMIN" || newRole === "CONTRIBUTOR") &&
      currentRole !== "ADMIN" &&
      currentRole !== "CONTRIBUTOR";

    if (isPromotingToEditor) {
      setPendingRole(newRole);
      e.target.value = currentRole;
      dialogRef.current?.showModal();
      return;
    }

    setRunning("role");
    await updateMemberRole({ projectId, userId, accessRole: newRole });
    setRunning(null);
  }

  async function confirmRoleChange() {
    if (!pendingRole) return;
    dialogRef.current?.close();
    setRunning("role");
    await updateMemberRole({ projectId, userId, accessRole: pendingRole });
    setRunning(null);
    setPendingRole(null);
  }

  function cancelRoleChange() {
    dialogRef.current?.close();
    setPendingRole(null);
  }

  async function handleRemove() {
    if (!confirm("Are you sure you want to remove this member?")) return;

    setRunning("remove");
    await removeMember({ projectId, userId });
    setRunning(null);
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <Select
          compact
          aria-label="Change member role"
          className="disabled:opacity-50"
          value={currentRole}
          onChange={handleRoleChange}
          disabled={pending}
        >
          <option value="ADMIN">Admin</option>
          <option value="CONTRIBUTOR">Contributor</option>
          <option value="REVIEWER">Reviewer</option>
          <option value="OBSERVER">Observer</option>
        </Select>
        <Button
          variant="ghost"
          className="text-danger hover:bg-danger/10 h-auto px-2 py-1"
          onClick={handleRemove}
          disabled={pending}
          busy={running === "remove"}
          busyLabel="Removing…"
          title="Remove member"
        >
          Remove
        </Button>
      </div>

      <dialog
        ref={dialogRef}
        onCancel={cancelRoleChange}
        className="bg-canvas border-rule text-ink m-auto w-[90vw] max-w-md rounded-[--radius-card] border p-6 shadow-xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      >
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="text-danger mb-2 text-lg font-semibold tracking-tight">Warning: Google Drive Limitation</h3>
            <p className="text-muted text-sm leading-relaxed">
              Google Drive prevents permission changes if a member creates a file. If this member creates a file in the shared folder, Google will block you from downgrading OR removing ANY members in the future.
            </p>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              Please set other users' permissions properly before promoting anyone to an Editor.
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={cancelRoleChange}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmRoleChange}>
              I understand, promote
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
