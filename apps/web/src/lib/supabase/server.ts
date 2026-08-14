import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Supabase client for RSCs, route handlers, and server actions.
 *
 * Reads the session from cookies and carries the JWT to PostgREST, so RLS
 * applies exactly as it does in the browser. Nothing here uses the secret
 * key — that bypasses RLS entirely and lives only in `admin.ts`.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore
            // — but only because the middleware exists. Do not delete it.
          }
        },
      },
    },
  );
}

/**
 * The authenticated user, or null.
 *
 * Always `getUser()`, never `getSession()`: getSession reads the cookie
 * without verifying it, so it can be forged. getUser revalidates against
 * the auth server.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Claims shaped for `withUserContext`. Null when unauthenticated. */
export async function getUserClaims() {
  const user = await getCurrentUser();
  if (!user) return null;
  return { sub: user.id, role: "authenticated", email: user.email ?? "" };
}
