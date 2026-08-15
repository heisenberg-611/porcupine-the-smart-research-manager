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
  if (user) redirect("/dashboard");

  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-20">
      {/* The product's name, which the last rewrite dropped entirely — the
          page opened on a claim with nothing to attach it to, so a visitor
          could read the whole thing and not learn what it was called. */}
      <p className="text-ink text-heading font-serif">Porcupine</p>

      <h1 className="text-ink text-display mt-2 text-balance">
        Every paper you read, in one defensible pile.
      </h1>

      <p className="text-ink-soft measure text-body mt-5 text-pretty">
        A literature review, from the first search to the finished evidence table. For
        teams running a systematic review that has to be reproducible, and for students
        running a thesis search on the same machinery.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/sign-in" variant="primary">
          Sign in
        </ButtonLink>
        <ButtonLink href="/about">How it works</ButtonLink>
      </div>

      {/* The whole workflow, in order, at a glance. Six steps, not three: the
          first version of this page stopped at "Read", which is the point
          where the work starts producing something.

          One line each, deliberately. This page's job is to let someone decide
          in fifteen seconds whether to keep reading; the detail is at /about,
          where a reader has already said yes. */}
      <ol className="border-rule mt-14 grid gap-x-8 gap-y-6 border-t pt-8 sm:grid-cols-3">
        {STEPS.map(({ term, detail }, index) => (
          <li key={term}>
            <p className="text-muted text-fine font-mono">
              {String(index + 1).padStart(2, "0")}
            </p>
            <h2 className="text-ink text-heading mt-0.5">{term}</h2>
            <p className="text-muted text-fine mt-1 text-pretty">{detail}</p>
          </li>
        ))}
      </ol>

      <p className="text-muted measure text-fine mt-12 text-pretty">
        Your notes and messages are encrypted in your browser, so we cannot read them —
        and cannot recover them for you either.{" "}
        <Link href="/about" className="text-accent underline underline-offset-4">
          What that means, and what this does not do
        </Link>
        .
      </p>
    </main>
  );
}

const STEPS: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: "Ask",
    detail: "Write the questions. Everything after is ranked against them.",
  },
  {
    term: "Find",
    detail: "Five databases at once, duplicates merged before you see them.",
  },
  {
    term: "Screen",
    detail: "Include or exclude, with a reason. Keyboard-driven.",
  },
  {
    term: "Read",
    detail: "Highlight and annotate. Quotes stay anchored to the passage.",
  },
  {
    term: "Extract",
    detail: "The same fields from every paper, so they can be compared.",
  },
  {
    term: "Report",
    detail: "Evidence table and PRISMA diagram, from decisions you already made.",
  },
];
