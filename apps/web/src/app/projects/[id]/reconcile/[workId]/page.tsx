import { capabilities, type ProjectKind } from "@Porcupine/shared";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { ReconcileClient, type ComparisonRow } from "./reconcile-client";

export const metadata: Metadata = { title: "Reconcile paper" };

interface DisagreementRow {
  project_work_id: string;
  protocol_id: string;
  extraction_a: string;
  extraction_b: string;
  extractor_a: string;
  extractor_b: string;
  field_id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  field_order: number;
  value_a: unknown;
  text_a: string | null;
  anchor_a: string | null;
  value_b: unknown;
  text_b: string | null;
  anchor_b: string | null;
  agree: boolean;
  answered_by_either: boolean;
}

export default async function ReconcilePaperPage({
  params,
}: {
  params: Promise<{ id: string; workId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id, workId } = await params;
  const supabase = await createClient();

  const project = await must(
    supabase.from("projects").select("id, title, kind").eq("id", id).maybeSingle(),
    "the project",
  );
  if (!project) notFound();

  if (!capabilities(project.kind as ProjectKind).dualExtraction) {
    redirect(`/projects/${id}/reconcile`);
  }

  const rows = (await must(
    supabase
      .from("v_extraction_disagreements")
      .select(
        "project_work_id, protocol_id, extraction_a, extraction_b, extractor_a, extractor_b, field_id, field_key, field_label, field_type, field_order, value_a, text_a, anchor_a, value_b, text_b, anchor_b, agree, answered_by_either",
      )
      .eq("project_id", id)
      .eq("project_work_id", workId)
      .order("field_order", { ascending: true }),
    "the two readings",
  )) as unknown as DisagreementRow[];

  const paper = await must(
    supabase
      .from("project_works")
      .select("id, works(title)")
      .eq("id", workId)
      .eq("project_id", id)
      .maybeSingle(),
    "the paper",
  );
  if (!paper) notFound();

  const title =
    (paper as unknown as { works: { title: string } | null }).works?.title ?? "Untitled";

  if (rows.length === 0) {
    return (
      <main id="main" className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
        <PageHeader
          backHref={`/projects/${id}/reconcile`}
          backLabel="Reconcile"
          title={title}
        />
        <EmptyState
          title="This paper has not been extracted twice"
          description="Two different people each need to submit an extraction before there is anything to compare."
          action={
            <ButtonLink href={`/projects/${id}/reconcile`} variant="primary">
              Back to the queue
            </ButtonLink>
          }
        />
      </main>
    );
  }

  const head = rows[0]!;

  // Names for the two columns. A reconciliation screen that says "Extractor A"
  // and "Extractor B" makes the reviewer hold a mapping in their head while
  // making a judgement, which is exactly when they should not have to.
  const extractorIds = [...new Set([head.extractor_a, head.extractor_b])];
  const people = (await must(
    supabase.from("users").select("id, display_name").in("id", extractorIds),
    "the extractors",
  )) as unknown as Array<{ id: string; display_name: string }>;
  const names = new Map(people.map((p) => [p.id, p.display_name]));

  const existing = await must(
    supabase
      .from("extractions")
      .select("id, status, verified_by")
      .eq("project_work_id", workId)
      .in("status", ["RECONCILED", "VERIFIED"])
      .maybeSingle(),
    "any existing reconciliation",
  );

  const comparisons: ComparisonRow[] = rows.map((row) => ({
    fieldId: row.field_id,
    fieldKey: row.field_key,
    label: row.field_label,
    type: row.field_type,
    valueA: row.value_a,
    textA: row.text_a,
    anchorA: row.anchor_a,
    valueB: row.value_b,
    textB: row.text_b,
    anchorB: row.anchor_b,
    agree: row.agree,
    answeredByEither: row.answered_by_either,
  }));

  // The verifier must be a third person. Saying so before they start beats a
  // refusal after they have worked through twenty fields.
  const isParty = head.extractor_a === user.id || head.extractor_b === user.id;

  return (
    <main id="main" className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}/reconcile`}
        backLabel="Reconcile"
        title={title}
        description={
          <>
            {names.get(head.extractor_a) ?? "Extractor A"} and{" "}
            {names.get(head.extractor_b) ?? "Extractor B"} each read this paper
          </>
        }
      />

      <ReconcileClient
        projectId={id}
        projectWorkId={workId}
        protocolId={head.protocol_id}
        extractionA={head.extraction_a}
        extractionB={head.extraction_b}
        nameA={names.get(head.extractor_a) ?? "Extractor A"}
        nameB={names.get(head.extractor_b) ?? "Extractor B"}
        rows={comparisons}
        isParty={isParty}
        alreadyReconciled={!!existing}
      />
    </main>
  );
}
