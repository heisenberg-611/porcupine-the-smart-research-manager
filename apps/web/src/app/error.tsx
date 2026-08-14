"use client";

import { RouteError } from "@/components/route-error";

/**
 * The outermost boundary below the root layout.
 *
 * Segments with their own error.tsx handle themselves; this catches everything
 * that does not, so no route in the app can fall through to Next's default
 * error page.
 */
export default function AppError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} backHref="/projects" backLabel="All projects" />;
}
