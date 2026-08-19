import { capabilities, exclusionReasonLabel, type ProjectKind } from "@Porcupine/shared";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ButtonLink, EmptyState, PageHeader, TableScroll } from "@/components/ui";
import { getProjectRole } from "@/lib/project";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

import { CopyNumbers } from "./copy-numbers";
import { PrismaCountsForm } from "./counts-form";
import {
  PrismaDiagram,
  type ExclusionRow,
  type PrismaCounts,
  type PrismaManualCounts,
} from "./prisma-diagram";

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

  /*
   * The figures nobody can count for us.
   *
   * `maybeSingle`, because a project that has never had them entered has no
   * row — which is not an error and not an empty review, it is a review whose
   * team has not got to this yet. Every field then reads as null and the
   * diagram draws a dash.
   */
  const manualRow = await must(
    supabase
      .from("prisma_manual_counts")
      .select(
        "registers_identified, automation_ineligible, other_removed_before, " +
          "reports_sought, reports_not_retrieved, other_websites, other_organisations, " +
          "other_citation_searching, other_reports_sought, other_reports_not_retrieved, " +
          "other_reports_assessed, other_reports_excluded, other_studies_included, " +
          "reports_of_included_studies",
      )
      .eq("project_id", id)
      .maybeSingle(),
    "the entered PRISMA counts",
  );

  const role = await getProjectRole(id, user.id);
  const canEditCounts = role === "OWNER" || role === "ADMIN";

  const raw = (manualRow ?? {}) as Record<string, number | null>;
  const manual: PrismaManualCounts = {
    registersIdentified: raw.registers_identified ?? null,
    automationIneligible: raw.automation_ineligible ?? null,
    otherRemovedBefore: raw.other_removed_before ?? null,
    reportsSought: raw.reports_sought ?? null,
    reportsNotRetrieved: raw.reports_not_retrieved ?? null,
    otherWebsites: raw.other_websites ?? null,
    otherOrganisations: raw.other_organisations ?? null,
    otherCitationSearching: raw.other_citation_searching ?? null,
    otherReportsSought: raw.other_reports_sought ?? null,
    otherReportsNotRetrieved: raw.other_reports_not_retrieved ?? null,
    otherReportsAssessed: raw.other_reports_assessed ?? null,
    otherReportsExcluded: raw.other_reports_excluded ?? null,
    otherStudiesIncluded: raw.other_studies_included ?? null,
    reportsOfIncludedStudies: raw.reports_of_included_studies ?? null,
  };

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
          <>
            {/* The old description said only "derived from recorded screening
                decisions, nothing here is estimated" — true, and no help at all
                to anyone who does not already know what PRISMA is. This page is
                in a thesis student's sidebar too. */}
            The diagram journals ask for in a review&rsquo;s methods section: how many
            papers you found, how many you threw out, why, and how many survived. It is
            drawn from your recorded screening decisions, so it is always the truth about
            this project rather than a figure anyone typed. Nothing here is estimated.
          </>
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
              manual={manual}
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
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-ink text-heading font-medium">The numbers</h2>
              {/* Getting these into a manuscript was a screenshot or retyping,
                  and retyping a count is how a methods section ends up
                  disagreeing with the data it describes. */}
              <CopyNumbers
                lines={[
                  `Records identified: ${counts.recordsIdentified}`,
                  `Records removed before screening (duplicates): ${counts.recordsRemovedBeforeScreening}`,
                  `Records screened: ${counts.recordsScreened}`,
                  `Records excluded: ${counts.recordsExcluded}`,
                  ...exclusions.map(
                    (e) => `  ${exclusionReasonLabel(e.reason)}: ${e.count}`,
                  ),
                  // The entered figures go in too. Copying half the diagram and
                  // retyping the rest is exactly the step where a methods
                  // section starts disagreeing with its own figure.
                  `Reports sought for retrieval: ${manual.reportsSought ?? "not stated"}`,
                  `Reports not retrieved: ${manual.reportsNotRetrieved ?? "not stated"}`,
                  `Studies included: ${counts.studiesIncluded}`,
                  `Reports of included studies: ${manual.reportsOfIncludedStudies ?? "not stated"}`,
                ]}
              />
            </div>
            <TableScroll label="Exclusion reasons">
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
            </TableScroll>
          </section>

          <section className="border-border rounded-lg border border-dashed p-4">
            <h2 className="text-ink text-heading font-medium">
              The figures nobody here can count
            </h2>
            {/* This section used to say these boxes were omitted, which was
                honest and left the figure unsubmittable. They are drawn now,
                fed by what somebody typed — and a box nobody has typed into
                still shows a dash rather than a zero, because "0 reports not
                retrieved" is a claim and a dash is a question. */}
            <p className="text-muted measure text-ui mt-1 text-pretty">
              Full-text retrieval happens in a library&rsquo;s document supply, a hand
              search of a trial register happens in a browser tab, and citation chasing
              happens in a reference list. None of it passes through this app, so none of
              it can be counted here — but PRISMA 2020 asks for all of it, and a diagram
              missing those boxes is not one a journal will take.
            </p>
            <p className="text-muted measure text-ui mt-3 text-pretty">
              So they are entered below and drawn in the same figure. Anything left empty
              shows as an em dash in the diagram, which reads as an open question rather
              than as an assertion that the number was nought.
            </p>

            {canEditCounts ? (
              <div className="mt-6">
                <PrismaCountsForm projectId={id} initial={manual} />
              </div>
            ) : (
              <p className="text-muted text-ui mt-4">
                An owner or admin can fill these in. They go into a published figure, so
                the roles that can change what the review asserts are the ones that can
                edit them.
              </p>
            )}
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
