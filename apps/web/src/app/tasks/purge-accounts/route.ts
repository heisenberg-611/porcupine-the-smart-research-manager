import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient, deleteAuthUser } from "@/server/admin";

import { scrubbedFields } from "../../account/deletion";

/**
 * Carry out the deletions whose grace period has run out.
 *
 * ─ Why this endpoint exists at all ─────────────────────────────────────────
 *
 * A grace period needs something to end it, and this application has no
 * scheduler. On the hosted service a Vercel Cron calls this daily. Anybody
 * running their own copy has no cron, so this is also the thing they can call
 * by hand — the README says so — and until they do, an account that asked to
 * be deleted sits waiting. Saying that plainly is better than implying a
 * background worker that does not exist.
 *
 * ─ Why it does not use a session ───────────────────────────────────────────
 *
 * There is nobody here. The account being purged asked for this days ago and
 * is not making the request, so the work runs with the secret key — one of the
 * two moments in this codebase where that is the right tool rather than a
 * shortcut past RLS. See `src/server/admin.ts`.
 *
 * ─ Authentication ─────────────────────────────────────────────────────────
 *
 * A shared secret in a header, compared in constant time. Not a session,
 * because a cron has none; not an IP allowlist, because Vercel's egress
 * addresses are not fixed. If `PURGE_TASK_SECRET` is unset the endpoint
 * refuses every request rather than running open — an unconfigured secret is
 * the state a self-hosted instance starts in, and the failure has to be
 * "closed".
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PURGE_TASK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "PURGE_TASK_SECRET is not configured." },
      { status: 503 },
    );
  }

  const offered = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(offered, `Bearer ${secret}`)) {
    // No detail. A 401 that explains which half was wrong is a 401 that helps
    // whoever is guessing.
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: due, error } = await admin
    .from("users")
    .select("id")
    .lte("deletion_scheduled_at", new Date().toISOString())
    .is("deleted_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const purged: string[] = [];
  const failed: string[] = [];

  for (const { id } of due ?? []) {
    try {
      await purgeOne(admin, id);
      purged.push(id);
    } catch {
      // One bad row must not stop the rest. The id is reported so an operator
      // can look at it; nothing about the person is.
      failed.push(id);
    }
  }

  return NextResponse.json({
    purged: purged.length,
    failed: failed.length,
    failed_ids: failed,
  });
}

/**
 * The same scrub the immediate path performs, without a user session.
 *
 * Deliberately NOT sharing `scrub()` from the account actions: that one runs
 * inside `withUserContext` under the deleted account's own claims, which do
 * not exist here. What IS shared is `scrubbedFields`, because the list of
 * things that must be erased is the part that would do real damage if the two
 * paths drifted apart.
 */
async function purgeOne(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<void> {
  // Projects nobody else is in go with the account. Ones with other members
  // cannot be here — `requestAccountDeletion` refuses to schedule while the
  // account is the sole owner of a shared project, and the database trigger
  // refuses the removal besides.
  // `error` captured, and thrown. A bare destructure here would read a failed
  // query as "they own nothing", skip the project deletions, and then scrub the
  // account anyway — leaving projects nobody can reach behind an account that
  // no longer exists. The caller catches per-user and reports the id.
  const { data: owned, error: ownedError } = await admin
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId)
    .eq("access_role", "OWNER")
    .is("removed_at", null);

  if (ownedError) throw new Error(ownedError.message);

  for (const row of owned ?? []) {
    const { count } = await admin
      .from("project_members")
      .select("id", { count: "exact", head: true })
      .eq("project_id", row.project_id)
      .is("removed_at", null)
      .neq("user_id", userId);

    if ((count ?? 0) === 0) {
      await admin.from("projects").delete().eq("id", row.project_id);
    }
  }

  await admin
    .from("project_members")
    .update({ removed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("removed_at", null);

  await admin.from("devices").delete().eq("user_id", userId);
  await admin.from("project_keys").delete().eq("user_id", userId);

  const fields = scrubbedFields(userId);
  await admin
    .from("users")
    .update({
      email: fields.email,
      display_name: fields.displayName,
      avatar_url: null,
      orcid: null,
      affiliation: null,
      identity_pub_key: null,
      signing_pub_key: null,
      wrapped_bundle: null,
      kdf_salt: null,
      deleted_at: fields.deletedAt.toISOString(),
      deletion_scheduled_at: null,
    })
    .eq("id", userId);

  // Last, and outside everything else. See the note in account/actions.ts on
  // which half-finished state is the survivable one.
  await deleteAuthUser(userId);
}

/**
 * Constant time, so the comparison does not leak the secret one byte at a time.
 *
 * Written out rather than imported from `node:crypto` because this route runs
 * on the edge runtime, where `timingSafeEqual` is not available. Length is
 * compared first and is not secret; the loop then always runs to the end.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/** GET is refused: this changes things, and a cron that gets prefetched is a bug. */
export function GET() {
  return NextResponse.json({ error: "Use POST." }, { status: 405 });
}
