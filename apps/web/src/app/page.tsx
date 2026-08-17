import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

import { ButtonLink } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";
import logo from "./logo.png";

export const metadata: Metadata = {
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
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            :root {
              --color-canvas: #fbfaf7 !important;
              --color-surface: #f4f2ec !important;
              --color-raised: #ffffff !important;
              --color-border: #e5e1d8 !important;
              --color-rule: #ddd8cc !important;

              --color-ink: #1c1a17 !important;
              --color-ink-soft: #3f3b34 !important;
              --color-muted: #66615a !important;

              --color-accent: #2f6f5e !important;
              --color-accent-ink: #ffffff !important;
              --color-accent-soft: #e7efeb !important;
              --color-danger: #9c2f26 !important;
              --color-danger-soft: #f7ebe9 !important;
              
              color-scheme: light !important;
            }
          `,
        }}
      />
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
                alt="porcupineResearch Logo"
                className="w-20 h-20 sm:w-24 sm:h-24 object-contain rounded-2xl shadow-sm drop-shadow-xl"
                priority
              />
              <h1 className="text-ink font-serif text-5xl leading-tight tracking-tight text-balance sm:text-7xl">
                porcupineResearch
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

        <footer className="border-rule mt-24 border-t pt-16 pb-8">
          <div className="grid grid-cols-1 gap-12 md:grid-cols-4 lg:grid-cols-5">
            <div className="lg:col-span-2 flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <Image src={logo} alt="porcupineResearch Logo" className="w-10 h-10 object-contain rounded shadow-sm" />
                <span className="text-ink font-sans text-2xl font-bold tracking-tight">porcupineResearch</span>
              </div>
              <p className="text-ink-soft font-medium text-sm leading-relaxed text-pretty max-w-sm">
                Research and thesis management: read, screen, extract, synthesize, and write — without keeping tabs on a thousand things across a dozen websites.
              </p>
              <div className="text-muted text-fine space-y-1">
                <p>Designed & Developed by Dhrubojyoti</p>
                <p>Contact: <a href="mailto:dhrubojyoti.saha@g.bracu.ac.bd" className="hover:text-ink transition-colors hover:underline">dhrubojyoti.saha@g.bracu.ac.bd</a></p>
              </div>
            </div>

            <div>
              <h3 className="text-ink font-semibold mb-4 text-sm">Product</h3>
              <ul className="space-y-3 text-muted text-fine">
                <li><Link href="/features" className="hover:text-ink transition-colors">Features</Link></li>
                <li><Link href="/pricing" className="hover:text-ink transition-colors">Pricing</Link></li>
                <li><Link href="/security" className="hover:text-ink transition-colors">Security</Link></li>
                <li><Link href="/changelog" className="hover:text-ink transition-colors">Changelog</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-ink font-semibold mb-4 text-sm">Resources</h3>
              <ul className="space-y-3 text-muted text-fine">
                <li><Link href="/about" className="hover:text-ink transition-colors">Documentation</Link></li>
                <li><Link href="/guides" className="hover:text-ink transition-colors">Guides</Link></li>
                <li><Link href="/api" className="hover:text-ink transition-colors">API Reference</Link></li>
                <li><Link href="/blog" className="hover:text-ink transition-colors">Blog</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-ink font-semibold mb-4 text-sm">Legal</h3>
              <ul className="space-y-3 text-muted text-fine">
                <li><Link href="/privacy" className="hover:text-ink transition-colors">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-ink transition-colors">Terms of Service</Link></li>
                <li><Link href="/dpa" className="hover:text-ink transition-colors">Data Processing</Link></li>
                <li><Link href="/cookies" className="hover:text-ink transition-colors">Cookie Policy</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-rule mt-16 flex flex-col md:flex-row items-center justify-between border-t pt-8">
            <p className="text-muted text-xs">&copy; {new Date().getFullYear()} porcupineResearch. All rights reserved.</p>
            <div className="flex gap-4 mt-4 md:mt-0 text-muted">
              <a href="https://x.com/Dhruboj52821394" target="_blank" rel="noreferrer" className="hover:text-ink transition-colors" aria-label="X">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.005 4.15H5.059z" /></svg>
              </a>
              <a href="https://github.com/heisenberg-611" target="_blank" rel="noreferrer" className="hover:text-ink transition-colors" aria-label="GitHub">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" /></svg>
              </a>
              <a href="https://linkedin.com/in/dhrubojyoti-saha-3084a02bb/" target="_blank" rel="noreferrer" className="hover:text-ink transition-colors" aria-label="LinkedIn">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fillRule="evenodd" d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" clipRule="evenodd" /></svg>
              </a>
            </div>
          </div>
        </footer>
      </main>
    </>
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
