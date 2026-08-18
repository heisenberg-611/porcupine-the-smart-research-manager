import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "porcupineResearch is free. There is no paid tier, no trial and no card — use the hosted version at porcupineresearch.me, or run your own copy against your own database.",
};

/**
 * The honest version of a pricing page.
 *
 * The one this replaces said the app is "free for students" and then stopped,
 * which leaves the two questions a reader actually has unanswered: free
 * compared to what, and what happens when it stops being free. Meanwhile the
 * privacy policy — a separate page, written separately — announced that
 * development is funded "through subscriptions for additional features and
 * storage space", describing a business that does not exist.
 *
 * There is no billing code in this repository. Saying so is not a promise
 * never to charge; it is the difference between a page that is true today and
 * one that has to be corrected later.
 */
export default function PricingPage() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
      <PageHeader
        title="Pricing"
        description="Free, on the hosted service and on your own machine alike. There is no paid tier to compare this against, and no card to enter."
      />

      <div className="border-rule bg-surface/50 rounded-[--radius-card] border p-8">
        <p className="text-accent text-fine font-mono tracking-widest uppercase">
          Every feature
        </p>
        <p className="text-ink mt-3 font-serif text-5xl">Free</p>
        <p className="text-ink-soft measure text-ui mt-4 text-pretty">
          No trial, no seats, no card, no feature held back for a paid tier. There is no
          billing code in this project — not disabled, not behind a flag.
        </p>
      </div>

      <div className="longform">
        <h2>Two ways to run it, both free</h2>
        <p>
          <strong>Hosted.</strong> This site is the app.{" "}
          <Link href="/sign-in">Sign in</Link> and you have a project in about a minute —
          no install, no Docker, no database to look after. It runs on Vercel with a
          managed Supabase database, and it is maintained by Dhrubojyoti Saha, who also
          wrote it. That is the version to use unless you have a specific reason not to.
        </p>
        <p>
          <strong>Your own copy.</strong> The source is on GitHub and the README is the
          install: clone it, point it at a Postgres database you control, run it. Same
          features, same code, none of it held back — the{" "}
          <Link href="/guides">guides page</Link> covers the setup and the things that
          trip people up.
        </p>
        <p>
          Choose the second one when the corpus itself is sensitive, or when your
          institution requires that research data stays on its own infrastructure. That is
          a real requirement in a lot of departments, and the answer to it should not be
          &ldquo;trust us&rdquo;.
        </p>

        <h2>What you get, either way</h2>
        <ul>
          <li>
            Every screen described on the <Link href="/features">features page</Link>,
            with no limits on projects, papers, protocol questions or team members.
          </li>
          <li>
            Export to CSV and Excel whenever you want your data out, with protocol
            question keys as column headers so a script keeps working.
          </li>
          <li>
            Encryption for messages and LaTeX sources, with the keys held in your browser
            rather than on a server. See <Link href="/security">security</Link>.
          </li>
          <li>
            The full source under the Apache License 2.0, patent grant included. Fork it,
            audit it, change it, run it for a department.
          </li>
        </ul>

        <h2>What the hosted version costs you instead</h2>
        <p>
          Convenience is paid for in trust. On <strong>porcupineresearch.me</strong> your
          library, screening decisions, annotations and extracted answers sit in a
          database somebody else administers — that is what &ldquo;hosted&rdquo; means,
          and no amount of encryption at rest changes who holds the keys to the machine.
          Your messages and manuscripts are the exception: those are end-to-end encrypted
          and unreadable to the server by construction.
        </p>
        <p>
          <Link href="/security">Security</Link> sets out exactly which data is in which
          tier, and <Link href="/dpa">data processing</Link> is written for the privacy
          office that will ask.
        </p>

        <h2>Will it stay free?</h2>
        <p>
          Free for students and for academic research is the intention, and what holds
          that open is not this sentence. The source is under the{" "}
          <strong>Apache License 2.0</strong>, which cannot be withdrawn from a release
          already made, and the exports work — so if the hosted service ever charged you
          could take your data and run your own copy the same afternoon. If it does
          charge, the thing being charged for would be the running of it — the server, the
          backups, the support — and not features removed from the version you can run
          yourself.
        </p>
        <p>
          If that changes, it will be announced on the{" "}
          <Link href="/changelog">changelog</Link> before it takes effect, not applied to
          accounts that already exist.
        </p>

        <h2>Academic and institutional use</h2>
        <p>
          Use it for a thesis, a departmental review, or a funded study. There is no
          separate licence to request and no quote to ask for. If your university&rsquo;s
          privacy office needs the data-handling detail before you can use the hosted
          version on human-subjects research, the pages they will want are{" "}
          <Link href="/security">security</Link>, <Link href="/privacy">privacy</Link> and
          the <Link href="/dpa">data processing terms</Link> — all three are written for
          exactly that reader, and all three say plainly where the self-hosted answer
          differs.
        </p>
      </div>
    </main>
  );
}
