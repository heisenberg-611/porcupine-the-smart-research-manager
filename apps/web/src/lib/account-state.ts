import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { must } from "@/lib/supabase/query";

/**
 * The date this account is due to be deleted, or null.
 *
 * Read on every signed-in page, so it is `cache()`d per request and selects
 * exactly one column by primary key. That is one indexed lookup on top of the
 * auth call the header already makes — worth it for the only state in the
 * product where saying nothing has a deadline attached to it.
 *
 * Returned as a formatted UTC date rather than a timestamp, because the one
 * caller renders it and the purge job works in UTC. A date shown in the
 * reader's own zone would differ by a day from the moment it actually happens
 * for half the world, and being wrong by a day about a deletion is the kind of
 * detail somebody points at afterwards.
 */
export const getPendingDeletion = cache(
  async (userId: string): Promise<string | null> => {
    const supabase = await createClient();

    const row = await must(
      supabase
        .from("users")
        .select("deletion_scheduled_at")
        .eq("id", userId)
        .maybeSingle(),
      "your account",
    );

    const scheduled = (row as { deletion_scheduled_at: string | null } | null)
      ?.deletion_scheduled_at;
    if (!scheduled) return null;

    return new Date(scheduled).toLocaleDateString(undefined, {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  },
);
