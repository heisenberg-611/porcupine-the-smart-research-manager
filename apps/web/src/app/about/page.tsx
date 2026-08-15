import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "What each screen in Porcupine does, what it deliberately does not do, and what happens to your data.",
};

/**
 * The longer explanation, for someone deciding whether to make an account.
 *
 * Deliberately a route rather than more of the landing page. The landing page
 * has one job — say what this is in the time someone will give it — and the
 * curious visitor was previously served by nothing at all: the only way to find
 * out more was to sign up.
 *
 * NOT behind auth, and that is the point. A page explaining the product that
 * you can only read once you have committed to the product is a page for
 * nobody.
 *
 * The "what this does not do" section is not modesty. Every one of those is a
 * thing a reviewer might reasonably assume is here, and finding out after
 * importing three hundred papers is the expensive way to learn it.
 */
export default function AboutPage() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-20">
      <p className="text-muted text-fine">
        <Link href="/" className="hover:text-ink underline underline-offset-4">
          ← Porcupine
        </Link>
      </p>

      <h1 className="text-ink text-display mt-4 text-balance">How it works</h1>

      <p className="text-ink-soft measure text-body mt-5 text-pretty">
        A review is a pipeline, and every screen here is one stage of it. You do not have
        to use them all — a thesis project can skip reconciliation and the PRISMA diagram
        entirely, and the app hides what your project kind does not need rather than
        offering it and then refusing.
      </p>

      {/* The vocabulary, before the screens that use it. It was on the
          landing page, which needed to be short enough to read in fifteen
          seconds; a reader who has clicked through to here has already said
          yes and can afford four definitions. */}
      <section className="border-rule mt-12 border-t pt-8">
        <h2 className="text-ink text-title">The four words this uses</h2>
        <dl className="mt-6 flex flex-col gap-5">
          {GLOSSARY.map(({ term, detail }) => (
            <div key={term}>
              <dt className="text-ink text-ui font-medium">{term}</dt>
              <dd className="text-muted measure text-ui mt-1 text-pretty">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-rule mt-12 border-t pt-8">
        <h2 className="text-ink text-title">The screens</h2>
        <dl className="mt-6 flex flex-col gap-6">
          {SCREENS.map(({ term, detail }) => (
            <div key={term}>
              <dt className="text-ink text-ui font-medium">{term}</dt>
              <dd className="text-muted measure text-ui mt-1 text-pretty">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-rule mt-12 border-t pt-8">
        <h2 className="text-ink text-title">Encryption, and what it costs you</h2>
        <p className="text-muted measure text-ui mt-4 text-pretty">
          Messages and your extracted notes are sealed in your browser with a key the
          server never holds. The database stores bytes it cannot interpret, and there is
          a test suite that asserts those columns cannot hold readable text.
        </p>
        <p className="text-muted measure text-ui mt-4 text-pretty">
          The cost is real and it is not hidden: a recovery passphrase is shown once when
          you enrol, and if you lose it nobody — including us — can open your notes again.
          You can register a browser so it unlocks without retyping the passphrase, and
          you can revoke that browser later.
        </p>
        <p className="text-muted measure text-ui mt-4 text-pretty">
          The papers themselves, their titles and your screening decisions are not
          encrypted this way. They have to be searchable and countable, and pretending
          otherwise would be a claim we could not keep.
        </p>
      </section>

      <section className="border-rule mt-12 border-t pt-8">
        <h2 className="text-ink text-title">What this does not do</h2>
        <ul className="mt-4 flex flex-col gap-3">
          {LIMITS.map((limit) => (
            <li key={limit} className="text-muted measure text-ui text-pretty">
              {limit}
            </li>
          ))}
        </ul>
      </section>

    </main>
  );
}

const SCREENS: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: "Research questions",
    detail:
      "What the review asks, plus the keywords a paper would use if it answered. Search ranks every result against these and each result reports which ones it matched, so the search strategy is something you can defend rather than assert.",
  },
  {
    term: "Find papers",
    detail:
      "One query across five bibliographic databases. Records for the same paper are merged by DOI and identifier before ranking, so you judge each paper once. Nothing enters your library until you add it.",
  },
  {
    term: "Import",
    detail:
      "BibTeX or RIS pasted from a reference manager, for the papers you already have.",
  },
  {
    term: "Extraction form",
    detail:
      "The fields recorded for every paper. Start from a template — PICO for clinical trials, among others — or build your own. Once a field has answers it cannot be renamed away underneath them; a new version copies the fields forward instead.",
  },
  {
    term: "Screen",
    detail:
      "The queue, with the abstract and a link to the paper. Include, exclude with a reason, or skip for now — which records that you looked and moves it to the end rather than pretending it never happened.",
  },
  {
    term: "Reconcile",
    detail:
      "For systematic reviews: two people extract the same paper independently, and this shows only where they disagreed, with the agreement statistics that tell you whether the disagreement is systematic.",
  },
  {
    term: "Evidence",
    detail:
      "Papers as rows, your extraction fields as columns. Every quoted cell links back to the passage it came from. Exports to CSV.",
  },
  {
    term: "PRISMA",
    detail:
      "The flow diagram, drawn from the decisions you recorded. The counts can be copied as text straight into a methods section.",
  },
  {
    term: "Messages",
    detail:
      "Conversation inside the project, encrypted so the server cannot read it. Not a replacement for email — a place for the arguments about specific papers to live next to the papers.",
  },
];

const LIMITS: readonly string[] = [
  "It does not read PDFs for you. Full text has to come from the source; what the import gives us is what the reader shows.",
  "It does not decide anything. There is no automatic screening, no relevance model choosing papers for you — the ranking suggests an order and every decision is a person's, recorded under their name.",
  "It does not write your review. The evidence table and the diagram are outputs you take somewhere else.",
  "Messages do not arrive live yet. The page refreshes when you return to it or ask it to.",
  "It is not a reference manager. It will take your BibTeX; it will not replace Zotero for citing as you write.",
];

const GLOSSARY: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: "Systematic review",
    detail:
      "A literature review done to a written method, so that someone else following the same steps would find the same papers. The alternative — reading whatever turns up — is fine for a seminar and not publishable.",
  },
  {
    term: "Screening",
    detail:
      "Deciding, paper by paper, whether each one belongs in the review, and recording why the rejected ones were rejected.",
  },
  {
    term: "Extraction form",
    detail:
      "The list of things you record about every paper — participants, design, outcome, whatever the review needs. Also called the protocol. Agreeing it before you start is what makes the papers comparable.",
  },
  {
    term: "PRISMA",
    detail:
      "The flow diagram journals ask for: how many papers you found, how many you excluded, why, and how many survived. Porcupine draws it from your recorded decisions rather than asking you to count.",
  },
];
