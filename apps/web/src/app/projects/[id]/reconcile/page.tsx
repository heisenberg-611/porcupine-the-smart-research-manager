import {
  capabilities,
  cohensKappa,
  kappaLabel,
  supportsKappa,
  valuesAgree,
  type FieldType,
  type ProjectKind,
  type RatingPair,
} from "@Porcupine/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ButtonLink, EmptyState, PageHeader, TableScroll } from "@/components/ui";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Reconcile" };

interface QueueRow {
  project_work_id: string;
  work_title: string;
  disagreements: number;
  agreements: number;
  field_total: number;
  reconciled: boolean;
}

interface DisagreementRow {
  project_work_id: string;
  field_key: string;
  field_label: string;
  field_type: string;
  value_a: unknown;
  value_b: unknown;
  agree: boolean;
}

export default async function ReconcilePage({
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

  // R-06. The database refuses a reconciliation in a thesis project; this is
  // the same rule said in advance, so nobody walks into a refusal.
  const caps = capabilities(project.kind as ProjectKind);
  if (!caps.dualExtraction) {
    return (
      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
        <PageHeader
          backHref={`/projects/${id}`}
          backLabel={project.title}
          title="Reconcile"
        />
        <EmptyState
          title="Dual extraction is for systematic reviews"
          description="Two people extract every paper independently and a third resolves the disagreements. It is a lot of work, and it is what makes a review reproducible — but for a thesis it is overhead without a purpose."
          action={
            <ButtonLink href={`/projects/${id}/evidence`} variant="primary">
              Go to the evidence table
            </ButtonLink>
          }
        />
      </main>
    );
  }

  const queue = (await must(
    supabase
      .from("v_reconciliation_queue")
      .select(
        "project_work_id, work_title, disagreements, agreements, field_total, reconciled",
      )
      .eq("project_id", id)
      .order("disagreements", { ascending: false }),
    "the reconciliation queue",
  )) as unknown as QueueRow[];

  const disagreements = (await must(
    supabase
      .from("v_extraction_disagreements")
      .select(
        "project_work_id, field_key, field_label, field_type, value_a, value_b, agree",
      )
      .eq("project_id", id),
    "the field comparisons",
  )) as unknown as DisagreementRow[];

  /*
   * κ per field, computed from every dual-extracted paper.
   *
   * Only for the field types κ is defined for. Over free text it would measure
   * the text and not the raters: "randomised controlled trial" and "RCT" are
   * the same reading and would score as a disagreement.
   */
  const byField = new Map<
    string,
    { label: string; type: FieldType; pairs: RatingPair[]; agreed: number; total: number }
  >();

  for (const row of disagreements) {
    const type = row.field_type as FieldType;
    const entry = byField.get(row.field_key) ?? {
      label: row.field_label,
      type,
      pairs: [],
      agreed: 0,
      total: 0,
    };

    // Only papers BOTH people answered can contribute a rating pair. A missing
    // answer is not a category.
    const bothAnswered =
      row.value_a !== null &&
      row.value_a !== undefined &&
      row.value_b !== null &&
      row.value_b !== undefined;
    if (bothAnswered) {
      entry.total++;
      if (valuesAgree(type, row.value_a, row.value_b)) entry.agreed++;
      if (supportsKappa(type)) {
        entry.pairs.push({
          a: JSON.stringify(row.value_a),
          b: JSON.stringify(row.value_b),
        });
      }
    }

    byField.set(row.field_key, entry);
  }

  const agreementRows = [...byField.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      type: entry.type,
      kappa: supportsKappa(entry.type) ? cohensKappa(entry.pairs) : null,
      rawAgreement: entry.total > 0 ? entry.agreed / entry.total : null,
      n: entry.total,
    }))
    .filter((row) => row.n > 0);

  const pending = queue.filter((r) => !r.reconciled);
  const done = queue.filter((r) => r.reconciled);

  return (
    <main id="main" className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel={project.title}
        title="Reconcile"
        description={
          <>
            {pending.length} awaiting a third reader · {done.length} resolved
          </>
        }
      />

      {queue.length === 0 ? (
        <EmptyState
          title="No paper has been extracted twice yet"
          description="A paper appears here once two different people have each submitted an extraction of it. Until then there is nothing to compare."
          action={
            <ButtonLink href={`/projects/${id}/library`} variant="primary">
              Go to the library
            </ButtonLink>
          }
        />
      ) : (
        <>
          <section aria-labelledby="queue" className="flex flex-col gap-3">
            <h2 id="queue" className="text-title text-ink">
              Papers
            </h2>
            <TableScroll label="Dual-extracted papers">
              <table className="text-ui w-full text-left">
                <caption className="sr-only">
                  Dual-extracted papers and how far the two readings agree
                </caption>
                <thead className="border-border text-muted text-fine border-b uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Paper
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Agreed
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Disagreed
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {queue.map((row) => (
                    <tr key={row.project_work_id}>
                      <td className="px-4 py-3">
                        <Link
                          href={`/projects/${id}/reconcile/${row.project_work_id}`}
                          className="text-ink font-medium underline-offset-2 hover:underline"
                        >
                          {row.work_title}
                        </Link>
                      </td>
                      <td className="text-muted px-4 py-3 tabular-nums">
                        {row.agreements}/{row.field_total}
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        {row.disagreements > 0 ? (
                          <span className="text-danger font-medium">
                            {row.disagreements}
                          </span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                      <td className="text-muted text-fine px-4 py-3">
                        {row.reconciled ? "Resolved" : "Awaiting a third reader"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>

          {agreementRows.length > 0 && (
            <section aria-labelledby="agreement" className="flex flex-col gap-3">
              <h2 id="agreement" className="text-title text-ink">
                Inter-rater agreement
              </h2>
              <p className="prose-body">
                Cohen&rsquo;s κ, per field, over the papers both people extracted. Raw
                agreement is shown alongside it because the two answer different
                questions: 90% agreement with a poor κ means a field where one answer
                dominates, and where saying the same thing every time without reading
                would score about as well.
              </p>

              <TableScroll label="Agreement between the two extractors">
                <table className="text-ui w-full text-left">
                  <caption className="sr-only">
                    Agreement between the two extractors, by field
                  </caption>
                  <thead className="border-border text-muted text-fine border-b uppercase">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Field
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Papers
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Raw agreement
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        κ
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {agreementRows.map((row) => (
                      <tr key={row.key}>
                        <td className="text-ink px-4 py-3">{row.label}</td>
                        <td className="text-muted px-4 py-3 tabular-nums">{row.n}</td>
                        <td className="text-muted px-4 py-3 tabular-nums">
                          {row.rawAgreement === null
                            ? "—"
                            : `${Math.round(row.rawAgreement * 100)}%`}
                        </td>
                        <td className="px-4 py-3">
                          {row.kappa === null ? (
                            <span className="text-muted text-fine">
                              not applicable to this field type
                            </span>
                          ) : row.kappa.kappa === null ? (
                            // The degenerate case, spelled out rather than
                            // rendered as a confident 1.00.
                            <span className="text-muted text-fine">
                              undefined — {row.kappa.undefinedReason}
                            </span>
                          ) : (
                            <span className="text-ink tabular-nums">
                              {row.kappa.kappa.toFixed(2)}{" "}
                              <span className="text-muted text-fine">
                                ({kappaLabel(row.kappa.kappa)})
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </section>
          )}
        </>
      )}
    </main>
  );
}
