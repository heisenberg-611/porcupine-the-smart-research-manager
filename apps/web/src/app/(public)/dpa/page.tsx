import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Data processing",
  description:
    "Who is the controller and who is the processor on the hosted porcupineResearch service, which sub-processors it uses, and how the answers change when you run your own copy.",
};

/**
 * The page a research-ethics committee asks for, answered for BOTH deployments.
 *
 * There are two, and they have genuinely different answers — that is the whole
 * shape of this page. On porcupineresearch.me there is a processor (the person
 * running it) and two sub-processors (Vercel, Supabase). On a copy you install
 * yourself there is neither, because nothing leaves your infrastructure.
 *
 * Writing only the second one — as an earlier draft of this page did, on the
 * mistaken belief that no hosted service existed — is worse than useless. It
 * is the document a committee relies on, describing a data flow that is not
 * the one their researcher is actually using.
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
          <strong className="font-medium">Which deployment are you assessing?</strong> The
          answers below fork, and the fork is the most important thing on this page. On
          the <strong>hosted service</strong> at porcupineresearch.me your data sits on
          infrastructure someone else administers. On <strong>your own copy</strong> it
          never leaves yours, and no personal data in your projects reaches the author of
          this software at all.
        </p>
      </div>

      <div className="longform">
        <h2>Who is who</h2>

        <h3>On the hosted service</h3>
        <ul>
          <li>
            <strong>Controller: you</strong>, or your institution. You decide what
            personal data goes into the system, why, and for how long. If your review
            involves human-subjects data, your existing ethics approval governs it.
          </li>
          <li>
            <strong>Processor: Dhrubojyoti Saha</strong>, who operates the service and
            wrote the software. Processing is limited to running the application for you —
            there is no analytics, no profiling, no advertising, and no use of your
            research data for any purpose of ours.
          </li>
          <li>
            <strong>Sub-processors: Vercel</strong> (application hosting) and{" "}
            <strong>Supabase</strong> (managed PostgreSQL and authentication). Both are
            named here rather than in a list you have to request.
          </li>
        </ul>

        <h3>On your own copy</h3>
        <ul>
          <li>
            <strong>Controller: you.</strong> As above.
          </li>
          <li>
            <strong>Processor: also you.</strong> The software runs under your
            administration and nobody else holds credentials to your instance.
          </li>
          <li>
            <strong>The author of this software: neither.</strong> No telemetry, no
            analytics, no error reporting, no phone-home. There is no code in this project
            that sends anything about your usage anywhere, and you can verify that rather
            than take it on faith.
          </li>
        </ul>

        <h2>Where your instance reaches out</h2>
        <p>
          Three categories of outbound traffic exist in both deployments, and an ethics
          committee will want each of them named.
        </p>
        <ul>
          <li>
            <strong>Bibliographic search.</strong> Using the search screen queries
            OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar. What leaves is
            your query string and the server&rsquo;s IP address. These are public
            scholarly indexes; no project data, no member identity and no screening
            decision is sent. If even the query is sensitive, use import instead of search
            and no request is made.
          </li>
          <li>
            <strong>Email delivery.</strong> Sign-in codes are emailed. On the hosted
            service that goes through Supabase&rsquo;s mail provider, which sees the
            recipient address and the code. Running your own copy locally, it goes to a
            mail catcher on your machine and leaves nothing; point it at a real mail
            provider and that provider becomes your sub-processor.
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
          or not&rdquo;, it is <em>who can read it</em>. On the hosted service the answer
          for the middle tier is the operator and the sub-processors above; self-hosted,
          it is your own database administrator. Either way it is a real answer and it
          should go in the assessment.
        </p>
        <ul>
          <li>
            <strong>Unreadable to the server, in both deployments:</strong> project
            messages, direct messages and LaTeX sources. Sealed in the browser under keys
            derived from a passphrase the server never holds.
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
          threat model behind it. If your corpus composition is itself sensitive — which
          paper set a lab is reading can leak a research direction before publication —
          that is the fact that should decide between the two deployments.
        </p>

        <h2>Rights, retention and deletion</h2>
        <p>
          The app has project deletion, account deletion and export to CSV and Excel, so
          access, rectification and erasure requests can be satisfied through the
          interface on either deployment. Self-hosted, you hold the database and SQL
          covers whatever the app does not.
        </p>
        <p>
          <strong>
            Account deletion anonymises rather than erases, and the difference matters to
            an assessment.
          </strong>{" "}
          Email address, display name, avatar, ORCID, affiliation and every encryption key
          are destroyed; the user record itself survives, carrying the person&rsquo;s
          screening decisions, extractions and annotations under the label &ldquo;Former
          member&rdquo;. It has to: a review must be able to answer &ldquo;who excluded
          these forty papers, and when&rdquo; a year later, and that answer cannot be
          removable by one of the people who gave it. Treat it as pseudonymisation under
          Article 4(5), not erasure under Article 17.
        </p>
        <p>
          No retention period is imposed by this software: nothing expires, nothing is
          archived on your behalf, and nothing is kept after you delete it. On the hosted
          service, backups are the operator&rsquo;s to schedule and purge; on your own
          copy they are yours.
        </p>
        <p>
          One exception is worth stating because it surprises people: deleting a user does
          not make previously sent encrypted messages readable or unreadable to anyone
          else. Removing a member — or a member deleting their own account — flags the
          project key for rotation rather than rotating it there and then: the rotation
          happens in a browser, when one of that project&rsquo;s admins next unlocks it,
          because the server holds no key to rotate with. There is a window, and it is as
          long as it takes an admin to visit.
        </p>

        <h2>If you need a signed agreement</h2>
        <p>
          The hosted service is run by one person as academic infrastructure, not by a
          company with a legal department. If your institution requires a countersigned
          data-processing agreement, an audit right or a specific breach notification
          window before you can use it, the honest options are to ask —{" "}
          <a href="mailto:dhrubojyoti.saha@g.bracu.ac.bd">
            dhrubojyoti.saha@g.bracu.ac.bd
          </a>{" "}
          — or to run your own copy, where no agreement is needed because no third party
          is processing anything.
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
