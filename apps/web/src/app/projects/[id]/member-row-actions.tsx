"use client";

import { useState } from "react";
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
  // Named, because the Select and the button share this flag: a role change
  // would otherwise have Remove announce "Removing…" while nothing of the sort
  // was happening.
  const [running, setRunning] = useState<null | "role" | "remove">(null);
  const pending = running !== null;

  async function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value as "ADMIN" | "CONTRIBUTOR" | "REVIEWER" | "OBSERVER";
    if (newRole === currentRole) return;

    setRunning("role");
    await updateMemberRole({ projectId, userId, accessRole: newRole });
    setRunning(null);
  }

  async function handleRemove() {
    if (!confirm("Are you sure you want to remove this member?")) return;

    setRunning("remove");
    await removeMember({ projectId, userId });
    setRunning(null);
  }

  return (
    <div className="flex items-center gap-3">
      {/* The shared primitive, compact, rather than a bare element. The guard
          that forbids raw form controls is not stylistic: this had its own
          focus treatment, its own disabled opacity and its own border colour,
          all of them nearly — but not quite — the primitive's, and none of
          them updated when the focus indicator was fixed. */}
      <Select
        compact
        /*
         * "Change member role", not "Role".
         *
         * The invite form on this same page has a field labelled exactly
         * "Role", so naming this one the same way puts two differently-scoped
         * controls with an identical accessible name on one screen — one that
         * sets the role of a person being added, one that changes the role of
         * a person already there. A screen-reader user hears "Role, combo box"
         * twice and has to guess. Playwright hit the same ambiguity as a
         * strict-mode violation, which is the machine-readable version of that
         * complaint.
         */
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
  );
}
