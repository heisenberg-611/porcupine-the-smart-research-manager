"use server";

import { dedupe, parseImport, resolveIdentifiers } from "@Porcupine/discovery";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";
import { rateLimiter } from "@/server/discovery";

import type { ActionResult } from "../../actions";

/**
 * A paste is capped at 400 KB and 500 records.
 *
 * Both limits exist because this runs in a request, not a job. A 5,000-entry
 * BibTeX file is a legitimate thing to own and an illegitimate thing to
 * import synchronously — it would resolve thousands of DOIs against
 * rate-limited providers and time out somewhere in the middle, having
 * written an arbitrary prefix. Saying no with a number is better than
 * failing halfway.
 *
 * Bulk import as a queued job with progress is Phase 2 work (R-22 gives us
 * pgmq for exactly this).
 */
const MAX_BYTES = 400 * 1024;
const MAX_RECORDS = 500;

const ImportInput = z.object({
  projectId: z.uuid(),
  source: z.string().trim().min(1, "Paste something to import."),
});

export interface ImportPreview {
  format: string;
  /** Ready to add, already deduplicated against each other. */
  works: Array<{
    title: string;
    authors: string;
    venue: string | null;
    year: number | null;
    doi: string | null;
    arxivId: string | null;
  }>;
  problems: string[];
}

export interface ImportOutcome {
  added: number;
  alreadyPresent: number;
  problems: string[];
}

/**
 * Parse and resolve, without writing anything.
 *
 * A preview step exists because import is the operation users are most
 * nervous about: a bad paste that silently adds 200 wrong papers to a shared
 * corpus is worse than one that adds nothing. Seeing the list first makes it
 * a decision rather than a gamble.
 */
export async function previewImport(
  input: z.input<typeof ImportInput>,
): Promise<ActionResult<ImportPreview>> {
  const parsed = ImportInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, source } = parsed.data;
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) {
    return {
      ok: false,
      error: `That is larger than ${MAX_BYTES / 1024} KB. Import it in parts.`,
    };
  }

  // Authorize BEFORE touching any provider.
  //
  // Preview writes nothing, so it is tempting to skip this — but it does make
  // outbound calls to OpenAlex, Crossref and arXiv, spending the shared token
  // bucket (R-22). Without a membership check, any signed-in user could pass
  // any project id and use the server as a free proxy to those APIs, and the
  // cost lands on every other project's rate limit. The write path is
  // protected by RLS; this path has to say so explicitly.
  const member = await withUserContext(claims, async (tx) =>
    tx.project.findUnique({ where: { id: projectId }, select: { id: true } }),
  );
  if (!member) return { ok: false, error: "Project not found." };

  const result = parseImport(source);
  const problems = [...result.problems];

  let works = result.entries;

  const lookupCount = result.lookups.dois.length + result.lookups.arxivIds.length;
  if (works.length + lookupCount > MAX_RECORDS) {
    return {
      ok: false,
      error: `That is ${works.length + lookupCount} records; the limit is ${MAX_RECORDS} at a time.`,
    };
  }

  if (lookupCount > 0) {
    const resolved = await resolveIdentifiers(result.lookups, rateLimiter);
    works = [...works, ...resolved.works];
    problems.push(...resolved.problems);
  }

  if (works.length === 0 && problems.length === 0) {
    return { ok: false, error: "Nothing recognizable in that text." };
  }

  // Dedupe within the paste itself: exported bibliographies routinely list
  // the same paper twice, once as a preprint and once as published.
  const merged = dedupe(works);

  return {
    ok: true,
    data: {
      format: result.format,
      problems,
      works: merged.map((work) => ({
        title: work.title,
        authors: work.authors
          .slice(0, 3)
          .map((a) => a.name)
          .join(", "),
        venue: work.venue ?? null,
        year: work.publishedYear ?? null,
        doi: work.doi ?? null,
        arxivId: work.arxivId ?? null,
      })),
    },
  };
}

/**
 * Parse, resolve, and write.
 *
 * Re-parses rather than trusting a preview payload sent back from the
 * browser: accepting a client-supplied list of works would let anyone post
 * arbitrary rows into the global `works` table, which is precisely what
 * `upsert_work()` exists to prevent. The extra parse is cheap and the
 * provider responses are cached.
 */
export async function commitImport(
  input: z.input<typeof ImportInput>,
): Promise<ActionResult<ImportOutcome>> {
  const parsed = ImportInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, source } = parsed.data;
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) {
    return {
      ok: false,
      error: `That is larger than ${MAX_BYTES / 1024} KB. Import it in parts.`,
    };
  }

  const result = parseImport(source);
  const problems = [...result.problems];
  let works = result.entries;

  if (result.lookups.dois.length + result.lookups.arxivIds.length > 0) {
    const resolved = await resolveIdentifiers(result.lookups, rateLimiter);
    works = [...works, ...resolved.works];
    problems.push(...resolved.problems);
  }

  const merged = dedupe(works);
  if (merged.length === 0) {
    return { ok: false, error: "Nothing recognizable in that text." };
  }
  if (merged.length > MAX_RECORDS) {
    return {
      ok: false,
      error: `That is ${merged.length} records; the limit is ${MAX_RECORDS}.`,
    };
  }

  let added = 0;
  let alreadyPresent = 0;
  // Records the paste contained before dedupe merged any of them. PRISMA
  // reports what was submitted, not what survived.
  const submitted = works.length;
  const dedupedWithinBatch = works.length - merged.length;

  try {
    await withUserContext(claims, async (tx) => {
      for (const work of merged) {
        const rows = await tx.$queryRaw<Array<{ upsert_work: string }>>`
          select public.upsert_work(${JSON.stringify(work)}::jsonb)
        `;
        const workId = rows[0]?.upsert_work;
        if (!workId) continue;

        const existing = await tx.projectWork.findUnique({
          where: { projectId_workId: { projectId, workId } },
          select: { id: true },
        });

        if (existing) {
          alreadyPresent++;
          continue;
        }

        await tx.projectWork.create({
          data: { projectId, workId, addedBy: claims.sub, source: result.format },
          select: { id: true },
        });
        added++;
      }

      // Inside the same transaction as the rows it describes. A batch record
      // that could disagree with the library is worse than none: it goes into
      // a PRISMA diagram and then into a published methods section.
      await tx.importBatch.create({
        data: {
          projectId,
          importedBy: claims.sub,
          format: result.format,
          submitted,
          deduplicated: dedupedWithinBatch,
          alreadyPresent,
          added,
        },
        select: { id: true },
      });
    });
  } catch {
    // One transaction for the whole paste: a partial import leaves the user
    // unsure what landed, and re-running it is then ambiguous rather than
    // idempotent.
    return {
      ok: false,
      error:
        "Could not import. You may not have permission to add papers to this project.",
    };
  }

  revalidatePath(`/projects/${projectId}/library`);
  revalidatePath(`/projects/${projectId}/prisma`);
  return { ok: true, data: { added, alreadyPresent, problems } };
}
