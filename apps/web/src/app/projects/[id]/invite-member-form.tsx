"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { Banner, Button, Field, Input, Select } from "@/components/ui";
import { inviteMember } from "../actions";

const ROLE_OPTIONS = [
  { value: "CONTRIBUTOR", label: "Contributor — reads, extracts, writes" },
  { value: "REVIEWER", label: "Reviewer / supervisor — reads and comments" },
  { value: "ADMIN", label: "Admin — manages members and settings" },
  { value: "OBSERVER", label: "Observer — reads only" },
] as const;

export function InviteMemberForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [role, setRole] = useState<string>("CONTRIBUTOR");

  /*
   * `onSubmit`, not `action` — the same trap the new-project form fell into.
   *
   * `<form action={fn}>` makes React run the handler inside a transition, and
   * state updates inside a transition are DEFERRED: React may hold the repaint
   * back rather than show it. So `setPending(true)` set the variable, the
   * button carried on saying "Add member", and adding somebody to a project
   * looked like a click that had not landed.
   *
   * A plain submit handler makes it an ordinary update, which paints straight
   * away. Measured on the sibling form by sampling the button every 60ms
   * through a real submission; before the change it read "Create project
   * [ENABLED]" for the whole operation.
   */
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read the fields before the first await: `currentTarget` is nulled once
    // the event has been handled.
    const formData = new FormData(event.currentTarget);
    const form = event.currentTarget;

    setPending(true);
    setError(null);
    setDone(false);

    const result = await inviteMember({
      projectId,
      email: String(formData.get("email") ?? ""),
      accessRole: formData.get("accessRole") as (typeof ROLE_OPTIONS)[number]["value"],
      historyAccess:
        formData.get("historyAccess") === "FROM_JOIN" ? "FROM_JOIN" : "ALL_HISTORY",
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    // Clear the fields, which the browser used to do for us when this was a
    // form action. Nothing navigates here — the member appears in the list
    // above — so leaving the last invitee's address in the box invites
    // sending it twice.
    form.reset();
    setRole("CONTRIBUTOR");
    setDone(true);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <Banner tone="danger">{error}</Banner>}
      {done && <Banner>Member added.</Banner>}

      <Field label="Email" id="invite-email">
        <Input
          id="invite-email"
          name="email"
          type="email"
          required
          placeholder="colleague@university.edu"
        />
      </Field>

      <Field label="Role" id="invite-role">
        <Select
          id="invite-role"
          name="accessRole"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      {/*
        ADR-006. Asked explicitly rather than assumed, and only for reviewers,
        because that is the case where it actually carries weight — a
        supervisor joining a thesis already in progress. Default is all
        history: a partial view produces confusing empty screens.
      */}
      {role === "REVIEWER" && (
        <Field
          label="History access"
          id="invite-history"
          hint="Supervisors usually join mid-project. Should they see work created before today?"
        >
          <Select id="invite-history" name="historyAccess" defaultValue="ALL_HISTORY">
            <option value="ALL_HISTORY">All history</option>
            <option value="FROM_JOIN">From now on</option>
          </Select>
        </Field>
      )}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Adding the member…" : "Add member"}
      </Button>
    </form>
  );
}
