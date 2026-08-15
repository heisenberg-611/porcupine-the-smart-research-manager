"use server";

import {
  federatedSearch,
  PROVIDER_IDS,
  rankWorks,
  type ScoredWork,
} from "@porcupine/discovery";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";
import { rateLimiter } from "@/server/discovery";

import type { ActionResult } from "../../actions";

const SearchInput = z.object({
  projectId: z.uuid(),
  terms: z.string().trim().min(2, "Enter at least two characters.").max(300),
  fromYear: z.coerce.number().int().min(1400).max(2200).optional(),
  toYear: z.coerce.number().int().min(1400).max(2200).optional(),
  providers: z.array(z.enum(PROVIDER_IDS)).min(1).optional(),
});

export interface SearchResults {
  ranked: ScoredWork[];
  counts: { provider: string; count: number }[];
  failures: Array<{ provider: string; message: string }>;
  /** Identifiers already in this project, so the UI can mark them. */
  alreadyAdded: string[];
  keywords: string[];
}

/**
 * Search every provider and rank the merged results against the project's
 * research questions.
 *
 * Runs as a server action rather than a route handler because the result is
 * rendered, not consumed by a third party — and because it keeps the
 * provider fan-out, which carries no user data outbound, off any public URL.
 */
export async function searchWorks(
  input: z.input<typeof SearchInput>,
): Promise<ActionResult<SearchResults>> {
  const parsed = SearchInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid search." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, terms, fromYear, toYear, providers } = parsed.data;

  if (fromYear && toYear && fromYear > toYear) {
    return { ok: false, error: "The start year is after the end year." };
  }

  // Membership is enforced by RLS, not by a check here: if the caller is not
  // a member, the query below returns nothing and we stop. Doing it this way
  // means there is no second, divergent copy of the authorization rule.
  const context = await withUserContext(claims, async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) return null;

    const [questions, existing] = await Promise.all([
      tx.question.findMany({
        where: { projectId },
        select: { keywords: true, text: true },
      }),
      tx.projectWork.findMany({
        where: { projectId },
        select: {
          work: { select: { doi: true, arxivId: true, openalexId: true, pmid: true } },
        },
      }),
    ]);

    return { questions, existing };
  });

  if (!context) return { ok: false, error: "Project not found." };

  // Keywords seed the ranking. Question text is included as a fallback so a
  // project that wrote questions but never tagged them still gets ordering
  // better than "whatever the providers returned first".
  const keywords = [
    ...new Set(
      context.questions.flatMap((q) => [
        ...q.keywords,
        ...q.text.split(/\s+/).filter((w) => w.length > 5),
      ]),
    ),
  ];

  const { works, counts, failures } = await federatedSearch(
    {
      terms,
      ...(fromYear !== undefined ? { fromYear } : {}),
      ...(toYear !== undefined ? { toYear } : {}),
      limit: 25,
    },
    {
      limiter: rateLimiter,
      ...(providers ? { providers } : {}),
    },
  );

  const alreadyAdded = context.existing.flatMap(({ work }) =>
    [work.doi, work.arxivId, work.openalexId, work.pmid].filter(
      (id): id is string => !!id,
    ),
  );

  return {
    ok: true,
    data: { ranked: rankWorks(works, keywords), counts, failures, alreadyAdded, keywords },
  };
}

const AddWorkInput = z.object({
  projectId: z.uuid(),
  work: z.object({
    doi: z.string().nullish(),
    arxivId: z.string().nullish(),
    openalexId: z.string().nullish(),
    pmid: z.string().nullish(),
    title: z.string().min(1),
    abstract: z.string().nullish(),
    authors: z.array(z.unknown()),
    venue: z.string().nullish(),
    publishedYear: z.number().int().nullish(),
    publishedOn: z.string().nullish(),
    type: z.string().nullish(),
    language: z.string().nullish(),
    oaStatus: z.string().nullish(),
    oaPdfUrl: z.string().nullish(),
    citedByCount: z.number().int(),
    referencedWorks: z.array(z.string()),
  }),
});

/**
 * Add a search result to the project's corpus.
 *
 * The `Work` row is created through `upsert_work()` — the SECURITY DEFINER
 * function that is the only write path into the global bibliography. The
 * `ProjectWork` row is an ordinary RLS-governed insert, so a REVIEWER or
 * OBSERVER attempting this gets nothing.
 *
 * Both happen in one transaction: a `Work` with no `ProjectWork` is a row
 * nobody asked for, sitting in a table shared by every tenant.
 */
export async function addWorkToProject(
  input: z.input<typeof AddWorkInput>,
): Promise<ActionResult<{ projectWorkId: string }>> {
  const parsed = AddWorkInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid work." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, work } = parsed.data;

  try {
    const projectWorkId = await withUserContext(claims, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ upsert_work: string }>>`
        select public.upsert_work(${JSON.stringify(work)}::jsonb)
      `;
      const workId = rows[0]?.upsert_work;
      if (!workId) throw new Error("upsert_work returned no id");

      const existing = await tx.projectWork.findUnique({
        where: { projectId_workId: { projectId, workId } },
        select: { id: true },
      });
      if (existing) return existing.id;

      const created = await tx.projectWork.create({
        data: {
          projectId,
          workId,
          addedBy: claims.sub,
          source: "search",
        },
        select: { id: true },
      });
      return created.id;
    });

    revalidatePath(`/projects/${projectId}`);
    return { ok: true, data: { projectWorkId } };
  } catch {
    // The most likely cause is the RLS policy refusing the insert — a
    // REVIEWER or OBSERVER trying to change the corpus. Say what happened
    // without leaking whether the project exists.
    return { ok: false, error: "Could not add this paper. You may not have permission." };
  }
}
