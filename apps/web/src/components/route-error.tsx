"use client";

import { useEffect, useState } from "react";

import { Button, ButtonLink } from "@/components/ui";

/**
 * What a failed render looks like.
 *
 * Before this, an error in any of the eighteen routes fell through to Next's
 * default error page — a white screen with "Application error: a client-side
 * exception has occurred" and nothing else. In an app whose stated principle
 * is that failures are loud and name what failed, the single most visible
 * failure surface named nothing.
 *
 * The server helpers already do the hard part. `must()` throws messages like
 * "Could not load the project: <reason>", written to be read by a person. They
 * simply had nowhere to be displayed.
 *
 * `digest` is shown when present. In production React replaces the message
 * with a digest hash to avoid leaking server internals to the browser, so the
 * hash is the only thing that connects what the user saw to what the logs
 * recorded — and "it just broke" with no reference is a support conversation
 * that cannot start.
 */
export function RouteError({
  error,
  reset,
  backHref,
  backLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  backHref?: string;
  backLabel?: string;
}) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    // The browser console is where a developer looks first, and the error
    // boundary swallows it otherwise.
    console.error("[Porcupine] route error", error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex max-w-xl flex-col gap-5 px-6 py-16">
      <div>
        <p className="text-danger text-fine font-mono tracking-wide uppercase">
          Something failed to load
        </p>
        <h1 className="text-ink text-title mt-2 font-semibold tracking-tight">
          This page did not finish
        </h1>
      </div>

      {/* The message, verbatim. Paraphrasing it into "an error occurred" is
          how the useful half of an error report gets thrown away. */}
      <p className="text-ink-soft measure text-ui text-pretty">
        {error.message || "No further detail was reported."}
      </p>

      <p className="text-muted text-fine">
        Nothing was saved or changed by this. Trying again is safe.
      </p>

      <div className="flex flex-wrap gap-2">
        {/* reset() re-renders the segment, which may go back to the server.
            Nothing here clears `retrying`: a successful reset unmounts this
            component, and a failed one re-throws into a fresh copy of it. */}
        <Button
          variant="primary"
          busy={retrying}
          busyLabel="Trying again…"
          onClick={() => {
            setRetrying(true);
            reset();
          }}
        >
          Try again
        </Button>
        {backHref && backLabel && <ButtonLink href={backHref}>{backLabel}</ButtonLink>}
      </div>

      {error.digest && (
        <p className="text-muted text-fine font-mono">Reference: {error.digest}</p>
      )}
    </main>
  );
}
