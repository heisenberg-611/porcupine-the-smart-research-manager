import "server-only";

/**
 * Run a Supabase query and throw if it failed.
 *
 * Exists because `const { data } = await supabase.from(...)` is the shortest
 * thing to write and quietly the wrong thing. When the query errors, `data`
 * is null, and the page renders as though the table were empty — so
 * "no annotations yet", "no papers yet" and "the query is broken" all look
 * identical, to the user and to us.
 *
 * That bug shipped three times in Phase 1 before it was noticed:
 *   - a PostgREST embed of a non-existent foreign key, rendering 0 annotations
 *   - the progress view, which would have rendered a page of zeroes
 *   - the reader, where the same shape hid an RLS denial
 *
 * Each time the fix was the same, so the fix belongs in one place. CI now
 * refuses a bare `const { data }` destructure in app code, which makes this
 * the path of least resistance rather than a convention to remember.
 *
 * `what` is used in the message: "Could not load annotations" is actionable,
 * "PGRST200" is not.
 */
export async function must<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
  what: string,
): Promise<T> {
  // One function, not a must/maybe pair. Whether a row may legitimately be
  // absent is already encoded in the query's own type — `.maybeSingle()`
  // yields `T | null` and a list yields `T[]` — so a second helper would only
  // restate what the type says, and give two places for the error handling to
  // drift apart.
  const { data, error } = await query;
  if (error) throw new Error(`Could not load ${what}: ${error.message}`);
  return data;
}
