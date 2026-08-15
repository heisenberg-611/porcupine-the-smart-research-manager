import { resolveAnchor } from "@porcupine/anchoring";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Banner, PageHeader } from "@/components/ui";
import { SourceLinks } from "@/components/source-links";
import { must } from "@/lib/supabase/query";
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
  searchParams,
}: {
  params: Promise<{ id: string; workId: string }>;
  searchParams: Promise<{ anchor?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id, workId } = await params;
  const { anchor: focusAnchorId } = await searchParams;
  const supabase = await createClient();

  const projectWork = await must(
    supabase
      .from("project_works")
      .select(
        "id, project_id, screen_status, projects(title), works(title, abstract, doi, arxiv_id, pmid, oa_pdf_url, venue, published_year)",
      )
      .eq("id", workId)
      .eq("project_id", id)
      .maybeSingle(),
    "the paper",
  );

  if (!projectWork) notFound();

  const work = (
    projectWork as unknown as {
      works: {
        title: string;
        abstract: string | null;
        doi: string | null;
        arxiv_id: string | null;
        pmid: string | null;
        oa_pdf_url: string | null;
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

  /*
   * 4.3 · Arriving here from a cell in the evidence table.
   *
   * The anchor is re-resolved against the current text like every other one.
   * That is the point: an evidence cell whose passage no longer exists must
   * SAY so. Sending someone to a paper and silently showing them the top of it
   * is worse than not linking at all — they conclude the quote is there and
   * they simply cannot see it.
   *
   * Fetched separately from the annotations above because an extraction's
   * anchor need not have an annotation attached; the tables are independent.
   */
  const focusAnchor = focusAnchorId
    ? await must(
        supabase
          .from("anchors")
          .select("id, quote, prefix, suffix, start_off, end_off, page")
          .eq("id", focusAnchorId)
          .eq("project_id", id)
          .maybeSingle(),
        "the passage",
      )
    : null;

  const focus = focusAnchor
    ? resolveAnchor(
        {
          quote: focusAnchor.quote,
          prefix: focusAnchor.prefix ?? undefined,
          suffix: focusAnchor.suffix ?? undefined,
          startOff: focusAnchor.start_off ?? undefined,
          endOff: focusAnchor.end_off ?? undefined,
          page: focusAnchor.page ?? undefined,
        },
        text,
      )
    : null;

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}/library`}
        backLabel={projectTitle}
        title={work?.title ?? "Untitled"}
        description={
          <>
            {work?.venue}
            {work?.published_year && ` · ${work.published_year}`}
            {/* The DOI used to be printed here as the bare text "doi:10.1234/x".
                It is an address; it should behave like one. */}
            <SourceLinks
              className="mt-2"
              title={work?.title ?? "this paper"}
              work={{
                doi: work?.doi,
                arxivId: work?.arxiv_id,
                pmid: work?.pmid,
                oaPdfUrl: work?.oa_pdf_url,
              }}
            />
          </>
        }
      />

      {/* Three outcomes, three different things to say. The failure cases are
          the ones that matter: both are silent by default. */}
      {focusAnchorId && !focusAnchor && (
        <Banner tone="danger">
          That passage no longer exists. The evidence cell that linked here points at a
          highlight that has since been deleted.
        </Banner>
      )}

      {focus?.status === "BROKEN" && (
        <Banner tone="danger">
          <strong>This passage could not be found in the current text.</strong> The
          evidence recorded against it quoted “{focusAnchor?.quote}”, but the document has
          changed since. The extraction still stands; its source no longer resolves.
        </Banner>
      )}

      {focus?.status === "DRIFTED" && (
        <Banner>
          The wording here has changed slightly since this evidence was recorded. Showing
          the closest match.
        </Banner>
      )}

      {focus?.status === "OK" && (
        <Banner>
          Showing the passage this evidence came from: “{focusAnchor?.quote}”
        </Banner>
      )}

      {!text && (
        <p className="border-border text-muted text-ui rounded-lg border border-dashed p-6 text-center">
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
