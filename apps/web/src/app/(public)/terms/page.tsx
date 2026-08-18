import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service and usage guidelines for porcupineResearch.",
};

/*
 * Written for both deployments, because there are two.
 *
 * The version this replaces was a hosted-SaaS template with the wrong details:
 * it defined the "Services" as including "storage subscription services" and
 * devoted a numbered section to billing information and non-refundable
 * subscription fees. There is no billing code in this project — that section
 * asked people to agree to charges nobody can levy.
 *
 * Its sub-processor paragraph, though, was right, and a later draft of this
 * page wrongly deleted it: the hosted service does run on Vercel with a
 * managed Supabase database. Section 5 names them again. Terms that
 * under-state where data goes fail in exactly the direction a privacy office
 * cares about.
 *
 * The clauses that genuinely fork are marked as forking. On your own copy
 * there is no licence to process your submissions, because nothing is
 * transmitted to us; on the hosted service there is a narrow one, and it says
 * what it is for.
 */
export default function TermsOfServicePage() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
      <PageHeader title="Terms of Service" description="Last updated 18 August 2026." />
      <div className="longform">
        <h2>Welcome</h2>
        <p>
          <strong>What this covers:</strong> porcupineResearch is software for managing a
          literature review. You can use it two ways, and these terms cover both: the{" "}
          <strong>hosted service</strong> at porcupineresearch.me, operated by Dhrubojyoti
          Saha, and <strong>your own copy</strong>, installed from the repository onto
          infrastructure you control. Where a clause applies to only one of them, it says
          so. Your use is subject to all applicable laws either way.
        </p>
        <p>
          <strong>Acceptance:</strong> by using the software you acknowledge that you have
          read and agree to these terms. If you disagree with them, the remedy is
          straightforward: do not run it.
        </p>
        <p>
          <strong>A consequence worth stating first.</strong> If you run your own copy,
          most of what a normal terms-of-service document controls is simply not ours to
          control. We cannot suspend your account, cannot see your data, cannot lose it,
          and cannot bill you for it. Several clauses below say so where a template would
          have claimed otherwise.
        </p>

        <h2>1. Your Account/Registration</h2>
        <p>
          <strong>Age:</strong> an account is created on your own instance, and you should
          be 13 or older to use the software. You are responsible for who else you invite
          to a project you administer.
        </p>
        <p>
          <strong>Account security is yours, including the recovery passphrase.</strong>{" "}
          The passphrase shown once at enrolment is the only thing standing between the
          database and your encrypted messages, and there is no reset — not withheld,
          genuinely absent. Nobody, including whoever administers your instance, can
          recover encrypted content once it is lost. That is what end-to-end encryption
          means, and it is the trade the <Link href="/security">security page</Link> sets
          out in full.
        </p>

        <h2>2. Your Submissions and Other Data</h2>
        <p>
          <strong>Your data is yours, and it never leaves your instance.</strong> We claim
          no ownership of anything you put into the software and no licence to process it
          — a licence to process would be meaningless, since nothing you enter is
          transmitted to us. Your library, decisions, notes and extracted answers live in
          a database you administer, and export to CSV and Excel whenever you want them
          out.
        </p>
        <p>
          <strong>What you put in is your responsibility.</strong> That includes copyright
          in material you import, and any ethics approval your data requires. The software
          will not check either.
        </p>

        <h2>3. Fees</h2>
        <p>
          <strong>There are none.</strong> No subscription, no seats, no storage plan, no
          card, on the hosted service or on your own copy. There is no billing code in
          this project — not disabled and not behind a flag — so there is nothing here to
          agree to about payment. If you self-host, the costs you carry are your own
          hardware, your own database and your own backups.{" "}
          <Link href="/pricing">Pricing</Link> explains why that is the arrangement, and
          what would have to change before it is not.
        </p>

        <h2>4. Acceptable Use and Conduct</h2>
        <p>
          <strong>What not to do with it:</strong> (a) do not impersonate anyone, inside a
          project or in an academic output drawn from one; (b) do not use the search
          feature to abuse the bibliographic providers — they are free public indexes,
          they rate-limit, and hammering them spoils it for everyone; (c) do not use it in
          violation of applicable law or of your institution&rsquo;s research-ethics
          requirements; (d) do not attempt to read another member&rsquo;s encrypted
          content, or to represent extracted data as having been checked by someone who
          did not check it.
        </p>
        <p>
          <strong>Reverse engineering is explicitly fine.</strong> A template would forbid
          it here. Read the source, audit the cryptography, modify it, run your own fork —
          the Apache License 2.0 grants you all of that, and a security claim you are not
          allowed to verify is not one worth making. The licence asks two things back:
          keep the notices, and mark the files you changed.
        </p>

        <h2>5. Third-Party Services and Integrations</h2>
        <p>
          <strong>Google, and only if you connect it:</strong> nothing touches Google
          until a project member deliberately connects an account. From then on, documents
          in that folder are held in that member&rsquo;s Google Drive under Google&rsquo;s
          terms, and you must comply with them. The scope requested is{" "}
          <code>drive.file</code>, which reaches only files this app created or the member
          explicitly picked; porcupineResearch adheres to the Google API Services User
          Data Policy, including its Limited Use requirements.
        </p>
        <p>
          <strong>Bibliographic providers:</strong> the search screen queries OpenAlex,
          Crossref, arXiv, Europe PMC and Semantic Scholar. They are third parties with
          their own terms, they may log your instance&rsquo;s address and your query, and
          they can be unavailable — the app is built to carry on when one of them is.
        </p>
        <p>
          <strong>Vercel and Supabase, on the hosted service.</strong> The application
          runs on Vercel; the database and the authentication that emails your sign-in
          code are managed by Supabase. Those two are the sub-processors and they are
          named here rather than in a list you have to request. If you run your own copy,
          neither is involved: the stack is PostgreSQL and a web server on machines you
          chose, and whoever runs those is your sub-processor rather than ours. See{" "}
          <Link href="/dpa">data processing</Link>.
        </p>

        <h2>6. Changes to and Termination of the Services</h2>
        <p>
          <strong>The software changes.</strong> Features are added, and occasionally
          removed — what shipped when is on the <Link href="/changelog">changelog</Link>.
          The hosted service is updated when the repository is, so it can change under
          you; a copy you run yourself changes only when you update it, because nobody
          else can deploy to it.
        </p>
        <p>
          <strong>The hosted service can be suspended; your own copy cannot.</strong>{" "}
          Access to porcupineresearch.me may be interrupted for maintenance, and may be
          withdrawn from an account that abuses it — the search providers in section 5 are
          free public indexes and hammering them costs everyone. That is the extent of it:
          no other reason to terminate is being reserved. And it is worth knowing that the
          exit is always open. Export to CSV and Excel works at any time, the source is
          public, and if this project stopped tomorrow a copy you run yourself would keep
          working.
        </p>

        <h2>7. Limitation of Liability</h2>
        <p>
          <strong>Damages:</strong> to the maximum extent permitted by applicable law, the
          author of this software will not be liable for any direct, indirect, incidental,
          special, consequential or punitive damages — including loss of data, loss of
          use, or lost work — arising from your use of or inability to use it.
        </p>
        <p>
          <strong>The specific one to plan for:</strong> lose your recovery passphrase and
          your encrypted messages and manuscripts cannot be recovered by anyone. Keep
          backups of your database, and keep the passphrase somewhere you would still have
          it after losing the machine.
        </p>

        <h2>8. Disclaimer of Warranties</h2>
        <p>
          <strong>Provided as is:</strong> the software comes with no warranty of any
          kind, express or implied, including fitness for a particular purpose. It is in
          active development and parts of it are not built — the{" "}
          <Link href="/features">features page</Link> lists which, and that list is
          maintained rather than decorative.
        </p>
        <p>
          <strong>It does not make your review correct.</strong> The app records
          decisions, enforces the rules you chose and refuses several things that would
          corrupt an audit trail. It does not judge papers, and the methodological
          soundness of your review remains yours and your supervisor&rsquo;s.
        </p>

        <h2>9. General</h2>
        <p>
          <strong>Entire agreement:</strong> these terms, together with the{" "}
          <strong>Apache License 2.0</strong> in the repository, are the whole of the
          agreement about using this software. Where the two meet, the licence governs the
          software and these terms govern the hosted service. Changes take effect when
          posted here, and material ones are recorded on the{" "}
          <Link href="/changelog">changelog</Link>.
        </p>
        <p>
          <strong>Contact Us:</strong> If you have any questions about these Terms, please
          contact us at{" "}
          <a href="mailto:dhrubojyoti.saha@g.bracu.ac.bd">
            dhrubojyoti.saha@g.bracu.ac.bd
          </a>
          .
        </p>
      </div>
    </main>
  );
}
