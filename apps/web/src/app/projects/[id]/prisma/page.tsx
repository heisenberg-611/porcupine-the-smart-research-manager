import { capabilities, exclusionReasonLabel, type ProjectKind } from "@porcupine/shared";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { PrismaDiagram, type ExclusionRow, type PrismaCounts } from "./prisma-diagram";

export const metadata: Metadata = { title: "PRISMA" };

interface FlowRow {
  records_identified: number;
  records_removed_before_screening: number;
  records_screened: number;
  records_excluded: number;
  studies_included: number;
  records_pending: number;
}

export default async function PrismaPage({
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

  const flowRows = await must(
    supabase
      .from("v_prisma_flow")
      .select(
        "records_identified, records_removed_before_screening, records_screened, records_excluded, studies_included, records_pending",
      )
      .eq("project_id", id),
    "the PRISMA counts",
  );

  const flow = ((flowRows ?? []) as unknown as FlowRow[])[0];

  const exclusionRows = await must(
    supabase.from("v_prisma_exclusions").select("reason, count").eq("project_id", id),
    "exclusion reasons",
  );

  const counts: PrismaCounts = {
    recordsIdentified: flow?.records_identified ?? 0,
    recordsRemovedBeforeScreening: flow?.records_removed_before_screening ?? 0,
    recordsScreened: flow?.records_screened ?? 0,
    recordsExcluded: flow?.records_excluded ?? 0,
    studiesIncluded: flow?.studies_included ?? 0,
    recordsPending: flow?.records_pending ?? 0,
  };

  const exclusions = ((exclusionRows ?? []) as unknown as ExclusionRow[]).sort(
    (a, b) => b.count - a.count,
  );

  const caps = capabilities(project.kind as ProjectKind);

  return (
    <main id="main" className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="PRISMA 2020 flow"
        description={
          <>Derived from recorded screening decisions. Nothing here is estimated.</>
        }
      />

      {!caps.prismaDiagram && (
        <p className="border-border text-muted text-ui rounded-lg border border-dashed p-3">
          {/* R-06: the diagram is shown for any project kind, but only a
              systematic review is REQUIRED to report exclusion reasons — so
              for other kinds the exclusion box may legitimately be sparse. */}
          This project is not a systematic review, so exclusion reasons are optional and
          the diagram may be incomplete.
        </p>
      )}

      {counts.recordsScreened === 0 ? (
        <EmptyState
          title="No papers yet"
          description="The diagram appears once the library has records."
          action={
            <ButtonLink href={`/projects/${id}/library`}>Open the library</ButtonLink>
          }
        />
      ) : (
        <>
          <section className="border-border bg-surface rounded-lg border p-4">
            <PrismaDiagram
              counts={counts}
              exclusions={exclusions}
              projectTitle={project.title}
            />
          </section>

          {counts.recordsPending > 0 && (
            <p role="status" className="text-muted text-ui">
              <strong className="text-ink">{counts.recordsPending}</strong> records are
              still to be screened, so these numbers are not final. A diagram published
              now would be a snapshot of work in progress.
            </p>
          )}

          {/* The same figures as a table. A screen reader cannot follow arrows,
              and a methods section needs the numbers as text anyway. */}
          <section>
            <h2 className="text-ink text-heading mb-3 font-medium">The numbers</h2>
            <div className="border-border overflow-x-auto rounded-lg border">
              <table className="text-ui w-full text-left">
                <caption className="sr-only">PRISMA 2020 counts for this review</caption>
                <tbody className="divide-border divide-y">
                  <Row label="Records identified" value={counts.recordsIdentified} />
                  <Row
                    label="Records removed before screening (duplicates)"
                    value={counts.recordsRemovedBeforeScreening}
                  />
                  <Row label="Records screened" value={counts.recordsScreened} />
                  <Row label="Records excluded" value={counts.recordsExcluded} />
                  {exclusions.map((e) => (
                    <Row
                      key={e.reason}
                      label={`— ${exclusionReasonLabel(e.reason)}`}
                      value={e.count}
                      indented
                    />
                  ))}
                  <Row label="Studies included" value={counts.studiesIncluded} emphasis />
                </tbody>
              </table>
            </div>
          </section>

          <section className="border-border rounded-lg border border-dashed p-4">
            <h2 className="text-ink text-ui font-medium">Not tracked yet</h2>
            {/* Naming the gap rather than drawing a zero. A box reading
                "Reports not retrieved: 0" asserts that none failed retrieval,
                which is a claim this system cannot support. */}
            <p className="text-muted text-ui mt-1">
              PRISMA also asks for <em>reports sought for retrieval</em> and{" "}
              <em>reports not retrieved</em>. Both describe full-text retrieval, which
              needs the file pipeline. They are omitted rather than shown as zero, because
              a zero there would assert that no report failed retrieval — add them by hand
              if your review needs them.
            </p>
          </section>
        </>
      )}
    </main>
  );
}

function Row({
  label,
  value,
  indented = false,
  emphasis = false,
}: {
  label: string;
  value: number;
  indented?: boolean;
  emphasis?: boolean;
}) {
  return (
    <tr>
      <th
        scope="row"
        className={`px-4 py-2 text-left font-normal ${
          indented
            ? "text-muted text-fine pl-8"
            : emphasis
              ? "text-ink font-medium"
              : "text-ink"
        }`}
      >
        {label}
      </th>
      <td
        className={`px-4 py-2 text-right tabular-nums ${
          emphasis ? "text-ink font-semibold" : "text-muted"
        }`}
      >
        {value}
      </td>
    </tr>
  );
}
