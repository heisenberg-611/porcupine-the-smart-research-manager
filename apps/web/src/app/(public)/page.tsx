import type { Metadata } from "next";
import Link from "next/link";

import { ContributorAvatar } from "@/components/contributor-avatar";
import { ButtonLink } from "@/components/ui";
import { getContributors, BADGE_STYLES } from "@/lib/contributors";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  description:
    "Run a systematic review or a thesis literature search end to end: find papers across five databases, screen them with your reasons recorded, extract the same questions from every one, and get the evidence table and PRISMA diagram out at the end.",
};

export default async function Home() {
  const user = await getCurrentUser();
  const contributors = getContributors().slice(0, 4);

  return (
    <main id="main" className="mx-auto max-w-5xl px-6 py-16 sm:py-13">
      <header className="border-rule border-b pb-15">
        <p className="text-accent text-fine font-mono tracking-widest uppercase sm:text-2xl">
          Literature review software
        </p>

        <h1 className="text-ink mt-6 font-serif text-4xl leading-tight tracking-tight text-balance sm:text-6xl">
          Every paper you read, in one defensible pile.
        </h1>

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

      {/* Six Stages */}
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
              <h3 className="text-ink text-heading mt-2 font-serif font-bold">{term}</h3>
              <p className="text-ink-soft text-ui mt-3 leading-relaxed text-pretty">
                {detail}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Community Feedback & Contributions Showcase */}
      <section aria-labelledby="community" className="border-rule mt-16 border-t pt-12">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-accent text-fine font-mono tracking-wider uppercase font-semibold">
              Shaped by Researchers
            </p>
            <h2 id="community" className="text-ink text-title font-serif mt-1">
              Feedback & Contributions
            </h2>
            <p className="text-muted measure text-ui mt-2 text-pretty">
              Recognizing the beta testers, methodology advisors, and developers who have contributed ideas and feedback to upgrade porcupineResearch.
            </p>
          </div>

          <Link
            href="/feedback-and-contributions"
            className="text-accent hover:text-ink hover:underline font-mono text-xs font-semibold shrink-0 transition-colors"
          >
            View all contributors ({getContributors().length}) →
          </Link>
        </div>

        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {contributors.map((c, index) => {
            const badgeStyle = BADGE_STYLES[c.badge] || {
              bg: "bg-accent/15",
              text: "text-accent",
              border: "border-accent/25",
            };

            return (
              <div
                key={`${c.id || "contributor"}-${index}`}
                className="border-border/70 bg-raised/70 flex flex-col justify-between rounded-2xl border p-5 shadow-xs transition-all hover:border-accent/40 hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <ContributorAvatar name={c.name} avatar={c.avatar} size="sm" />
                      <div>
                        <h4 className="text-ink font-serif font-bold text-sm">
                          {c.name}
                        </h4>
                        <p className="text-muted text-[11px] truncate max-w-[200px]">
                          {c.role}
                        </p>
                      </div>
                    </div>

                    {c.badge ? (
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                      >
                        {c.badge}
                      </span>
                    ) : null}
                  </div>

                  <p className="text-ink-soft text-xs mt-3.5 leading-relaxed italic bg-surface/60 rounded-xl p-3 border border-border/50">
                    "{c.contribution}"
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-center">
          <Link
            href="/feedback-and-contributions"
            className="border-border bg-surface text-ink hover:bg-surface-hover hover:border-accent/40 focus-visible:ring-accent rounded-xl border px-5 py-2.5 font-mono text-xs font-semibold shadow-xs transition-all focus-visible:ring-2 focus-visible:outline-none"
          >
            See all contributions & leave feedback →
          </Link>
        </div>
      </section>

      {/* Limits / What it will not do */}
      <section aria-labelledby="honest" className="border-rule mt-16 border-t pt-12">
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

const LIMITS: readonly string[] = [
  "It does not decide anything. There is no automatic screening and no relevance model picking papers for you — every decision is a person's, recorded under their name.",
  "It does not read PDFs for you. The reader works on the abstract; there is no file upload yet.",
  "It does not write your review. The evidence table and the diagram are outputs you take somewhere else.",
  "It is not a reference manager. It will take your BibTeX; it will not replace Zotero while you cite.",
];
