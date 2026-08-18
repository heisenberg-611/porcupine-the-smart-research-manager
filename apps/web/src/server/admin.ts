import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * The Supabase client that bypasses row-level security.
 *
 * This is the FIRST production use of the secret key in this application —
 * until account deletion there was none, and the key appeared only in the e2e
 * setup and the seeder. That is worth keeping true in spirit: the guard in
 * `scripts/guards.sh` refuses the key anywhere outside `src/server/`, and the
 * reason to reach for this module should always be "the user is not present",
 * never "RLS is in my way".
 *
 * There are exactly two such moments in account deletion:
 *
 *   1. Removing the `auth.users` row. Nothing in the anon or authenticated
 *      role may touch the auth schema, and it is the row that decides whether
 *      somebody can sign in at all — so the scrub is not finished until it is
 *      gone.
 *   2. The scheduled purge. It runs from a cron route days after the person
 *      asked for it, with no session to act under.
 *
 * The anonymisation itself is deliberately NOT done here. `users` carries an
 * `update_self` policy, so the scrub is an ordinary UPDATE the account makes
 * to its own row, under RLS, like any other edit that account could make. Only
 * the parts a user genuinely cannot perform are on this side of the line.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    // Named plainly, because the failure otherwise arrives as a 401 from
    // PostgREST several frames away and reads as a permissions bug.
    throw new Error(
      "SUPABASE_SECRET_KEY is not configured, so an account cannot be removed " +
        "from the authentication tables. See .env.example.",
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Remove the identity somebody signs in with.
 *
 * Separated from the data scrub, and ordered after it, for a reason worth
 * stating: if this succeeds and the scrub then fails, the result is a row full
 * of personal data belonging to an account nobody can sign into to try again.
 * The other order leaves an account that can still sign in but whose profile
 * is empty, which is visible, recoverable and reported.
 *
 * Returns silently when the auth row is already gone, so a retried purge is
 * not an error.
 */
export async function deleteAuthUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error && !/not found/i.test(error.message)) {
    throw new Error(`Could not delete the sign-in record: ${error.message}`);
  }
}
