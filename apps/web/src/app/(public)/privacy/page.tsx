import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for porcupineResearch research management platform.",
};

/*
 * Corrected against what this software actually does.
 *
 * The version this replaces described a business that does not exist:
 * development funded "through subscriptions for additional features and
 * storage space", and attachment files "like PDFs" collected when you upload
 * them. There is no billing code in this project, and no file upload anywhere
 * in the app.
 *
 * There ARE servers, and this page has to say whose. The hosted service runs
 * on Vercel with a managed Supabase database; those are the sub-processors and
 * they are named. What the page must not do is describe only that deployment,
 * because a reader running their own copy has a different and much shorter
 * answer to nearly every question below. Both are here, and where they differ
 * the difference is stated rather than averaged into something true of
 * neither.
 *
 * A privacy policy that overstates what is collected is not the safe direction
 * to err in. It is the document a university privacy office relies on, and one
 * that describes a data flow which does not happen is exactly as useless as one
 * that omits a flow which does.
 */
export default function PrivacyPolicyPage() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
      <PageHeader title="Privacy Policy" description="Last updated 18 August 2026." />
      <div className="longform">
        <h2>Overview</h2>
        <p>
          <strong>Your Data is Yours:</strong> porcupineResearch is a project committed to
          providing the best tool for managing your research, literature reviews, and
          thesis writing. Our philosophy is that what you put into porcupineResearch is
          yours, and one of our founding principles is to make sure you remain in control
          of your data and can share it how you like — or choose not to share it at all.
        </p>
        <p>
          <strong>No financial interest in your data:</strong> we do not sell it, and
          there is no mechanism by which we could — porcupineResearch is free, has no
          billing code in it, and runs on infrastructure you control rather than ours. See
          the <Link href="/pricing">pricing page</Link> for what that means and what it
          costs you instead.
        </p>

        <h2>Data We Collect</h2>
        <p>
          &ldquo;Collect&rdquo; below means{" "}
          <em>stored in the database your instance runs against</em>. On the hosted
          service at porcupineresearch.me that is a managed Supabase database administered
          by Dhrubojyoti Saha; on a copy you run yourself it is a database you administer,
          and none of it reaches us at all. In neither case is there telemetry, analytics
          or error reporting — the app contains no code that would report your usage
          anywhere.
        </p>
        <ul>
          <li>
            <strong>Account information:</strong> the display name and email address you
            give when you create an account. There is no password, so none is stored;
            sign-in is a six-digit code sent to that address.
          </li>
          <li>
            <strong>Library and project data:</strong> the papers you add, your screening
            decisions and the reasons for them, your highlights and notes, and the answers
            you record against a protocol.
          </li>
          <li>
            <strong>Activity:</strong> who did what and when, within a project. This is
            what makes a review auditable, and it is not optional — a decision nobody can
            account for is worth less than no decision.
          </li>
          <li>
            <strong>Access logs:</strong> whatever your own web server or hosting provider
            records. That is your configuration, and your retention policy.
          </li>
        </ul>
        <p>
          <strong>There is no file upload.</strong> The reader works on abstracts, so no
          PDFs or other attachments are stored anywhere in the app today.
        </p>

        <h2>Security and Encryption of Stored Data</h2>
        <p>
          Four tiers, and the distinction that matters is not encrypted-or-not but{" "}
          <em>who can read it</em>. Since you run the server, the answer for the middle
          tier is your own database administrator.{" "}
          <Link href="/security">The security page</Link> has the full table and the
          threat model behind it.
        </p>
        <ul>
          <li>
            <strong>End-to-End Encrypted (E2EE):</strong> Messages (channels and DMs) and
            LaTeX sources are fully end-to-end encrypted using XChaCha20-Poly1305. The
            server stores only ciphertext, meaning we cannot read this data, nor can we
            recover it for you if you lose access.
          </li>
          <li>
            <strong>Server-confidential:</strong> membership, roles, screening status,
            annotations, extraction values and activity logs are protected by row-level
            security and encryption at rest. The server can read these, and it has to —
            sorting, filtering, counting and the PRISMA diagram are all work done on
            exactly this data.
          </li>
          <li>
            <strong>Public:</strong> scholarly metadata — paper titles, DOIs, authors,
            venues — and member display names, stored plainly. This is bibliographic data
            that is public by construction.
          </li>
          <li>
            <strong>Third-party:</strong> anything written in a connected Google Doc lives
            in that member&rsquo;s Google Drive under Google&rsquo;s terms. Outside this
            application&rsquo;s boundary entirely, and readable by Google.
          </li>
        </ul>

        <h2>Permissions Warnings and Integrations</h2>
        <p>
          When using third-party platforms, we request the most restrictive permissions
          available that still allow porcupineResearch to perform its advertised
          functions.
        </p>

        <h3>Google Workspace Integration</h3>
        <p>
          <strong>Restrictive Permissions:</strong> To provide seamless collaboration and
          identity verification, porcupineResearch integrates with Google Workspace and
          Google Authentication. When you connect your Google account, you grant
          porcupineResearch the following scopes:{" "}
          <strong>
            <code>https://www.googleapis.com/auth/drive.file</code>
          </strong>
          ,{" "}
          <strong>
            <code>email</code>
          </strong>
          , and{" "}
          <strong>
            <code>profile</code>
          </strong>
          . The <code>drive.file</code> scope is a highly restrictive permission that only
          allows porcupineResearch to see, edit, create, and delete Google Docs and Sheets
          that the app <em>specifically created</em> or that you explicitly selected via
          the Google Picker. The <code>email</code> and <code>profile</code> scopes are
          used exclusively to securely identify you and create your account.
        </p>
        <p>
          <strong>Limited Use Policy:</strong> porcupineResearch <strong>cannot</strong>{" "}
          read your previous browsing history, nor can it access other files in your
          Google Drive. We push formatted claims, citations, and generated bibliographies
          into your documents to streamline your writing process. porcupineResearch’s use
          and transfer of information received from Google APIs to any other app will
          adhere to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>

        <h2>Third-Party Services Used</h2>
        <p>
          <strong>Vercel and Supabase, on the hosted service.</strong> The application
          runs on Vercel; the PostgreSQL database, and the authentication that issues your
          sign-in code, are managed by Supabase. Those two are the sub-processors, named
          here rather than in a list you have to request. Running your own copy, neither
          is involved — the data sits in the database you started. Everything else your
          instance talks to is on the <Link href="/dpa">data processing page</Link>, and
          it is a short list.
        </p>
        <p>
          <strong>Bibliographic search:</strong> using the search screen sends your query
          to OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar. They may log your
          instance&rsquo;s IP address and the query under their own policies. No project
          data, member identity or screening decision is sent. If even the query is
          sensitive, use import instead and no request is made.
        </p>

        <h2>Support Interactions</h2>
        <p>
          <strong>Only what you send us:</strong> if you email about a bug, we have your
          email address and whatever you chose to put in the message. Nothing is reported
          automatically — the app has no crash reporter and no analytics, so an error you
          do not tell us about is one nobody hears.
        </p>

        <h2>Deleting Your Data</h2>
        <p>
          <strong>Right to erasure:</strong> the app has project deletion and account
          deletion, and because the database is yours, SQL covers anything the app does
          not. Nothing expires, nothing is archived on your behalf, and nothing is kept
          after you delete it. On the hosted service backups are the operator&rsquo;s to
          schedule and purge; on your own copy they are yours. Removing a member, or a
          member deleting their account, flags the project key for rotation — and the
          rotation itself happens in a browser, when one of that project&rsquo;s admins
          next unlocks it. Until then, somebody who kept a copy of the key could still
          read new messages. The server cannot rotate a key it does not hold.
        </p>

        <h2>Changes</h2>
        <p>
          <strong>Policy updates:</strong> this page changes when the software does, and
          the change lands before the feature rather than after. The{" "}
          <Link href="/changelog">changelog</Link> records what shipped and when.
        </p>

        <h2>Questions</h2>
        <p>
          <strong>Contact Us:</strong> If you have any questions or concerns regarding
          porcupineResearch’s privacy policies, please email{" "}
          <a href="mailto:dhrubojyoti.saha@g.bracu.ac.bd">
            dhrubojyoti.saha@g.bracu.ac.bd
          </a>
          .
        </p>
      </div>
    </main>
  );
}
