"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
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
  const [pending, setPending] = useState(false);

  async function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value as "ADMIN" | "CONTRIBUTOR" | "REVIEWER" | "OBSERVER";
    if (newRole === currentRole) return;
    
    setPending(true);
    await updateMemberRole({ projectId, userId, accessRole: newRole });
    setPending(false);
  }

  async function handleRemove() {
    if (!confirm("Are you sure you want to remove this member?")) return;
    
    setPending(true);
    await removeMember({ projectId, userId });
    setPending(false);
  }

  return (
    <div className="flex items-center gap-3">
      <select
        className="bg-surface border-border text-ink text-ui rounded-md border px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
        value={currentRole}
        onChange={handleRoleChange}
        disabled={pending}
      >
        <option value="ADMIN">Admin</option>
        <option value="CONTRIBUTOR">Contributor</option>
        <option value="REVIEWER">Reviewer</option>
        <option value="OBSERVER">Observer</option>
      </select>
      <Button
        variant="ghost"
        className="text-danger hover:bg-danger/10 px-2 py-1 h-auto"
        onClick={handleRemove}
        disabled={pending}
        title="Remove member"
      >
        Remove
      </Button>
    </div>
  );
}
