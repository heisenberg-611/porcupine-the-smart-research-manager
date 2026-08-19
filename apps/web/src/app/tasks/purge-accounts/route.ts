import { NextResponse, type NextRequest } from "next/server";

import { deleteAuthUser } from "@/server/admin";
import { withUserContext } from "@/server/db";

import { scrub } from "../../account/actions";

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
 * ─ Who it acts as ─────────────────────────────────────────────────────────
 *
 * There is nobody here: the account asked for this days ago and is not making
 * the request. The obvious answer — read and write with the secret key — does
 * not work in this database and should not. `service_role` holds no SELECT or
 * UPDATE on `public.users`; those grants were deliberately revoked, and adding
 * them back would re-open the bypass-everything role on the one table carrying
 * every identity. The first version of this route did exactly that and got
 * "permission denied for table users", which was the right answer.
 *
 * So the listing comes from `due_account_deletions()`, a SECURITY DEFINER
 * function that returns ids and nothing else, and the work then runs for each
 * account UNDER THAT ACCOUNT'S OWN CLAIM through `withUserContext` — the same
 * `scrub()` a person deleting their own account calls, under the same
 * policies. The two paths cannot drift apart because there is only one.
 *
 * The secret key survives for exactly one step: removing the `auth.users` row,
 * which goes through GoTrue's admin API rather than PostgREST and so needs no
 * table grants at all.
 *
 * ─ Authentication, and why the variable has that name ─────────────────────
 *
 * A shared secret in a header, compared in constant time. Not a session,
 * because a cron has none; not an IP allowlist, because Vercel's egress
 * addresses are not fixed.
 *
 * `CRON_SECRET` is not a name chosen here. Vercel attaches
 * `Authorization: Bearer <value>` to a cron invocation automatically, and only
 * for a variable spelled exactly that — `vercel.json` cannot set a header of
 * its own, so any other name means the header never arrives and every run 401s
 * forever, silently, because Vercel does not retry and reports it only in the
 * function logs. Self-hosters set the same variable and get the same check.
 *
 * Unset, the endpoint refuses everything rather than running open. That is the
 * state a fresh install starts in, so the failure has to be closed.
 */
async function purgeDue(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured, so this endpoint is closed." },
      { status: 503 },
    );
  }

  const offered = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(offered, `Bearer ${secret}`)) {
    // No detail. A 401 that explains which half was wrong is a 401 that helps
    // whoever is guessing.
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let due: string[];
  try {
    due = await listDueAccounts();
  } catch {
    return NextResponse.json({ error: "Could not list due accounts." }, { status: 500 });
  }

  const purged: string[] = [];
  const failed: string[] = [];

  for (const userId of due) {
    try {
      // As the account itself. Everything RLS would allow that person to do to
      // their own row, and nothing else.
      await withUserContext({ sub: userId }, async (tx) => {
        await scrub(tx, userId);
      });

      // Last, and outside the transaction: it lives in another schema behind
      // another service. See the note in account/actions.ts on which
      // half-finished state is the survivable one.
      await deleteAuthUser(userId);
      purged.push(userId);
    } catch {
      // One bad row must not stop the rest. The id is reported so an operator
      // can look at it; nothing about the person is.
      failed.push(userId);
    }
  }

  return NextResponse.json({
    purged: purged.length,
    failed: failed.length,
    failed_ids: failed,
  });
}

/**
 * The ids whose grace period has run out.
 *
 * Through the SECURITY DEFINER function rather than a query, because a cron
 * has no claim and an ordinary read would be filtered to nothing by RLS —
 * fail-closed, correctly, and useless here. The function returns ids only.
 *
 * `withUserContext` needs a claim even for this, and there is no user yet; the
 * NIL uuid is used deliberately. It matches nobody, so every policy this
 * transaction touches evaluates false, and the only thing it can reach is the
 * definer function itself.
 */
async function listDueAccounts(): Promise<string[]> {
  const NOBODY = "00000000-0000-0000-0000-000000000000";

  const rows = await withUserContext(
    { sub: NOBODY },
    (tx) =>
      tx.$queryRaw<Array<{ due_account_deletions: string }>>`
      select * from public.due_account_deletions()
    `,
  );

  return rows.map((row) => row.due_account_deletions);
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

/*
 * GET as well as POST, and GET is the one that matters.
 *
 * A route that changes things on GET is normally a mistake — a prefetch or a
 * link preview fires it. Here it is what Vercel does: cron invocations are GET
 * requests, every example in their documentation is a GET handler, and no
 * setting changes it. The mitigation is that nothing reaches the work without
 * the bearer token above, so a prefetch by something that does not hold the
 * secret gets a 401 and nothing else.
 *
 * POST is kept for the self-hosted case, where the caller is a person or their
 * own cron and can use the verb the action deserves.
 *
 * Duplicate delivery is expected rather than defended against: Vercel states a
 * scheduled run may be invoked more than once. Every step is idempotent — the
 * scrub writes fixed values, the membership update is bounded by
 * `removed_at is null`, and deleting an already-deleted auth row is not an
 * error — so a second run finds nothing left to do.
 */
export const GET = purgeDue;
export const POST = purgeDue;
