import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Data processing",
  description:
    "Who is the controller and who is the processor when porcupineResearch runs on your own hardware — and why, today, that is you in both roles.",
};

/**
 * The page a research-ethics committee asks for, answered for the deployment
 * that actually exists.
 *
 * A conventional DPA describes a vendor processing personal data on a
 * customer's instructions. That relationship is not present here and drafting
 * one as though it were would be worse than useless — it would be the document
 * an ethics committee relies on, describing a service that does not run.
 *
 * porcupineResearch is self-hosted. The database is the reader's, on the
 * reader's infrastructure, and no personal data reaches the author of this
 * software at all. So the page says who the controller is (them), names the
 * sub-processors their instance will genuinely talk to (five bibliographic
 * APIs, and Google only if they connect it), and sets out what would have to
 * be signed if a hosted version ever existed.
 *
 * This is not legal advice and says so. It is a factual description of where
 * data goes, which is the thing a committee actually needs and the thing only
 * this project can supply.
 */
export default function DataProcessingPage() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
      <PageHeader
        title="Data processing"
        description="Written for a supervisor, an ethics committee or a university privacy office deciding whether this can be used on a study."
      />

      <div className="border-border bg-surface/50 rounded-[--radius-card] border p-6">
        <p className="text-ink text-ui text-pretty">
          <strong className="font-medium">
            There is no hosted service, so there is no processor to appoint.
          </strong>{" "}
          You install porcupineResearch on hardware you control, and it stores its data in
          a database you control. No personal data in your projects is transmitted to the
          author of this software, and none of it can be — there is nowhere for it to go.
        </p>
      </div>

      <div className="longform">
        <h2>Who is who</h2>
        <ul>
          <li>
            <strong>Controller: you</strong>, or your institution. You decide what
            personal data goes into the system, why, and for how long. If your review
            involves human-subjects data, your existing ethics approval governs it exactly
            as it would in a spreadsheet on the same machine.
          </li>
          <li>
            <strong>Processor: also you.</strong> The software runs under your
            administration. Nobody else holds credentials to your instance.
          </li>
          <li>
            <strong>The author of this software: neither.</strong> No telemetry, no
            analytics, no error reporting, no phone-home. There is no code in this project
            that sends anything about your usage anywhere, and you can verify that rather
            than take it on faith.
          </li>
        </ul>

        <h2>Where your instance does reach out</h2>
        <p>
          Self-hosted does not mean airtight. Three categories of outbound traffic exist,
          and an ethics committee will want each of them named.
        </p>
        <ul>
          <li>
            <strong>Bibliographic search.</strong> When you use the search screen your
            instance queries OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar.
            What leaves is your query string and your server&rsquo;s IP address. These are
            public scholarly indexes; no project data, no member identity and no screening
            decision is sent. If even the query is sensitive, use import instead of search
            and no request is made.
          </li>
          <li>
            <strong>Email delivery.</strong> Sign-in codes are emailed. Locally they go to
            a mail catcher on your own machine and leave nothing; if you point the
            instance at a real mail provider, that provider sees the recipient address and
            the code. Choosing that provider is your decision and they become your
            sub-processor.
          </li>
          <li>
            <strong>Google Workspace, only if connected.</strong> Nothing touches Google
            until a project member deliberately connects an account. From then on,
            documents in that folder are held by Google under Google&rsquo;s terms, in
            that member&rsquo;s Drive — outside this application&rsquo;s boundary
            entirely, and readable by Google. The scope requested is{" "}
            <code>drive.file</code>, which reaches only files this app created or the
            member explicitly picked.
          </li>
        </ul>

        <h2>Which data is which</h2>
        <p>
          The distinction that matters most for a risk assessment is not &ldquo;encrypted
          or not&rdquo;, it is <em>who can read it</em>. Since you run the server, the
          answer for the middle tier is: your database administrator. That is a real
          answer and it should go in the assessment.
        </p>
        <ul>
          <li>
            <strong>Unreadable to the server:</strong> project messages, direct messages
            and LaTeX sources. Sealed in the browser under keys derived from a passphrase
            the server never holds.
          </li>
          <li>
            <strong>Readable to whoever administers the database:</strong> membership and
            roles, screening decisions, annotations, extracted answers, and the activity
            log. This has to be readable — sorting, counting and the PRISMA diagram are
            all work done on it.
          </li>
          <li>
            <strong>Public by nature:</strong> paper titles, DOIs, authors and venues.
          </li>
        </ul>
        <p>
          <Link href="/security">The security page</Link> has the full table and the
          threat model behind it.
        </p>

        <h2>Rights, retention and deletion</h2>
        <p>
          Because you hold the database, you can satisfy access, rectification and erasure
          requests directly — the app has project and account deletion, and SQL covers
          whatever it does not. There is no retention period imposed by this software:
          nothing expires, nothing is archived on your behalf, and nothing is kept after
          you delete it. Backups are yours to schedule and yours to purge.
        </p>
        <p>
          One exception is worth stating because it surprises people: deleting a user does
          not make previously sent encrypted messages readable or unreadable to anyone
          else. Removing a member does rotate the project key, so they cannot read what is
          said after they leave.
        </p>

        <h2>If a hosted version ever exists</h2>
        <p>
          Then there would be a processor, and this page would be replaced by an actual
          agreement — sub-processor list, breach notification window, audit rights,
          transfer mechanism, the rest. It would be published before the service opened
          rather than after, and existing self-hosted instances would be unaffected,
          because they would still be yours.
        </p>

        <h2>Not legal advice</h2>
        <p>
          This page describes where data goes. It is not a legal opinion and it is not a
          substitute for your institution&rsquo;s own review. If your privacy office needs
          something in a particular form, the factual detail they will need is here, on{" "}
          <Link href="/security">security</Link>, and in the{" "}
          <Link href="/privacy">privacy policy</Link> — and the source is available so
          they can check any of it.
        </p>
      </div>
    </main>
  );
}
