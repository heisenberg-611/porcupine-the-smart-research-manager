import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  description:
    "Run a systematic review or a thesis literature search end to end: find papers across five databases, screen them with your reasons recorded, extract the same questions from every one, and get the evidence table and PRISMA diagram out at the end.",
};

/*
 * Signed in, this page still renders.
 *
 * It used to redirect straight to /dashboard, which made the wordmark in the
 * header a dead control for everyone who was signed in — the one link on
 * every page that is conventionally "take me to the front" bounced you back
 * to where you already were. What the page says about the product is also
 * the thing a user shows someone else, and they should not have to sign out
 * to reach it.
 *
 * The call to action is the part that has to change: offering "Sign in" to
 * someone already signed in is the tell that a page has one audience in mind.
 *
 * ─ What was cut, and why ──────────────────────────────────────────────────
 *
 * A four-term glossary — systematic review, protocol, screening, PRISMA —
 * used to sit between the hero and the steps. The same four definitions, in
 * the same words, are on /about, which is where they were written and where
 * the reader who wants them has said so by clicking. On the front page they
 * cost a screenful before the product had said what it does, and pushed the
 * six steps — the only part that answers "what is this" — below the fold.
 *
 * The footer went the other way: it was written inline here, so the twelve
 * pages it linked to had no footer of their own and no way back. It is a
 * component now and the layout renders it on all thirteen.
 */
export default async function Home() {
  const user = await getCurrentUser();

  return (
    <main id="main" className="mx-auto max-w-5xl px-6 py-16 sm:py-13">
      <header className="border-rule border-b pb-15">
        <p className="text-accent text-fine font-mono tracking-widest uppercase sm:text-2xl">
          Literature review software
        </p>

        {/*
          No logo beside the headline.

          It was here, and it is the site header's job now — the header carries
          the mark and the wordmark on every public page, so a second copy
          directly below it was the same image twice in the first 200px. The
          headline gets the whole width instead, which is what a headline that
          long wants.
        */}
        <h1 className="text-ink mt-6 font-serif text-4xl leading-tight tracking-tight text-balance sm:text-6xl">
          Every paper you read, in one defensible pile.
        </h1>

        {/*
          One paragraph, not three. This said the same thing three times —
          an eyebrow, a serif tagline, and then a paragraph that restated the
          tagline before adding the only new information in the block, which
          is who it is for.
        */}
        <p className="text-ink-soft measure text-body mt-8 text-pretty">
          A literature review, from the first search to the finished evidence table. For
          teams running a systematic review that has to be reproducible, and for students
          running a thesis search on the same machinery.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          {user ? (
            <ButtonLink href="/dashboard" variant="primary">
              Go to your dashboard
            </ButtonLink>
          ) : (
            <ButtonLink href="/sign-in" variant="primary">
              Get started
            </ButtonLink>
          )}
          <ButtonLink href="/about">How it works</ButtonLink>
        </div>
      </header>

      <section aria-labelledby="steps" className="mt-12">
        <h2 id="steps" className="text-ink text-title font-serif">
          Six stages, in order
        </h2>
        <p className="text-muted measure text-ui mt-2 text-pretty">
          You do not have to use them all. A thesis project skips reconciliation and the
          PRISMA diagram entirely, and the app hides what your project kind does not need
          rather than offering it and then refusing.
        </p>

        <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map(({ term, detail }, index) => (
            <li
              key={term}
              className="border-border/70 bg-raised/70 rounded-2xl border p-6 shadow-xs hover:shadow-md hover:border-accent/40 hover:-translate-y-0.5 transition-all duration-300"
            >
              <p className="text-accent text-fine font-mono font-semibold">
                Step {String(index + 1).padStart(2, "0")}
              </p>
              {/*
                h3, not h2. The section above it is the h2, and a card heading
                that outranks the heading of the section containing it is the
                most common way a page's outline stops describing the page.
              */}
              <h3 className="text-ink text-heading mt-2 font-serif font-bold">{term}</h3>
              <p className="text-ink-soft text-ui mt-3 leading-relaxed text-pretty">
                {detail}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="honest" className="border-rule mt-15 border-t pt-12">
        <h2 id="honest" className="text-ink text-title font-serif">
          What it will not do
        </h2>
        <ul className="text-ink-soft text-ui mt-6 grid gap-4 sm:grid-cols-2">
          {LIMITS.map((limit) => (
            <li key={limit} className="text-pretty">
              {limit}
            </li>
          ))}
        </ul>
        {/*
          "The longer list", not a second "How it works". The button in the
          hero is the one link on this page that names that destination, and
          two links with the same accessible name pointing at the same place
          is a duplicate entry in every screen reader's link list.
        */}
        <p className="text-muted text-ui mt-8">
          <Link
            href="/about"
            className="text-accent focus-visible:ring-accent rounded underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
          >
            The longer list
          </Link>{" "}
          has the reasoning behind each one, and what is planned instead.
        </p>
      </section>
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
    detail: "The same questions of every paper, so the answers can be compared.",
  },
  {
    term: "Report",
    detail: "Evidence table and PRISMA diagram, from decisions you already made.",
  },
];

/*
 * On the front page, deliberately.
 *
 * Every one of these is a thing a reviewer might reasonably assume is here,
 * and finding out after importing three hundred papers is the expensive way
 * to learn it. Four of the six, kept short; /about carries the rest.
 */
const LIMITS: readonly string[] = [
  "It does not decide anything. There is no automatic screening and no relevance model picking papers for you — every decision is a person's, recorded under their name.",
  "It does not read PDFs for you. The reader works on the abstract; there is no file upload yet.",
  "It does not write your review. The evidence table and the diagram are outputs you take somewhere else.",
  "It is not a reference manager. It will take your BibTeX; it will not replace Zotero while you cite.",
];
