"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Banner, Button, Checkbox, Field, Input } from "@/components/ui";

import { cancelAccountDeletion, requestAccountDeletion } from "./actions";

/**
 * Type your own address to confirm.
 *
 * The same shape as the project delete dialog, and for the same reason: there
 * is no password to re-enter — sign-in is a six-digit code — so the only proof
 * of intent available is an action a misclick cannot produce. Copying the
 * address from the field above it is fine; the point is that the hand and the
 * eye both have to be involved.
 */
export function DeleteAccountForm({
  email,
  graceDays,
  blocked,
}: {
  email: string;
  graceDays: number;
  blocked: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [immediate, setImmediate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await requestAccountDeletion({
        confirmEmail: typed,
        immediate,
      });

      if (!response.ok) {
        setError(response.error);
        return;
      }

      /*
       * A hard navigation, not `router.push`.
       *
       * On the immediate path the session this page is holding belongs to an
       * account that no longer exists in the auth tables, and a client-side
       * transition would carry it into the next render — which then fails in
       * whatever way a request with a token for a deleted user fails. A full
       * load throws the whole thing away.
       */
      window.location.assign(immediate ? "/" : "/account");
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <Banner tone="danger">{error}</Banner>}

      <Field label="Type your email address to confirm" id="confirm-email" hint={email}>
        <Input
          id="confirm-email"
          type="email"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>

      <label className="text-ink-soft text-ui flex items-start gap-3 text-pretty">
        {/* The shared primitive, not a bare element: the guard forbids raw
            form controls, and a hand-rolled checkbox here would have its own
            focus treatment on the one screen where being sure what you clicked
            matters most. */}
        <Checkbox
          checked={immediate}
          onChange={(event) => setImmediate(event.target.checked)}
          className="mt-1 shrink-0"
        />
        <span>
          Delete it permanently now, with no {graceDays}-day wait and no way back.
        </span>
      </label>

      <div>
        <Button type="submit" variant="danger" disabled={pending || !matches || blocked}>
          {pending
            ? "Working…"
            : immediate
              ? "Delete permanently"
              : `Schedule deletion in ${graceDays} days`}
        </Button>
      </div>

      <p className="text-muted text-fine">
        {blocked
          ? "Hand over the projects listed above first."
          : matches
            ? immediate
              ? "This cannot be undone."
              : `You can cancel any time in the next ${graceDays} days by signing in.`
            : "The button turns on when the address matches."}
      </p>
    </form>
  );
}

/** One button, because somebody cancelling has already proved everything. */
export function CancelDeletionButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      {error && <Banner tone="danger">{error}</Banner>}
      <div>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const response = await cancelAccountDeletion();
              if (response.ok) router.refresh();
              else setError(response.error);
            })
          }
        >
          {pending ? "Cancelling…" : "Keep my account"}
        </Button>
      </div>
    </div>
  );
}
