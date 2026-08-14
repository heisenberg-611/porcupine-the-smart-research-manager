import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Porcupine",
};

/**
 * Placeholder root. Phase 0's exit criterion is "create a project, invite a
 * member, and nothing else" — this page exists so the build, the a11y gate,
 * and the deploy pipeline have something real to run against.
 */
export default function Home() {
  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-24">
      <p className="text-muted font-mono text-xs tracking-widest uppercase">
        Phase 0 · Foundations
      </p>
      <h1 className="text-ink mt-4 text-4xl font-semibold tracking-tight text-balance">
        Porcupine
      </h1>
      <p className="text-muted mt-4 text-lg text-pretty">
        Research and thesis management — read, screen, extract, synthesize, and write,
        without keeping tabs on a thousand things across a dozen websites.
      </p>

      <dl className="border-border bg-border mt-12 grid gap-px overflow-hidden rounded-[--radius-card] border sm:grid-cols-3">
        {[
          { term: "RLS", detail: "forced on every table" },
          { term: "Isolation", detail: "proven under concurrency" },
          { term: "Encryption", detail: "messages + LaTeX" },
        ].map(({ term, detail }) => (
          <div key={term} className="bg-surface px-4 py-5">
            <dt className="text-ink text-sm font-medium">{term}</dt>
            <dd className="text-muted mt-1 text-sm">{detail}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
