import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ButtonLink } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Porcupine",
  description:
    "Run a systematic review or a thesis literature search end to end: find papers across five databases, screen them with your reasons recorded, extract the same fields from every one, and get the evidence table and PRISMA diagram out at the end.",
};

/**
 * The landing page.
 *
 * The version this replaces had a headline, a sentence and three columns —
 * Find, Screen, Read. It was honest and it described a third of the product:
 * extraction, reconciliation, the evidence table and encrypted messages were
 * all absent, which is to say the reason the screening exists was absent. It
 * never said who the tool is for, and it never explained the four words the app
 * then uses on every screen. A visitor's only way to find out what this was,
 * was to make an account.
 *
 * The order below is the order of the work, because that is the explanation. A
 * feature list would need the reader to already know how a review is done; a
 * sequence teaches it in passing.
 *
 * A signed-in visitor is sent straight to their projects. Landing on a
 * marketing page when you have screening waiting is a small insult repeated
 * every session.
 */
export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/projects");

  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-ink text-display text-balance">
        Every paper you read, in one defensible pile.
      </h1>

      <p className="text-ink-soft measure text-body mt-5 text-pretty">
        Porcupine runs a literature review from the first search to the finished evidence
        table. It is built for the two people who do this work: a team running a{" "}
        <strong className="text-ink">systematic review</strong> that has to be
        reproducible, and a student running a thesis search on the same machinery without
        the paperwork.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/sign-in" variant="primary">
          Sign in
        </ButtonLink>
        <ButtonLink href="/about">How it works</ButtonLink>
      </div>

      {/* The whole workflow, in order. Six steps, not three: the previous
          version stopped at "Read", which is the point where the work starts
          producing something. */}
      <ol className="border-rule mt-16 grid gap-8 border-t pt-8 sm:grid-cols-2">
        {STEPS.map(({ term, detail }, index) => (
          <li key={term}>
            <p className="text-muted text-fine font-mono">
              {String(index + 1).padStart(2, "0")}
            </p>
            <h2 className="text-ink text-heading mt-1">{term}</h2>
            <p className="text-muted text-ui mt-2 text-pretty">{detail}</p>
          </li>
        ))}
      </ol>

      {/* The words the app uses everywhere, defined once, here — rather than
          left for the reader to meet cold on a screen called "PRISMA". */}
      <section className="border-rule mt-16 border-t pt-8">
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

      <section className="border-rule mt-16 border-t pt-8">
        <h2 className="text-ink text-title">What happens to your work</h2>
        <p className="text-muted measure text-ui mt-4 text-pretty">
          Messages and extracted notes are encrypted in your browser before they are sent.
          We cannot read them — which also means we cannot recover them for you, so the
          recovery passphrase you are shown at sign-up is the only copy and nobody here
          can reset it. That trade is stated up front rather than discovered.
        </p>
        <p className="text-muted measure text-ui mt-4 text-pretty">
          Every screening decision records who made it and when, and can be revised.
          Collaborators and supervisors are not billed per seat — a review with six people
          on it costs what a review with one does.
        </p>
      </section>

      <p className="text-muted text-fine mt-16">
        <Link href="/about" className="text-accent underline underline-offset-4">
          The longer version
        </Link>{" "}
        — what each screen does, and what this deliberately does not do.
      </p>
    </main>
  );
}

const STEPS: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: "Ask",
    detail:
      "Write the questions the review is answering, and the words a paper would use if it answered them. Everything after this is ranked against them.",
  },
  {
    term: "Find",
    detail:
      "Search OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar at once. Records describing the same paper are merged before you see them, and every result says why it surfaced.",
  },
  {
    term: "Screen",
    detail:
      "Include or exclude, with a reason from a fixed list. Keyboard-driven, because this is the part you do three hundred times.",
  },
  {
    term: "Read",
    detail:
      "Highlight and annotate. Quotes stay anchored to the passage they came from, and say so when the text moves underneath them.",
  },
  {
    term: "Extract",
    detail:
      "Record the same fields for every paper, so twenty papers become a table you can compare instead of twenty things to remember. Two people can extract independently and reconcile where they disagree.",
  },
  {
    term: "Report",
    detail:
      "The evidence table and the PRISMA diagram come out of the decisions you already recorded — no retyping, and no number that disagrees with the data behind it.",
  },
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
