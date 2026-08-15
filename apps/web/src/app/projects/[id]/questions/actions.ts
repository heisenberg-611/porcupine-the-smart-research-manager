"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "../../actions";

/**
 * The research questions, and the keywords that make search mean anything.
 *
 * This table has been read since Phase 1 — `search/actions.ts` scores every
 * result against these keywords, and the "why did this paper surface" chip is
 * built from the ones that matched — and written by nothing. There was no
 * form, no action, no route. The search page told people to add questions and
 * gave them nowhere to go, so the ranking has been scoring against an empty
 * set for its entire existence.
 *
 * Keywords are stored on the question rather than on the project because that
 * is what the ranking already consumes, and because a review with three
 * questions has three different vocabularies. Flattening them into one project
 * keyword list would rank a paper about the second question as though it
 * answered the first.
 */

const QuestionInput = z.object({
  projectId: z.uuid(),
  text: z
    .string()
    .trim()
    .min(1, "Write the question.")
    .max(500, "That is longer than a question; put the detail in the protocol."),
  keywords: z
    .array(z.string().trim().min(1).max(60))
    .max(30, "Thirty keywords is more than a ranking can use.")
    .default([]),
});

export interface QuestionRow {
  id: string;
  order: number;
  text: string;
  keywords: string[];
}

/** Any member may read. Ordering is the author's, not the database's. */
export async function listQuestions(
  projectId: string,
): Promise<ActionResult<QuestionRow[]>> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };
  if (!z.uuid().safeParse(projectId).success) {
    return { ok: false, error: "Invalid project." };
  }

  try {
    const rows = await withUserContext(claims, (tx) =>
      tx.question.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
        select: { id: true, order: true, text: true, keywords: true },
      }),
    );
    return { ok: true, data: rows };
  } catch {
    return { ok: false, error: "Could not load the questions." };
  }
}

export async function addQuestion(
  input: z.input<typeof QuestionInput>,
): Promise<ActionResult<QuestionRow>> {
  const parsed = QuestionInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Malformed question." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, text, keywords } = parsed.data;

  try {
    const created = await withUserContext(claims, async (tx) => {
      // Appended, not inserted. The order is the reviewer's argument about
      // their own review, so a new question goes where they put it — at the
      // end — rather than wherever a sort happens to place it.
      const last = await tx.question.findFirst({
        where: { projectId },
        orderBy: { order: "desc" },
        select: { order: true },
      });

      return tx.question.create({
        data: {
          projectId,
          order: (last?.order ?? 0) + 1,
          text,
          keywords: normalise(keywords),
        },
        select: { id: true, order: true, text: true, keywords: true },
      });
    });

    revalidatePath(`/projects/${projectId}/questions`);
    // The search page ranks against these and lists them as chips, so it is
    // stale the moment this returns.
    revalidatePath(`/projects/${projectId}/search`);
    return { ok: true, data: created };
  } catch {
    // RLS refuses a non-member. Nothing here distinguishes that from a write
    // failure, deliberately.
    return { ok: false, error: "Could not add the question." };
  }
}

export async function updateQuestion(
  input: z.input<typeof QuestionInput> & { questionId: string },
): Promise<ActionResult<QuestionRow>> {
  const parsed = QuestionInput.extend({ questionId: z.uuid() }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Malformed question." };
  }

  const { projectId, questionId, text, keywords } = parsed.data;
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  try {
    const updated = await withUserContext(claims, (tx) =>
      tx.question.update({
        // Scoped by project as well as id: an id alone would let a member of
        // one project edit another's question if they could guess a uuid, and
        // RLS is the backstop rather than the only check.
        where: { id: questionId, projectId },
        data: { text, keywords: normalise(keywords) },
        select: { id: true, order: true, text: true, keywords: true },
      }),
    );

    revalidatePath(`/projects/${projectId}/questions`);
    revalidatePath(`/projects/${projectId}/search`);
    return { ok: true, data: updated };
  } catch {
    return { ok: false, error: "Could not save the question." };
  }
}

export async function deleteQuestion(input: {
  projectId: string;
  questionId: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ projectId: z.uuid(), questionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid question." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, questionId } = parsed.data;

  try {
    await withUserContext(claims, (tx) =>
      tx.question.delete({ where: { id: questionId, projectId } }),
    );
    revalidatePath(`/projects/${projectId}/questions`);
    revalidatePath(`/projects/${projectId}/search`);
    return { ok: true, data: { id: questionId } };
  } catch {
    return { ok: false, error: "Could not remove the question." };
  }
}

/**
 * Trim, drop blanks, case-fold duplicates away, keep the author's casing.
 *
 * The ranking lowercases before matching, so "PICO" and "pico" score
 * identically — storing both would show the reviewer two chips that do the
 * same thing and let them believe they had covered more ground than they had.
 */
function normalise(keywords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const keyword = raw.trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  return out;
}
