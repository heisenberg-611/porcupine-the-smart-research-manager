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

export function InviteMemberForm({ 
  projectId, 
  isDisconnected 
}: { 
  projectId: string;
  isDisconnected?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [role, setRole] = useState<string>("CONTRIBUTOR");

  const [showWarning, setShowWarning] = useState(false);
  const [warningAccepted, setWarningAccepted] = useState(false);

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

    if (isDisconnected && !warningAccepted) {
      setShowWarning(true);
      return;
    }

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
    setWarningAccepted(false);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <Banner tone="danger">{error}</Banner>}
      {done && <Banner>Member added.</Banner>}

      {showWarning && !warningAccepted && (
        <div className="border-warning/40 bg-warning-soft/20 animate-in fade-in slide-in-from-top-2 mt-2 flex flex-col gap-3 rounded-lg border p-4 duration-200">
          <h4 className="text-warning flex items-center gap-2 font-medium">
            <svg
              className="h-5 w-5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            Google Drive Disconnected
          </h4>

          <div className="text-warning-strong text-sm leading-relaxed ml-7 space-y-2">
            <p>
              Your Google account is not connected. The member will be added to the project, but won't get automatic access to the Google Drive folder.
            </p>
          </div>

          <div className="mt-2 ml-7 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                router.push(`/projects/${projectId}/docs`);
              }}
              className="min-h-9 px-4 text-sm"
            >
              Connect Google Drive
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setWarningAccepted(true);
              }}
              className="min-h-9 px-4 text-sm"
            >
              Continue anyway
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowWarning(false)}
              className="min-h-9 px-4 text-sm text-muted hover:text-ink"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

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

      {(role === "ADMIN" || role === "CONTRIBUTOR") && (
        <div className="border-warning/40 bg-warning-soft/20 text-warning-strong flex items-start gap-3 rounded-lg border p-3 text-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <svg className="text-warning mt-0.5 h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="leading-relaxed">
            <strong>Warning:</strong> Google Drive prevents permission changes if a member creates a file. If this member creates a file in the shared folder, Google will block you from downgrading OR removing ANY members in the future. Please set other users' permissions properly before adding anyone as an Editor.
          </p>
        </div>
      )}

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

      <Button
        type="submit"
        className="self-start"
        busy={pending}
        busyLabel="Adding the member…"
        disabled={showWarning && !warningAccepted}
      >
        {warningAccepted ? "Confirm Add Member" : "Add member"}
      </Button>
    </form>
  );
}
