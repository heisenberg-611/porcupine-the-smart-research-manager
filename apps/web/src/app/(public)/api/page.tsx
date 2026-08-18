import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "API and exports",
  description:
    "There is no public HTTP API yet. What exists instead: CSV and Excel exports with stable column keys, and direct SQL against your own Postgres database.",
};

/**
 * The page that says "no", and then says what to use instead.
 *
 * It was headed "API Reference" and contained no reference, because there is
 * no API to document. Naming a page after a thing that does not exist is worse
 * than not having the page: someone plans a pipeline around it.
 *
 * What that reader actually wants is a stable, machine-readable way to get
 * their data out, and two of those do exist. So the page is honest about the
 * absence and then spends its length on the exports and on the database,
 * including the one detail that decides whether a script keeps working next
 * month — the export uses question KEYS as column headers, not labels.
 */
export default function ApiPage() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
      <PageHeader
        title="API and exports"
        description="There is no public HTTP API. There are two supported ways to get your data out programmatically, and this page is about those."
      />

      <div className="border-border bg-surface/50 rounded-[--radius-card] border p-6">
        <p className="text-ink text-ui text-pretty">
          <strong className="font-medium">No REST or GraphQL endpoint exists</strong> —
          not undocumented, not private, not behind a key. The routes this app serves are
          its own pages and its own form submissions, and they are not a contract: they
          change shape whenever a screen does, and nothing warns you when they have.
        </p>
      </div>

      <div className="longform">
        <h2>Export files, and the one thing to know about them</h2>
        <p>
          The evidence table exports to <strong>CSV</strong> and <strong>Excel</strong>.
          What comes out is exactly what your filters and your column choice are showing —
          not the whole project — so a narrowed table is also a narrowed file.
        </p>
        <p>
          <strong>Column headers are protocol question keys, not labels.</strong> A
          question labelled &ldquo;Sample size (n)&rdquo; exports as{" "}
          <code>sample_size</code>. That is deliberate and it is the reason a script
          reading these files keeps working: a key cannot be renamed once the question has
          answers, whereas the label is prose and gets reworded. Bind your R or pandas
          code to the key.
        </p>
        <p>
          Cells that were quoted from a paper export as the answer text. The link back to
          the passage exists only in the app, since a spreadsheet has nowhere to put a
          text anchor.
        </p>

        <h2>The database is yours</h2>
        <p>
          If you run your own copy, the fully general answer is SQL: it is your PostgreSQL
          instance. The schema is in <code>supabase/migrations</code> and every table is
          documented in <code>docs/01-data-model.md</code>. On the hosted service this
          route is not available — you have an account there, not a database — so the
          exports above are the whole of it.
        </p>
        <p>Two warnings that matter more than they sound:</p>
        <ul>
          <li>
            <strong>Read through a role that row-level security applies to.</strong>{" "}
            Connecting as the superuser bypasses every policy in the database, which is
            fine for a report you run on your own project and is not fine for anything you
            then hand to somebody else.
          </li>
          <li>
            <strong>Do not write to it.</strong> Several rules that the application
            depends on are triggers and constraints — an exclusion needs a reason, a
            reconciler cannot be one of the extractors, a question with answers cannot be
            renamed. An <code>UPDATE</code> that dodges the application does not dodge
            those; it fails, or worse, it succeeds against a rule that was only ever
            enforced in a form.
          </li>
        </ul>
        <p>
          The encrypted columns are the exception to &ldquo;the database is yours&rdquo;
          in the way you would expect: message bodies and LaTeX sources are ciphertext
          there, and no SQL will open them. <Link href="/security">Security</Link>{" "}
          explains which columns those are.
        </p>

        <h2>What an API would need first</h2>
        <p>
          Not effort — decisions. An endpoint needs tokens with their own lifecycle and
          revocation, a scope model that does not quietly widen the five project roles,
          rate limiting per token, and a versioning promise, because the first integration
          written against it is the moment the schema stops being free to change.
        </p>
        <p>
          None of that is written yet, and until it is, the exports above are the
          supported route. If an API would change what you can do with your data — rather
          than merely being tidier than a CSV — that is worth saying in an issue, because
          the shape of the first real use case is the thing missing.
        </p>
      </div>

      <p className="text-muted text-ui border-rule border-t pt-8 text-pretty">
        If an export is missing a field you need, that is the useful thing to report — it
        is usually a smaller change than it looks. The{" "}
        <Link href="/features">features page</Link> lists what is in the table today.
      </p>
    </main>
  );
}
