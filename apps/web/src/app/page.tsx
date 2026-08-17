import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

import { ButtonLink } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import logo from "./logo.png";

export const metadata: Metadata = {
  title: "Porcupine",
  description:
    "Run a systematic review or a thesis literature search end to end: find papers across five databases, screen them with your reasons recorded, extract the same fields from every one, and get the evidence table and PRISMA diagram out at the end.",
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
 */
export default async function Home() {
  const user = await getCurrentUser();

  return (
    <main
      id="main"
      className="mx-auto flex min-h-[calc(100dvh-var(--app-header-h))] max-w-5xl flex-col px-6 py-16"
    >
      <div className="flex-1">
        <header className="border-rule mb-20 border-b pb-12">
          <p className="text-accent text-ui mb-6 font-mono tracking-widest uppercase">
            Literature Review Software
          </p>
          <div className="flex items-center gap-6">
            <Image
              src={logo}
              alt="Porcupine Logo"
              className="w-20 h-20 sm:w-24 sm:h-24 object-contain rounded-2xl shadow-sm drop-shadow-xl"
              priority
            />
            <h1 className="text-ink font-serif text-5xl leading-tight tracking-tight text-balance sm:text-7xl">
              Porcupine
            </h1>
          </div>
          <p className="text-ink text-display mt-6 max-w-3xl font-serif leading-tight text-balance">
            Every paper you read, in one defensible pile.
          </p>

          <p className="text-ink-soft measure text-body mt-8 text-pretty">
            A literature review, from the first search to the finished evidence table. For
            teams running a systematic review that has to be reproducible, and for
            students running a thesis search on the same machinery.
          </p>

          <div className="bg-surface border-rule mt-8 rounded-xl border p-6">
            <h2 className="text-ink font-medium">Seamless Google Workspace Integration</h2>
            <p className="text-muted text-ui mt-2 text-pretty">
              Porcupine's core purpose is to help research teams organize and collaborate on their systematic reviews.
              By connecting your Google account, Porcupine automatically provisions shared Google Drive folders for your projects,
              creates Google Docs for collaborative paper drafting, and exports completed extraction tables to Google Sheets.
            </p>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            {user ? (
              <ButtonLink href="/dashboard" variant="primary">
                Go to your dashboard
              </ButtonLink>
            ) : (
              <ButtonLink href="/sign-in" variant="primary">
                Sign in
              </ButtonLink>
            )}
            <ButtonLink href="/about">How it works</ButtonLink>
          </div>
        </header>

        <section aria-label="Definitions" className="mb-16">
          <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            <div>
              <dt className="text-ink font-medium">Systematic review</dt>
              <dd className="text-muted text-ui mt-1 text-pretty">
                A literature review that finds, evaluates, and synthesizes all available
                evidence on a specific research question using a repeatable methodology.
              </dd>
            </div>
            <div>
              <dt className="text-ink font-medium">Protocol</dt>
              <dd className="text-muted text-ui mt-1 text-pretty">
                The predefined set of questions or fields that you will record about every
                included paper, ensuring that the final data is comparable.
              </dd>
            </div>
            <div>
              <dt className="text-ink font-medium">Screening</dt>
              <dd className="text-muted text-ui mt-1 text-pretty">
                The process of reviewing papers against your criteria to determine if they
                belong in the final review.
              </dd>
            </div>
            <div>
              <dt className="text-ink font-medium">PRISMA</dt>
              <dd className="text-muted text-ui mt-1 text-pretty">
                An evidence-based minimum set of items for reporting in systematic
                reviews, typically visualised as a flow diagram.
              </dd>
            </div>
          </dl>
        </section>

        <section aria-label="Workflow steps" className="mb-10">
          <ol className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(({ term, detail }, index) => (
              <li
                key={term}
                className="bg-surface/50 border-rule rounded-[--radius-card] border p-6"
              >
                <p className="text-accent text-fine mb-2 font-mono">
                  Step {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="text-ink text-title font-serif">{term}</h2>
                <p className="text-ink-soft text-ui mt-3 leading-relaxed text-pretty">
                  {detail}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className="border-rule mt-16 flex flex-col justify-between gap-10 border-t pt-10 pb-12 md:flex-row">
        <div className="max-w-lg">
          <p className="text-ink mb-2 font-medium">Privacy & Encryption</p>
          <p className="text-muted text-fine leading-relaxed text-pretty">
            Your notes and messages are encrypted in your browser, so we cannot read them
            — and cannot recover them for you either.{" "}
            <Link
              href="/about"
              className="text-accent hover:text-ink underline underline-offset-4 transition-colors"
            >
              What that means, and what this does not do
            </Link>
            .
          </p>
        </div>
        <div className="text-muted text-fine md:text-right">
          <p className="text-ink font-medium">Porcupine</p>
          <p className="mt-2">Designed & Developed by Dhrubojyoti</p>
          <p className="mt-1">&copy; {new Date().getFullYear()} All rights reserved.</p>
          <p className="mt-3 space-x-4">
            <Link href="/privacy" className="hover:text-ink underline underline-offset-4 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-ink underline underline-offset-4 transition-colors">Terms of Service</Link>
          </p>
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
