import "server-only";

import { cache } from "react";

import { must } from "@/lib/supabase/query";
import { createClient } from "@/lib/supabase/server";

export interface ProjectShell {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  ownership_model: string;
  /** Where members go for a paper the DOI will not open. See access-route.tsx. */
  access_help_url: string | null;
  access_help_label: string | null;
  drive_folder_id: string | null;
}

/**
 * The project row, fetched once per request no matter who asks.
 *
 * The project layout needs the kind to decide which sections exist; the
 * overview page needs the same row plus the description. Without `cache()`
 * that is two identical round trips on every project screen — supabase-js
 * queries are not deduplicated by anything, unlike `fetch`, so the framework
 * will not do this for us.
 *
 * `cache()` is per-request and per-argument, which is exactly the scope
 * wanted: no cross-request sharing, so a row this user is not allowed to see
 * is never served from someone else's render. RLS still applies to the query
 * itself; this only avoids repeating it.
 *
 * Returns null rather than throwing when the project is absent, because
 * absent and forbidden are deliberately the same answer — RLS returns nothing
 * for a project this user is not a member of, and distinguishing the two
 * would confirm the project exists.
 */
export const getProject = cache(async (id: string): Promise<ProjectShell | null> => {
  const supabase = await createClient();
  const project = await must(
    supabase
      .from("projects")
      .select(
        "id, title, description, kind, ownership_model, access_help_url, access_help_label, drive_folder_id",
      )
      .eq("id", id)
      .maybeSingle(),
    "the project",
  );
  return (project as ProjectShell | null) ?? null;
});
