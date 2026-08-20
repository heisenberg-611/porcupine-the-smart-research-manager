import { PAPER_BUCKET } from "@Porcupine/shared";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/server/admin";
import { withUserContext } from "@/server/db";
import { discardPaperObject, inspectPaperObject } from "@/server/paper-files";

/**
 * Make the bucket and the database agree again.
 *
 * ─ Why this endpoint exists ────────────────────────────────────────────────
 *
 * Uploads go straight from the browser to Supabase Storage, so the app is not
 * in the path and cannot make the row and the bytes land together. Two things
 * can therefore be true at the end of an upload and neither is visible from
 * inside the application:
 *
 *   PENDING row, no bytes — the browser asked and then closed the tab, lost
 *     the network, or its confirming action failed. Harmless but permanent:
 *     nothing else will ever revisit that row.
 *
 *   Bytes, no row — the object landed and the confirmation never arrived, or
 *     the file was refused and the cleanup failed. This one costs money. No
 *     query in the product can see the object, no user can delete it, and it
 *     counts against the storage quota forever.
 *
 * The schema has said `UploadState` exists for this since Phase 1. What it
 * lacked was anything that acted on it.
 *
 * ─ Who it acts as ─────────────────────────────────────────────────────────
 *
 * Nobody is making this request, so it follows the shape /tasks/purge-accounts
 * established: SECURITY DEFINER functions do the LISTING, returning ids and
 * paths and nothing else, and each row is then acted on under its own owner's
 * claim through `withUserContext` — the same UPDATE that user's own browser
 * would make, under the same policies.
 *
 * The secret key is used for exactly two things that no user can do: looking
 * at an object belonging to a project the caller is not in, and deleting an
 * orphan that by definition has no owner left to ask.
 *
 * ─ Authentication ─────────────────────────────────────────────────────────
 *
 * `CRON_SECRET`, compared in constant time, exactly as /tasks/purge-accounts
 * does — Vercel attaches `Authorization: Bearer <value>` to a cron invocation
 * only for a variable spelled precisely that. Unset, the endpoint is closed
 * rather than open, which is the state a fresh install starts in.
 */
async function reconcile(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured, so this endpoint is closed." },
      { status: 503 },
    );
  }

  const offered = request.headers.get("authorization") ?? "";
  if (!timingSafeEqual(offered, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();

  const completed: string[] = [];
  const abandoned: string[] = [];
  let deleted = 0;

  // ── Rows whose bytes never arrived ────────────────────────────────────────
  let pending: PendingUpload[];
  try {
    pending = await listStalePending();
  } catch {
    return NextResponse.json(
      { error: "Could not list pending uploads." },
      { status: 500 },
    );
  }

  for (const row of pending) {
    const projectId = row.storage_path.split("/")[0] ?? "";
    const fileId = row.id;

    /*
     * Look before deciding. A PENDING row says the app lost track of an
     * upload, not that the upload failed — the bytes may well be sitting
     * there, complete and correct, because only the confirming call was lost.
     * Marking those ORPHANED would throw away a real person's real file to
     * tidy up a status column.
     */
    const object = await inspectPaperObject(admin, projectId, fileId);

    if (object?.acceptable) {
      // Under the owner's own claim: the same update their browser would have
      // made had the confirmation arrived.
      await withUserContext({ sub: row.owner_id }, (tx) =>
        tx.fileObject.updateMany({
          where: { id: row.id, uploadState: "PENDING" },
          data: {
            uploadState: "COMPLETE",
            sizeBytes: object.sizeBytes,
            mimeType: object.mimeType,
            etag: object.etag,
          },
        }),
      );
      completed.push(row.id);
      continue;
    }

    // Present but not a PDF, or truncated: the bytes go, because they were
    // never going to be accepted and nothing else will revisit them.
    if (object) await discardPaperObject(admin, row.storage_path);

    await withUserContext({ sub: row.owner_id }, (tx) =>
      tx.fileObject.updateMany({
        where: { id: row.id, uploadState: "PENDING" },
        data: { uploadState: "ORPHANED" },
      }),
    );
    abandoned.push(row.id);
  }

  // ── Bytes whose row never arrived ─────────────────────────────────────────
  //
  // An anti-join against storage.objects, which is only possible because the
  // bucket is a Postgres table. The R2 design would have paginated a bucket
  // listing and joined it in application memory.
  let orphans: string[];
  try {
    orphans = await listOrphanObjects();
  } catch {
    return NextResponse.json(
      { error: "Could not list orphaned objects.", completed: completed.length },
      { status: 500 },
    );
  }

  if (orphans.length > 0) {
    const { data, error } = await admin.storage.from(PAPER_BUCKET).remove(orphans);
    // Reported rather than thrown: the pending sweep above already succeeded
    // and its work is worth keeping. A failure here costs storage, not
    // correctness, and tomorrow's run finds the same objects still unclaimed.
    if (error) {
      return NextResponse.json(
        {
          completed: completed.length,
          abandoned: abandoned.length,
          orphans_deleted: 0,
          error: `Could not delete orphaned objects: ${error.message}`,
        },
        { status: 500 },
      );
    }
    deleted = data?.length ?? 0;
  }

  return NextResponse.json({
    completed: completed.length,
    abandoned: abandoned.length,
    orphans_deleted: deleted,
  });
}

interface PendingUpload {
  id: string;
  owner_id: string;
  bucket: string;
  storage_path: string;
}

/**
 * The NIL uuid, again.
 *
 * `withUserContext` requires a claim and there is no user here. NIL matches
 * nobody, so every policy this transaction touches evaluates false and the
 * only thing it can reach is the definer function itself.
 */
const NOBODY = "00000000-0000-0000-0000-000000000000";

async function listStalePending(): Promise<PendingUpload[]> {
  return withUserContext(
    { sub: NOBODY },
    (tx) => tx.$queryRaw<PendingUpload[]>`select * from public.stale_pending_uploads()`,
  );
}

async function listOrphanObjects(): Promise<string[]> {
  const rows = await withUserContext(
    { sub: NOBODY },
    (tx) =>
      tx.$queryRaw<
        Array<{ name: string }>
      >`select * from public.orphaned_paper_objects()`,
  );
  return rows.map((row) => row.name);
}

/**
 * Constant time, so the comparison does not leak the secret one byte at a time.
 *
 * Written out rather than imported from `node:crypto` for the same reason as
 * in /tasks/purge-accounts: this may run on the edge runtime, where
 * `timingSafeEqual` is not available.
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
 * GET is what Vercel Cron sends; POST is for a self-hosted operator running it
 * by hand. Both are idempotent: a second run finds the rows already COMPLETE
 * or ORPHANED and the orphans already gone, and every update is bounded by
 * `uploadState: "PENDING"` so it cannot re-decide a row it already settled.
 */
export const GET = reconcile;
export const POST = reconcile;
