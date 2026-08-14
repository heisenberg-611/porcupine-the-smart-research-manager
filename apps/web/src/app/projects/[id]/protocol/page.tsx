import { capabilities, type ProjectKind } from "@porcupine/shared";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { ProtocolClient, type Protocol } from "./protocol-client";

export const metadata: Metadata = { title: "Protocol" };

interface ProtocolRow {
  id: string;
  name: string;
  version: number;
  is_active: boolean;
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
}

export default async function ProtocolPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { id } = await params;
  const supabase = await createClient();

  const project = await must(
    supabase.from("projects").select("id, title, kind").eq("id", id).maybeSingle(),
    "the project",
  );
  if (!project) notFound();

  const protocolRows = await must(
    supabase
      .from("protocols")
      .select(
        "id, name, version, is_active, protocol_fields(id, key, label, type, required, requires_anchor, help_text, options, order)",
      )
      .eq("project_id", id)
      .order("version", { ascending: false }),
    "the protocol",
  );

  // Answer counts drive the whole editor: a field with answers cannot be
  // renamed or removed, and the UI says so BEFORE someone tries rather than
  // surfacing a database error after.
  const extractionRows = await must(
    supabase.from("extractions").select("id, protocol_id").eq("project_id", id),
    "recorded extractions",
  );

  const valueRows = await must(
    supabase.from("extraction_values").select("field_id").eq("project_id", id),
    "recorded answers",
  );

  const answersByField = new Map<string, number>();
  for (const row of (valueRows ?? []) as Array<{ field_id: string }>) {
    answersByField.set(row.field_id, (answersByField.get(row.field_id) ?? 0) + 1);
  }

  const extractionsByProtocol = new Map<string, number>();
  for (const row of (extractionRows ?? []) as Array<{ protocol_id: string }>) {
    extractionsByProtocol.set(
      row.protocol_id,
      (extractionsByProtocol.get(row.protocol_id) ?? 0) + 1,
    );
  }

  const protocols: Protocol[] = ((protocolRows ?? []) as unknown as ProtocolRow[]).map(
    (p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      isActive: p.is_active,
      extractionCount: extractionsByProtocol.get(p.id) ?? 0,
      fields: [...(p.protocol_fields ?? [])]
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
          answerCount: answersByField.get(f.id) ?? 0,
        })),
    }),
  );

  const membership = await must(
    supabase
      .from("project_members")
      .select("access_role")
      .eq("project_id", id)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle(),
    "your role on this project",
  );

  const role = (membership as { access_role?: string } | null)?.access_role;
  const canEdit = role === "OWNER" || role === "ADMIN";

  const caps = capabilities(project.kind as ProjectKind);

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Protocol"
        description={
          caps.protocolRequired
            ? "The questions this review asks of every paper. A systematic review is only reproducible if every row answered the same ones."
            : "The questions asked of every paper. Optional for a thesis — add fields only where a consistent answer is worth having."
        }
      />

      <ProtocolClient projectId={id} protocols={protocols} canEdit={canEdit} />
    </main>
  );
}
