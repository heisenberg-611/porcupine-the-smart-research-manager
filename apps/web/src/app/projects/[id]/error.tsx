"use client";

import { RouteError } from "@/components/route-error";

/**
 * Scoped to one project, so the project nav above it survives the failure and
 * the other sections stay reachable. A failed evidence query should not cost
 * someone their way back to the library.
 */
export default function ProjectError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} backHref="/projects" backLabel="All projects" />;
}
