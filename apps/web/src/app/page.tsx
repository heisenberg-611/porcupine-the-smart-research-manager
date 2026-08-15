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

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <main id="main" className="mx-auto max-w-5xl px-6 py-16 flex flex-col min-h-[calc(100dvh-var(--app-header-h))]">
      <div className="flex-1">
        <header className="mb-20 pb-12 border-b border-rule">
          <p className="text-accent text-ui font-mono tracking-widest uppercase mb-4">
            The Smart Research Manager
          </p>
          <h1 className="text-ink text-5xl sm:text-7xl font-serif tracking-tight text-balance leading-tight">
            Porcupine
          </h1>
          <p className="text-ink text-display font-serif mt-6 text-balance leading-tight max-w-3xl">
            Every paper you read, in one defensible pile.
          </p>

          <p className="text-ink-soft measure text-body mt-8 text-pretty">
            A literature review, from the first search to the finished evidence table. For
            teams running a systematic review that has to be reproducible, and for students
            running a thesis search on the same machinery.
          </p>

          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <ButtonLink href="/sign-in" variant="primary">
              Sign in
            </ButtonLink>
            <ButtonLink href="/about">
              How it works
            </ButtonLink>
          </div>
        </header>

        <section aria-label="Workflow steps" className="mb-10">
          <ol className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(({ term, detail }, index) => (
              <li key={term} className="bg-surface/50 p-6 rounded-[--radius-card] border border-rule">
                <p className="text-accent text-fine font-mono mb-2">
                  Step {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="text-ink text-title font-serif">{term}</h2>
                <p className="text-ink-soft text-ui mt-3 text-pretty leading-relaxed">
                  {detail}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className="mt-16 border-t border-rule pt-10 pb-12 flex flex-col md:flex-row justify-between gap-10">
        <div className="max-w-lg">
          <p className="text-ink font-medium mb-2">Privacy & Encryption</p>
          <p className="text-muted text-fine text-pretty leading-relaxed">
            Your notes and messages are encrypted in your browser, so we cannot read them —
            and cannot recover them for you either.{" "}
            <Link href="/about" className="text-accent underline underline-offset-4 hover:text-ink transition-colors">
              What that means, and what this does not do
            </Link>
            .
          </p>
        </div>
        <div className="text-muted text-fine md:text-right">
          <p className="text-ink font-medium">Porcupine Research Manager</p>
          <p className="mt-2">Designed & Developed by Dhrubojyoti</p>
          <p className="mt-1">&copy; {new Date().getFullYear()} All rights reserved.</p>
        </div>
      </footer>
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
