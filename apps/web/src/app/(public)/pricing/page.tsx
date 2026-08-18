import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "porcupineResearch is free. There is no paid tier, no trial, and no hosted version yet — you run it on your own machine, against your own database.",
};

/**
 * The honest version of a pricing page.
 *
 * The one this replaces said the app is "free for students" and then stopped,
 * which leaves the two questions a reader actually has unanswered: free
 * compared to what, and what happens when it stops being free. Meanwhile the
 * privacy policy — a separate page, written separately — announced that
 * development is funded "through subscriptions for additional features and
 * storage space", describing a business that does not exist. Two pages, two
 * different stories, both wrong in different directions.
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
        description="It is free, and there is nothing to sign up to. What that costs you instead is that you have to run it yourself."
      />

      <div className="border-rule bg-surface/50 rounded-[--radius-card] border p-8">
        <p className="text-accent text-fine font-mono tracking-widest uppercase">
          Every feature
        </p>
        <p className="text-ink mt-3 font-serif text-5xl">Free</p>
        <p className="text-ink-soft text-ui mt-4 text-pretty">
          No trial, no seats, no card, no feature held back for a paid tier. There is no
          billing code in this project — not disabled, not behind a flag.
        </p>
      </div>

      <div className="longform">
        <h2>What you get</h2>
        <ul>
          <li>
            Every screen described on the <Link href="/features">features page</Link>,
            with no limits on projects, papers, protocol questions or team members.
          </li>
          <li>
            The full source, under the terms in the repository. Your data is in a Postgres
            database you control, and it exports to CSV and Excel whenever you want it
            out.
          </li>
          <li>
            Encryption for messages and LaTeX sources, with the keys held in your browser
            rather than on a server. See <Link href="/security">security</Link>.
          </li>
        </ul>

        <h2>What it costs you instead</h2>
        <p>
          There is <strong>no hosted version</strong>. porcupineResearch runs on your own
          machine against your own database, which means someone has to install Docker,
          start the stack and keep the backups. For a lab with an IT department that is a
          morning; for a student on a laptop it is a real afternoon, and it is the honest
          price of the page above saying Free.
        </p>
        <p>
          It also means you cannot send a colleague a link to your project. Everyone
          working on a review has to be on the same instance, so today that is a shared
          machine or a server somebody in the group set up.
        </p>

        <h2>Will it stay free?</h2>
        <p>
          Free for students and for academic research is the intention, and the licence in
          the repository is what actually holds that open — not this sentence. If a hosted
          version is ever offered, the thing being charged for would be somebody else
          running the server and taking the backups, not features removed from the version
          you can run yourself.
        </p>
        <p>
          If that changes, it will be announced on the{" "}
          <Link href="/changelog">changelog</Link> before it takes effect, not applied to
          accounts that already exist.
        </p>

        <h2>Academic and institutional use</h2>
        <p>
          Use it for a thesis, a departmental review, or a funded study. There is no
          separate licence to request and no quote to ask for. If your university's
          privacy office needs the data-handling detail before you can use it on
          human-subjects research, the pages they will want are{" "}
          <Link href="/security">security</Link>, <Link href="/privacy">privacy</Link> and
          the <Link href="/dpa">data processing terms</Link> — all three are written for
          exactly that reader.
        </p>
      </div>
    </main>
  );
}
