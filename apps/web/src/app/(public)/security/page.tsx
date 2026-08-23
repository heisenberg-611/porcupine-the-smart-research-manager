import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Security",
  description:
    "What the server can read and what it cannot: the four encryption tiers, the key hierarchy, row-level security, and the things this design deliberately does not protect against.",
};

/**
 * Written for a university privacy office, not for a landing page.
 *
 * The tier table below is the load-bearing part, and it is deliberately
 * unflattering: annotations and extracted answers are readable by whoever runs
 * the server. Saying so is what makes the rest of the claim believable. The
 * project's own design document (docs/02-security-and-e2ee.md §2) has the
 * paragraph beginning "porcupineResearch cannot read your messages" marked
 * "publish this verbatim", and the section headed "What the server can see" is
 * that paragraph.
 *
 * The rule that has been broken elsewhere on this site and must not be broken
 * here: never describe this product as "fully end-to-end encrypted". It is
 * end-to-end encrypted for two kinds of content and honest about the rest,
 * which is a stronger position than a claim that falls apart under one
 * question from a procurement officer.
 */
export default function SecurityPage() {
  return (
    <main id="main" className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-16">
      <PageHeader
        title="Security"
        description="The short version: your messages are unreadable to us, your paper library is not, and the difference is deliberate. Where you run it changes who “us” means, and that is named below rather than left vague."
      />

      <section
        aria-labelledby="plainly"
        className="border-accent/40 bg-accent-soft/50 rounded-2xl border p-8 shadow-xs"
      >
        <h2 id="plainly" className="text-ink text-title font-serif">
          What the server can see, stated plainly
        </h2>
        <p className="text-ink-soft measure text-body mt-4 text-pretty leading-relaxed">
          porcupineResearch cannot read your messages or your LaTeX manuscripts. It can
          read your paper library, your highlights, and your extracted data, which are
          encrypted at rest and access-controlled. Documents you write in Google Docs live
          in your Google Drive under Google&rsquo;s terms — we can read those, and so can
          Google. porcupineResearch always knows who is in which project and when they
          acted.
        </p>
      </section>

      <section aria-labelledby="tiers">
        <h2 id="tiers" className="text-ink text-title font-serif">
          Four tiers, not one promise
        </h2>
        <p className="text-muted measure text-ui mt-2 text-pretty">
          Encrypting everything sounds better and works worse: a server that cannot read a
          screening status cannot count one, and a review lives on counting. So the line
          is drawn once, explicitly, and each kind of content sits on a named side of it.
        </p>

        <div className="mt-6 flex flex-col gap-4">
          {TIERS.map(({ tier, contents, protection }) => (
            <div
              key={tier}
              className="border-border/70 bg-raised/70 rounded-2xl border p-6 shadow-xs"
            >
              <h3 className="text-ink text-ui font-semibold">{tier}</h3>
              <p className="text-ink-soft text-ui mt-2 text-pretty leading-relaxed">{contents}</p>
              <p className="text-muted text-fine mt-2 text-pretty">{protection}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="longform">
        <h2>Keys, and the passphrase you only see once</h2>
        <p>
          There is no password to sign in with — authentication is an emailed six-digit
          code — so there is nothing you know that a key could be derived from. Instead
          the app generates a <strong>recovery passphrase of 30 characters</strong> and
          shows it exactly once, when you enrol. Argon2id turns it into a key-encryption
          key, that unwraps a master key, and the master key unwraps your identity
          keypair. Project keys are sealed to each member&rsquo;s public key, per project
          and per epoch.
        </p>
        <p>Two consequences, said here rather than in a help article:</p>
        <ul>
          <li>
            <strong>Lose the passphrase and the encrypted content is gone.</strong> Nobody
            can recover it, including whoever runs the server. That is what end-to-end
            encryption means, and it is the cost of the sentence at the top of this page.
          </li>
          <li>
            <strong>Register a browser so you are not retyping it.</strong> A registered
            device holds its own wrap of the master key and can be revoked later without
            rotating anything else.
          </li>
        </ul>

        <h2>Access control is in the database</h2>
        <p>
          Every table carries PostgreSQL row-level security, and the application connects
          as a role those policies apply to. A permission bug in a page therefore shows
          someone an empty list; it does not show them another project&rsquo;s papers. The
          rules that matter — an exclusion needs a reason in a systematic review, a
          reconciler cannot be one of the two people who extracted the paper — are
          database constraints and triggers, so an import or a future API cannot route
          around them.
        </p>
        <p>
          The test suite asserts these by trying to break them. Every check that expects
          to find nothing is paired with the same query run with the policy off, so a rule
          that has quietly stopped being enforced fails the build rather than passing it.
        </p>

        <h2>What this does not protect you from</h2>
        <ul>
          <li>
            <strong>A project member.</strong> Someone you invited holds the project key
            legitimately. Cryptography cannot help with that; roles, the activity log and
            key rotation are what is on offer.
          </li>
          <li>
            <strong>Whoever runs the server, for the middle tier.</strong> Membership,
            screening decisions, annotations and extracted values are readable by an
            operator. On the hosted service that is Dhrubojyoti Saha, plus Vercel and
            Supabase as infrastructure; on a copy you run yourself it is your own database
            administrator and nobody else. If your corpus itself is sensitive — which
            paper set a lab is reading can leak a research direction before publication —
            that is the fact to take to your privacy office, and the reason the
            self-hosted option exists.
          </li>
          <li>
            <strong>Traffic analysis.</strong> Ciphertext sizes and timing leak. An
            operator can infer how much a project is talking and roughly how long a
            document is.
          </li>
          <li>
            <strong>A compromised browser.</strong> Plaintext exists in your tab. An
            extension with access to the page can read it, which is why the app loads no
            third-party scripts.
          </li>
        </ul>

        <h2>Reporting something</h2>
        <p>
          Email{" "}
          <a href="mailto:dhrubojyoti.saha@g.bracu.ac.bd">
            dhrubojyoti.saha@g.bracu.ac.bd
          </a>{" "}
          with enough detail to reproduce it. Please do not open a public issue for a
          vulnerability. There is no bounty; there is an acknowledgement in the{" "}
          <Link href="/changelog">changelog</Link> if you want one.
        </p>
      </div>
    </main>
  );
}

const TIERS: ReadonlyArray<{ tier: string; contents: string; protection: string }> = [
  {
    tier: "End-to-end encrypted",
    contents:
      "Project messages and direct messages, LaTeX sources and their update history, comments on them, and compiled PDFs.",
    protection:
      "XChaCha20-Poly1305 under a per-project key wrapped to each member. Sealed and opened in your browser; the server stores bytes it cannot interpret.",
  },
  {
    tier: "Server-confidential",
    contents:
      "Membership and roles, screening status and decisions, annotations and their anchors, extracted values, protocol questions, and the activity log.",
    protection:
      "Row-level security and encryption at rest. The server can read this, and it has to — sorting, filtering, counting and the PRISMA diagram are all server-side work on exactly this data.",
  },
  {
    tier: "Third-party",
    contents: "Anything you write in a connected Google Doc, and exported Sheets.",
    protection:
      "Google's encryption and access controls, under Google's terms. Outside this application's boundary entirely.",
  },
  {
    tier: "Public",
    contents:
      "Scholarly metadata — paper titles, DOIs, authors, venues — along with project names and member display names.",
    protection: "None needed. This is bibliographic data that is public by construction.",
  },
];
