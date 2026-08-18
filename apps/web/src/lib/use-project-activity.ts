"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/** Which signal to listen for. One channel per project per kind. */
export type ActivityKind = "screening" | "extraction" | "messages";

/**
 * Tell me when somebody else changes something in this project.
 *
 * ─ What arrives, and what does not ────────────────────────────────────────
 *
 * The subscription is to `project_activity`, which holds a project id, a word
 * and a timestamp — no titles, no decisions, no identities. See
 * supabase/migrations/20260818160000_project_activity_signal.sql for why the
 * tables with content in them are not published. The payload is deliberately
 * not passed to the callback: there is nothing in it worth having, and a
 * callback that received row data would eventually be used to render it,
 * which is the exact design this avoids.
 *
 * So `onSignal` means "something changed, go and ask the server". The server
 * applies RLS on that read as it does on every other. A bug in this file shows
 * somebody a stale page; it cannot show them another project.
 *
 * ─ Cost, because it was the reason this did not exist ─────────────────────
 *
 * `messages-client.tsx` deferred live delivery explicitly on cost: Supabase
 * Realtime bills per delivered message per subscriber, so a socket per member
 * per channel with a delivery per message is the most expensive thing this
 * product could switch on. This is a different shape. One project-wide signal
 * row is bumped rather than appended, subscribers get one event per burst
 * rather than one per message, and the debounce below collapses a keyboard
 * screener's stream of decisions into one wake-up per second.
 *
 * ─ Degrading to nothing ───────────────────────────────────────────────────
 *
 * The realtime container is optional — CI starts Supabase with `-x realtime`,
 * and the minimal local stack has no websocket endpoint at all. Every failure
 * path here ends in silence: no banner, no toast, no retry storm. `live` stays
 * false and the app behaves exactly as it did before this existed.
 *
 * @returns whether the subscription is actually established, for the one
 *   piece of UI that should say so.
 */
export function useProjectActivity(
  projectId: string,
  kind: ActivityKind,
  onSignal: () => void,
): boolean {
  const [live, setLive] = useState(false);

  // The callback in a ref, not in the dependency list.
  //
  // Callers pass an inline arrow or a `useCallback` whose own dependencies
  // change — `loadMessages` in messages-client changes whenever the selected
  // channel does. In the dependency array that tears down the websocket and
  // opens a new one on every such change, which is both wasteful and a race:
  // events in the gap are lost. The ref keeps the effect stable and still
  // calls the current callback.
  const handler = useRef(onSignal);
  useEffect(() => {
    // Assigned in an effect rather than during render. Writing to a ref while
    // rendering is a side effect in the render phase, which React is entitled
    // to run twice or throw away; no dependency array, so it lands after every
    // commit and the effect below always calls the current callback.
    handler.current = onSignal;
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`activity:${projectId}:${kind}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_activity",
          // Server-side, so a browser is not woken by every project in the
          // database. RLS still decides whether it may receive anything at
          // all; this only narrows what it asks for.
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          if (timer.current) return;
          timer.current = setTimeout(() => {
            timer.current = null;
            handler.current();
          }, 1000);
        },
      )
      .subscribe((status) => {
        // SUBSCRIBED is the only status worth acting on. CHANNEL_ERROR and
        // TIMED_OUT mean there is no realtime server, which is a supported
        // way to run this app and not a fault to report to the reader.
        setLive(status === "SUBSCRIBED");
      });

    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void supabase.removeChannel(channel);
    };
  }, [projectId, kind]);

  return live;
}
