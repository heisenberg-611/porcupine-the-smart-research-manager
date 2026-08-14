import { resolveAnchor } from "@porcupine/anchoring";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { ReaderClient, type RenderedAnnotation } from "./reader-client";

export const metadata: Metadata = { title: "Read" };

interface AnnotationRow {
  id: string;
  kind: string;
  body: string | null;
  visibility: string;
  author_id: string;
  deleted_at: string | null;
  anchors: {
    quote: string;
    prefix: string | null;
    suffix: string | null;
    start_off: number | null;
    end_off: number | null;
    page: number | null;
  } | null;
}

export default async function ReadPage({
  params,
}: {
  params: Promise<{ id: string; workId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id, workId } = await params;
  const supabase = await createClient();

  const { data: projectWork } = await supabase
    .from("project_works")
    .select(
      "id, project_id, screen_status, projects(title), works(title, abstract, doi, venue, published_year)",
    )
    .eq("id", workId)
    .eq("project_id", id)
    .maybeSingle();

  if (!projectWork) notFound();

  const work = (
    projectWork as unknown as {
      works: {
        title: string;
        abstract: string | null;
        doi: string | null;
        venue: string | null;
        published_year: number | null;
      } | null;
    }
  ).works;
  const projectTitle =
    (projectWork as unknown as { projects: { title: string } | null }).projects?.title ??
    "Project";

  /**
   * The passage under annotation.
   *
   * For now this is the abstract. Full PDF text needs the file pipeline —
   * presigned upload to R2 and text extraction — which is not built yet, so
   * rendering a PDF here would be a shell with nothing in it. The anchoring
   * engine does not care which text it is given, so this path does not change
   * when the PDF arrives; only the source of `text` does.
   */
  const text = work?.abstract ?? "";

  // No embed of the author here: `annotations.author_id` has no foreign key
  // to `users`, so PostgREST cannot join it — asking for one makes the WHOLE
  // query fail, and an ignored error renders as "0 annotations", which looks
  // exactly like having none. Names are fetched separately below.
  const { data: annotationData, error: annotationError } = await supabase
    .from("annotations")
    .select(
      "id, kind, body, visibility, author_id, deleted_at, anchors(quote, prefix, suffix, start_off, end_off, page)",
    )
    .eq("project_work_id", workId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  // Fail loudly. Silently showing an empty list would hide both a broken
  // query and a genuine RLS denial behind the same blank page.
  if (annotationError) {
    throw new Error(`Could not load annotations: ${annotationError.message}`);
  }

  const authorIds = [
    ...new Set(
      ((annotationData ?? []) as Array<{ author_id: string }>).map((a) => a.author_id),
    ),
  ];
  const { data: authorData } = authorIds.length
    ? await supabase.from("users").select("id, display_name").in("id", authorIds)
    : { data: [] };

  const authorNames = new Map(
    ((authorData ?? []) as Array<{ id: string; display_name: string }>).map((u) => [
      u.id,
      u.display_name,
    ]),
  );

  // Re-resolve every anchor against the CURRENT text rather than trusting the
  // stored offsets. This is the payoff of the anchoring engine: a passage that
  // has changed since it was highlighted gets flagged instead of being drawn
  // somewhere plausible and wrong.
  const annotations: RenderedAnnotation[] = (
    (annotationData ?? []) as unknown as AnnotationRow[]
  )
    .filter((row) => row.anchors)
    .map((row) => {
      const anchor = row.anchors!;
      const resolution = resolveAnchor(
        {
          quote: anchor.quote,
          prefix: anchor.prefix ?? undefined,
          suffix: anchor.suffix ?? undefined,
          startOff: anchor.start_off ?? undefined,
          endOff: anchor.end_off ?? undefined,
          page: anchor.page ?? undefined,
        },
        text,
      );

      return {
        id: row.id,
        kind: row.kind,
        body: row.body,
        visibility: row.visibility,
        authorName: authorNames.get(row.author_id) ?? "Unknown",
        isMine: row.author_id === user.id,
        status: resolution.status,
        start: resolution.status === "BROKEN" ? null : resolution.start,
        end: resolution.status === "BROKEN" ? null : resolution.end,
        quote: anchor.quote,
        driftReason: resolution.status === "OK" ? null : resolution.reason,
        similarity: resolution.status === "DRIFTED" ? resolution.similarity : null,
      };
    });

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div>
        <Link
          href={`/projects/${id}/library`}
          className="text-muted hover:text-ink text-sm"
        >
          ← {projectTitle}
        </Link>
        <h1 className="text-ink mt-2 text-2xl font-semibold">
          {work?.title ?? "Untitled"}
        </h1>
        <p className="text-muted mt-1 text-sm">
          {work?.venue}
          {work?.published_year && ` · ${work.published_year}`}
          {work?.doi && ` · doi:${work.doi}`}
        </p>
      </div>

      {!text && (
        <p className="border-border text-muted rounded-lg border border-dashed p-6 text-center text-sm">
          This record has no abstract, so there is no text to annotate yet. Full-text
          reading arrives with the file pipeline.
        </p>
      )}

      {/* The reader renders whenever there is text OR existing annotations.
          Gating it on text alone made every annotation on an abstract-less
          record vanish from the page — indistinguishable from having been
          deleted, when in fact the rows were there the whole time and every
          anchor had simply resolved to BROKEN against an empty document. */}
      {(text || annotations.length > 0) && (
        <ReaderClient
          projectId={id}
          projectWorkId={workId}
          text={text}
          annotations={annotations}
        />
      )}
    </main>
  );
}
