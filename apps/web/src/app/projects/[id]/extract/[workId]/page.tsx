import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { EmptyState, ButtonLink, PageHeader } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { StartExtraction } from "./start-extraction";
import { ExtractClient, type ExtractField, type ExistingValue } from "./extract-client";

export const metadata: Metadata = { title: "Extract" };

export default async function ExtractPage({
  params,
}: {
  params: Promise<{ id: string; workId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id, workId } = await params;
  const supabase = await createClient();

  const projectWork = await must(
    supabase
      .from("project_works")
      .select(
        "id, project_id, projects(title), works(title, abstract, venue, published_year)",
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
        venue: string | null;
        published_year: number | null;
      } | null;
    }
  ).works;
  const projectTitle =
    (projectWork as unknown as { projects: { title: string } | null }).projects?.title ??
    "Project";

  const protocols = await must(
    supabase
      .from("protocols")
      .select(
        "id, name, version, protocol_fields(id, key, label, type, required, requires_anchor, help_text, options, order)",
      )
      .eq("project_id", id)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1),
    "the protocol",
  );

  const protocol = (
    (protocols ?? []) as unknown as Array<{
      id: string;
      name: string;
      version: number;
      protocol_fields: Array<{
        id: string;
        key: string;
        label: string;
        type: string;
        required: boolean;
        requires_anchor: boolean;
        help_text: string | null;
        options: unknown;
        order: number;
      }>;
    }>
  )[0];

  const header = (
    <PageHeader
      backHref={`/projects/${id}/library`}
      backLabel={projectTitle}
      title={work?.title ?? "Untitled"}
      description={
        <>
          {work?.venue}
          {work?.published_year && ` · ${work.published_year}`}
        </>
      }
    />
  );

  if (!protocol) {
    return (
      <main id="main" className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        {header}
        <EmptyState
          title="No protocol yet"
          description="Extraction needs a protocol — the set of questions asked of every paper. An owner or admin sets one up once, and it applies to the whole review."
          action={
            <ButtonLink href={`/projects/${id}/protocol`} variant="primary">
              Set up the protocol
            </ButtonLink>
          }
        />
      </main>
    );
  }

  const fields: ExtractField[] = [...(protocol.protocol_fields ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((f) => ({
      id: f.id,
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      requiresAnchor: f.requires_anchor,
      helpText: f.help_text,
      options: Array.isArray(f.options) ? (f.options as string[]) : [],
    }));

  // Only this person's extraction. Everyone can READ every extraction, but the
  // form edits yours — dual extraction is two rows by two people, never one
  // row edited twice.
  const mine = await must(
    supabase
      .from("extractions")
      .select("id, status")
      .eq("project_work_id", workId)
      .eq("protocol_id", protocol.id)
      .eq("extractor_id", user.id)
      .maybeSingle(),
    "your extraction",
  );

  const extraction = mine as { id: string; status: string } | null;

  if (!extraction) {
    return (
      <main id="main" className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        {header}
        <StartExtraction
          projectId={id}
          projectWorkId={workId}
          protocolId={protocol.id}
          protocolName={`${protocol.name} v${protocol.version}`}
          fieldCount={fields.length}
        />
      </main>
    );
  }

  const valueRows = await must(
    supabase
      .from("extraction_values")
      .select("field_id, value, value_text, anchors(quote)")
      .eq("extraction_id", extraction.id),
    "your answers",
  );

  const existing: ExistingValue[] = (
    (valueRows ?? []) as unknown as Array<{
      field_id: string;
      value: unknown;
      value_text: string | null;
      anchors: { quote: string } | null;
    }>
  ).map((v) => ({
    fieldId: v.field_id,
    value: v.value,
    valueText: v.value_text,
    quote: v.anchors?.quote ?? null,
  }));

  return (
    <main id="main" className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
      {header}
      <ExtractClient
        projectId={id}
        projectWorkId={workId}
        extractionId={extraction.id}
        status={extraction.status}
        text={work?.abstract ?? ""}
        fields={fields}
        existing={existing}
      />
    </main>
  );
}
