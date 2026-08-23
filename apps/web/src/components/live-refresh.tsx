"use client";

import { useRouter } from "next/navigation";

import { useProjectActivity, type ActivityKind } from "@/lib/use-project-activity";

/**
 * Re-render a server-rendered page when the project changes under it.
 *
 * The whole of the live behaviour is `router.refresh()`: the server renders
 * the route again, with RLS applied by the same policies as every other read,
 * and React reconciles the result. Slower than patching state from a socket
 * payload, and the reason this is a dozen lines rather than a synchronisation
 * engine — the server stays the only thing that decides what a member sees.
 *
 * Only useful on a page whose data comes from server props. `messages-client`
 * fetches its own and so calls `useProjectActivity` directly with its loader.
 *
 * Renders nothing at all when the subscription is not established, which is
 * the normal case wherever the realtime container is not running.
 */
export function LiveRefresh({
  projectId,
  kind = "screening",
}: {
  projectId: string;
  kind?: ActivityKind | ActivityKind[];
}) {
  const router = useRouter();
  const live = useProjectActivity(projectId, kind, () => router.refresh());

  if (!live) return null;

  return (
    <p className="text-muted text-fine inline-flex items-center gap-2">
      {/* The dot is decoration and the sentence carries the meaning, rather
          than a coloured dot with a label bolted to it. */}
      <span aria-hidden className="bg-accent inline-block size-1.5 rounded-full" />
      Updating as your team works
    </p>
  );
}
