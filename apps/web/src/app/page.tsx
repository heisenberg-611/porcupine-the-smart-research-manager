import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ButtonLink } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Porcupine",
};

/**
 * The landing page.
 *
 * Rewritten from the Phase 0 placeholder, which had gone stale in three ways
 * that all mattered:
 *
 *   - it announced "Phase 0 · Foundations" long after Phase 1 shipped;
 *   - it advertised RLS, concurrency isolation and encryption — true, and
 *     completely uninteresting to a researcher deciding whether to try this.
 *     Those are reasons the tool can be trusted, not reasons to want it;
 *   - it had NO sign-in link, so a visitor could read about the product and
 *     then had no way into it.
 *
 * A signed-in visitor is sent straight to their projects. Landing on a
 * marketing page when you have screening waiting is a small insult repeated
 * every session.
 */
export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/projects");

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-ink text-4xl font-semibold tracking-tight text-balance">
        Porcupine
      </h1>
      <p className="text-muted mt-4 text-lg text-pretty">
        Research and thesis management — read, screen, extract, synthesize, and write,
        without keeping tabs on a thousand things across a dozen websites.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/sign-in" variant="primary">
          Sign in
        </ButtonLink>
      </div>

      {/* What the tool does, in the order someone actually does it. The
          previous version listed security properties here, which answer a
          question nobody asks before they have tried it. */}
      <dl className="border-border bg-border mt-14 grid gap-px overflow-hidden rounded-xl border sm:grid-cols-3">
        {[
          {
            term: "Find",
            detail:
              "Search five bibliographic databases at once. Duplicates merge before you see them.",
          },
          {
            term: "Screen",
            detail:
              "Include or exclude with a reason. The PRISMA diagram writes itself from your decisions.",
          },
          {
            term: "Read",
            detail:
              "Highlight and annotate. Quotes stay anchored to the passage, and say so when they drift.",
          },
        ].map(({ term, detail }) => (
          <div key={term} className="bg-surface px-4 py-5">
            <dt className="text-ink text-sm font-medium">{term}</dt>
            <dd className="text-muted mt-1 text-sm text-pretty">{detail}</dd>
          </div>
        ))}
      </dl>

      <p className="text-muted mt-8 text-sm text-pretty">
        Built for teams: supervisors and collaborators are never billed per seat, and
        every screening decision is attributable to the person who made it.
      </p>
    </main>
  );
}
