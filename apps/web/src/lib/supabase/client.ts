"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client.
 *
 * Carries the user's JWT on every request, so PostgREST evaluates RLS per
 * request with no session state anywhere. This is the default path for
 * user-scoped reads (R-02) — reach for Prisma only when you need a
 * transaction, and then only through `withUserContext`.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
