import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Features",
  description:
    "What porcupineResearch does today: search across five bibliographic databases, keyboard screening with recorded reasons, a shared extraction protocol, an evidence table, PRISMA, dual extraction with Cohen's κ, and end-to-end encrypted messages.",
};

/**
 * What the product does — and only what it does.
 *
 * The version this replaces advertised six features, three of which did not
 * exist: "real-time collaboration" with live chat channels (concurrent editing
 * is Phase 5; today the last write wins), export "directly into Google Docs",
 * and a blanket claim that team messages AND LaTeX documents are end-to-end
 * encrypted, on a page that then linked "Get Started for Free" to /signup —
 * a route this app has never had. The link was a plain anchor, which is the
 * only reason `typedRoutes` did not catch it at build time.
 *
 * A feature page that oversells is not a marketing problem, it is a support
 * problem: someone imports three hundred papers on the strength of it and
 * finds out in week three. So every claim below is traceable to a screen that
 * exists, and the ones that are not built are named on the landing page and on
 * /about rather than quietly omitted.
 *
 * The icons went with it. `@heroicons/react` was a dependency used by this one
 * page for six decorative glyphs; the rest of the app draws what it needs
 * inline, and a card does not become clearer for having a picture of a table
 * on it.
 */
export default function FeaturesPage() {
  return (
    <main id="main" className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-16">
      <PageHeader
        title="Features"
        description="Everything below is a screen you can open today, on the hosted service or on your own copy — they are the same build. What is not built yet has its own list at the bottom, because that is the half people find out about too late."
      />

      <div className="flex flex-col gap-12">
        {GROUPS.map((group) => (
          <section key={group.heading} aria-labelledby={group.id}>
            <h2 id={group.id} className="text-ink text-title font-serif">
              {group.heading}
            </h2>
            <p className="text-muted measure text-ui mt-2 text-pretty">{group.summary}</p>

            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {group.items.map(({ term, detail }) => (
                <li
                  key={term}
                  className="border-border/70 bg-raised/70 rounded-2xl border p-5 shadow-xs hover:shadow-md hover:border-accent/40 hover:-translate-y-0.5 transition-all duration-300"
                >
                  <h3 className="text-ink text-ui font-semibold">{term}</h3>
                  <p className="text-ink-soft text-ui mt-2 leading-relaxed text-pretty">
                    {detail}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section aria-labelledby="not-built" className="border-rule border-t pt-10">
        <h2 id="not-built" className="text-ink text-title font-serif">
          Not built yet
        </h2>
        <p className="text-muted measure text-ui mt-2 text-pretty">
          These are real gaps, not things you are failing to find. Two of them — automatic
          screening and automatic extraction — are not on the roadmap at all; that is a
          decision, not a backlog item.
        </p>
        <ul className="text-ink-soft text-ui mt-6 flex flex-col gap-4">
          {GAPS.map(({ term, detail }) => (
            <li key={term} className="measure text-pretty">
              <strong className="text-ink font-medium">{term}.</strong> {detail}
            </li>
          ))}
        </ul>
      </section>

      <section className="border-border/70 bg-raised/70 rounded-2xl border p-8 shadow-xs">
        <h2 className="text-ink text-title font-serif">Free, and yours either way</h2>
        <p className="text-ink-soft measure text-ui mt-3 text-pretty">
          No paid tier, no trial and no card. Use the hosted service — this site is it, so{" "}
          <Link href="/sign-in">signing in</Link> is the whole setup — or run your own
          copy from the repository against a database you control. Same code, same
          features. The <Link href="/pricing">pricing page</Link> covers why you might
          want the second one.
        </p>
      </section>
    </main>
  );
}

const GROUPS: ReadonlyArray<{
  id: string;
  heading: string;
  summary: string;
  items: ReadonlyArray<{ term: string; detail: string }>;
}> = [
  {
    id: "collect",
    heading: "Collect",
    summary: "Getting papers in, from a search or from the manager you already use.",
    items: [
      {
        term: "Five databases, one query",
        detail:
          "OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar, searched together. Records for the same paper are merged by DOI and identifier before you see them, so you judge each paper once. If a source is down the others still return and the page names the one that failed.",
      },
      {
        term: "Ranked against your questions",
        detail:
          "Every result reports which of your research questions it matched and why, so the search strategy is something you can defend rather than assert.",
      },
      {
        term: "BibTeX and RIS import",
        detail:
          "Paste straight from Zotero, Mendeley or a journal page. Preview first, then add. Re-importing the same file adds nothing, so pasting it twice is safe.",
      },
      {
        term: "Nothing enters by accident",
        detail:
          "Search results are not in your library until you add them. The library is the set of papers you decided to consider, which is what makes the PRISMA count at the top of the diagram mean anything.",
      },
    ],
  },
  {
    id: "screen",
    heading: "Screen",
    summary:
      "Three hundred include-or-exclude decisions is the most repetitive thing this asks of anyone, so it is built for the keyboard.",
    items: [
      {
        term: "Keyboard-driven queue",
        detail:
          "i to include, e to exclude, s to skip, 1–9 to pick an exclusion reason, ? for the list. Decisions apply immediately rather than waiting for the server.",
      },
      {
        term: "Reasons, from a controlled list",
        detail:
          "A systematic review cannot exclude a paper without one, and the rule is a database trigger rather than a form check — so imports and bulk actions obey it too. That controlled list is what the PRISMA diagram is built from later.",
      },
      {
        term: "Two people cannot overwrite each other",
        detail:
          "Each decision carries the status the screen was showing when it was made. If a colleague decided the same paper first, yours is refused and the paper comes back naming them, instead of silently replacing their call.",
      },
      {
        term: "Assignment and due dates",
        detail:
          "Assign a paper to a member with a date, and it appears in their queue. A date means the end of that day, so a paper due today is not overdue the moment it is assigned.",
      },
    ],
  },
  {
    id: "read",
    heading: "Read and extract",
    summary:
      "The part that turns a pile of papers into a table somebody else could check.",
    items: [
      {
        term: "Highlights that stay put",
        detail:
          "Select a passage to highlight it and attach a note, private or shared. Quotes are anchored to the text, and a quote whose passage no longer exists says so rather than pointing somewhere plausible.",
      },
      {
        term: "A protocol, versioned",
        detail:
          "Define the questions you ask every paper — sample size, study design, primary outcome. Four templates are built in, including PICO. Once a question has answers its key cannot be renamed and it cannot be deleted; make a new version instead, so two exports never disagree about what a column means.",
      },
      {
        term: "Quote fields force provenance",
        detail:
          "A quote-typed question cannot be typed into. It can only be filled by selecting the passage in the paper, and the database refuses answers that are not linked to one.",
      },
      {
        term: "No autosave, on purpose",
        detail:
          "The extraction form saves when you say so. A half-typed number should never become a recorded answer. The header counts what you have answered and says plainly when there are unsaved changes; submitting freezes the form until you reopen it.",
      },
    ],
  },
  {
    id: "report",
    heading: "Report and agree",
    summary: "The outputs, drawn from decisions you already made.",
    items: [
      {
        term: "Evidence table",
        detail:
          "Papers as rows, protocol questions as columns. Sort — numbers as numbers — filter, group, and choose which columns are shown. The choice lives in the URL, so a narrowed table is a link you can send to a supervisor.",
      },
      {
        term: "CSV and Excel export",
        detail:
          "Exactly what your filters and columns show. Column headers are the question keys rather than the labels, so a script that reads the file keeps working when someone rewords a label.",
      },
      {
        term: "PRISMA, not typed in",
        detail:
          "The flow diagram journals ask for, built from your recorded decisions. The counts copy out as text straight into a methods section.",
      },
      {
        term: "Dual extraction and Cohen's κ",
        detail:
          "Two people extract the same paper independently; reconciliation shows only where they disagreed, and a third person — who must not be either of them — resolves it. Where κ genuinely cannot be computed it says so and shows raw agreement instead of printing a confident number the data does not support.",
      },
    ],
  },
  {
    id: "team",
    heading: "Team and privacy",
    summary:
      "Five roles, an audit trail, and a clear line between what the server can read and what it cannot.",
    items: [
      {
        term: "Roles that actually differ",
        detail:
          "Owner, admin, contributor, reviewer and observer. A reviewer — the supervisor role — can read and annotate but cannot record screening decisions. A contributor cannot edit the protocol. Enforced in the database, not in the interface.",
      },
      {
        term: "End-to-end encrypted messages",
        detail:
          "Project messages and LaTeX sources are sealed in your browser with XChaCha20-Poly1305 under a key the server never holds. Your papers, highlights and extracted answers are not — they have to be searchable and countable, and the security page says so plainly.",
      },
      {
        term: "A recovery passphrase, shown once",
        detail:
          "There is no password to derive a key from, so the app generates a 30-character passphrase and shows it exactly once. Register a browser and it unlocks without retyping; revoke that browser later if you lose it.",
      },
      {
        term: "Google Drive, narrowly scoped",
        detail:
          "Connect a Google account and the project gets a Drive folder for collaboration documents. The scope requested is drive.file, which reaches only files this app created or you explicitly picked — never the rest of your Drive.",
      },
    ],
  },
];

const GAPS: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: "PDF upload and full-text reading",
    detail:
      "The reader shows the abstract. There is no file upload anywhere in the app yet, so highlights work over abstract text only.",
  },
  {
    term: "Live collaboration",
    detail:
      "Two people editing the same note at the same time is a later phase; today the last write wins. Screening decisions are the exception — those are protected from overwriting each other.",
  },
  {
    term: "Sharing a project across instances",
    detail:
      "Everyone working on a review has to be on the same instance. On the hosted service they already are; two self-hosted copies cannot see each other's projects, and there is no export-and-merge that would let them.",
  },
  {
    term: "LaTeX and Overleaf export",
    detail: "Not started. CSV and Excel are the outputs today.",
  },
  {
    term: "Reference-manager sync",
    detail:
      "Import is one-way and paste-only. No Zotero sync, no pushing back to a manager.",
  },
  {
    term: "Any AI",
    detail:
      "Deliberately none, and not planned. Nothing screens for you, nothing extracts for you, nothing summarises a paper. Every answer in the evidence table was typed by a person whose name is on it — which is the only version of this a methods section can defend.",
  },
];
