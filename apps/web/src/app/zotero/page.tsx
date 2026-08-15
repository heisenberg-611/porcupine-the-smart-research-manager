import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Using Zotero" };

/**
 * How to get papers out of here and into Zotero, and why you would.
 *
 * Porcupine is not a reference manager and should not become one: citing as
 * you write is a different job, done inside Word or LaTeX, and Zotero has
 * fifteen years of head start on it. What Porcupine owes its users is a clean
 * exit — every paper carries a citation in the formats Zotero imports, and
 * this page says which button does what.
 *
 * Written as instructions rather than links to Zotero's docs, because the
 * question is never "what is Zotero" — it is "what do I press here".
 */
export default async function ZoteroPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  return (
    <main id="main" className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12">
      <PageHeader
        backHref="/dashboard"
        backLabel="Dashboard"
        title="Using Zotero with Porcupine"
        description="Porcupine screens and extracts. Zotero cites. Here is how to move a paper from one to the other."
      />

      <section>
        <h2 className="text-ink text-heading font-medium">Which tool does what</h2>
        <p className="text-muted measure text-ui mt-2 text-pretty">
          Keep your review in Porcupine: the searching, the screening decisions, the
          protocol, the PRISMA counts. Keep your bibliography in Zotero: the
          citations you insert while writing, in whatever style the journal wants. Trying
          to do either job in the other tool is how people end up maintaining two
          libraries that disagree.
        </p>
      </section>

      <section>
        <h2 className="text-ink text-heading font-medium">Getting one paper across</h2>
        <ol className="text-muted text-ui mt-2 flex list-decimal flex-col gap-2 pl-5">
          <li>
            Find the paper in your{" "}
            <Link href="/projects" className="text-accent underline underline-offset-4">
              library
            </Link>{" "}
            — or on the screening, reading or evidence screens. They all carry it.
          </li>
          <li>
            Open <strong className="text-ink">Cite</strong> and choose{" "}
            <strong className="text-ink">RIS</strong> or{" "}
            <strong className="text-ink">BibTeX</strong>. Both are copied to your
            clipboard.
          </li>
          <li>
            In Zotero: <strong className="text-ink">File → Import from clipboard</strong>.
            The record arrives with its authors, year, venue and DOI already filled in.
          </li>
        </ol>
      </section>

      <section>
        <h2 className="text-ink text-heading font-medium">
          Getting a whole review across
        </h2>
        <p className="text-muted measure text-ui mt-2 text-pretty">
          The evidence table exports to CSV, which Zotero does not read. For a whole set,
          the quicker route is Zotero&rsquo;s browser connector: open each paper&rsquo;s
          DOI link from Porcupine and save it from the publisher&rsquo;s page, which also
          gets you the PDF where you have access to it.
        </p>
        <p className="text-muted measure text-ui mt-2 text-pretty">
          {/* Said plainly rather than promised. */}A one-click bulk export to RIS is not
          built yet.
        </p>
      </section>

      <section>
        <h2 className="text-ink text-heading font-medium">If you do not have Zotero</h2>
        <p className="text-muted measure text-ui mt-2 text-pretty">
          It is free and open source, from{" "}
          <a
            href="https://www.zotero.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-4"
          >
            zotero.org
          </a>
          . The browser connector is the part worth installing on day one — it is what
          turns a publisher&rsquo;s page into a saved reference in one click.
        </p>
        <p className="text-muted measure text-ui mt-2 text-pretty">
          Mendeley, EndNote and JabRef all import the same RIS and BibTeX, so the Cite
          button works for them too.
        </p>
      </section>
    </main>
  );
}
