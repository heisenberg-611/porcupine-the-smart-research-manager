import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Guides",
  description:
    "Getting porcupineResearch running, choosing a project kind, and the things it does on purpose that look like bugs — including where the sign-in code actually goes.",
};

/**
 * The practical page: how to run it, and the six things people get stuck on.
 *
 * Every one of the "looks like a bug" entries below was a real question, and
 * most of them are the app being deliberate. A tool that refuses something on
 * purpose and does not say why is indistinguishable from a broken one, and the
 * refusal is where trust is either earned or lost.
 *
 * The sign-in entry is first because it catches everybody: the code goes to a
 * local mail catcher, not to a real inbox, and someone waiting on their own
 * email will wait forever.
 */
export default function GuidesPage() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
      <PageHeader
        title="Guides"
        description="How to get it running, the one concept that explains the rest of the app, and the deliberate refusals that read like faults."
      />

      <div className="longform">
        <h2>Running it</h2>
        <p>
          There is no hosted version, so the first guide is an install. You need{" "}
          <strong>Docker Desktop running</strong> and Node 24; everything else is in the
          repository.
        </p>
        <ol>
          <li>
            <code>pnpm install</code> — the workspace, once.
          </li>
          <li>
            <code>pnpm db:start</code> — the database in containers. The first run pulls
            images and takes a few minutes. Every confusing failure below this line traces
            back to Docker not being up.
          </li>
          <li>
            <code>pnpm db:reset</code> — apply the schema. This also wipes data, so it is
            how you start over later.
          </li>
          <li>
            <code>pnpm dev</code> — the app, on <code>localhost:3000</code>.
          </li>
        </ol>
        <p>
          An empty app is hard to judge. <code>pnpm db:seed</code> fills it with a
          300-paper systematic review and a small thesis — a 20-question protocol, a
          half-screened library, papers waiting in reconciliation and around five and a
          half thousand answers. That is the shape these screens are designed for, and
          nothing like what four rows of test data looks like.
        </p>

        <h2>Signing in — the thing that catches everyone</h2>
        <p>
          There is <strong>no password</strong>. You type an email address and the app
          sends a six-digit code. Running locally, that email never leaves your machine:
          it goes to Mailpit at <code>localhost:54324</code>. If you have been watching
          your real inbox, that is why nothing arrived.
        </p>
        <p>
          Any address works locally and nothing is verified, so <code>me@test.dev</code>{" "}
          is fine.
        </p>

        <h2>Choose the project kind carefully</h2>
        <p>
          This is the one concept that explains the rest of the app. When you create a
          project you pick a <strong>kind</strong>, and the kind changes which features
          exist — not cosmetically, but whole screens appearing or refusing to work. A
          student reading forty books should not be made to run a clinical review process,
          and a review team wants every guardrail.
        </p>
        <ul>
          <li>
            <strong>Systematic review</strong> — a protocol is required before extracting,
            an exclusion needs a reason from a controlled list, PRISMA is complete, and
            dual extraction with Cohen&rsquo;s κ is available.
          </li>
          <li>
            <strong>Thesis, lab paper, general</strong> — the protocol is optional,
            exclusions need no reason, PRISMA is shown with a note that the reasons were
            optional, and reconciliation is hidden rather than offered and then refused.
          </li>
        </ul>
        <p>
          <strong>The kind cannot be changed afterwards.</strong> If a screen tells you a
          feature is for systematic reviews, your project is a thesis; make a new one. To
          see everything the app can do, create a systematic review.
        </p>

        <h2>The workflow, in order</h2>
        <ol>
          <li>
            <strong>Questions</strong> — what the review asks. Everything after is ranked
            against these.
          </li>
          <li>
            <strong>Find papers or Import</strong> — five databases at once, or paste
            BibTeX and RIS. Both land papers in the library.
          </li>
          <li>
            <strong>Screen</strong> — include or exclude, one paper at a time, from the
            keyboard.
          </li>
          <li>
            <strong>Protocol</strong> — the questions you will ask of every included
            paper. Agree it before extracting, not during.
          </li>
          <li>
            <strong>Read and Extract</strong> — the paper on one side, the questions on
            the other.
          </li>
          <li>
            <strong>Evidence, PRISMA, Reconcile</strong> — the outputs, built from what
            you already recorded.
          </li>
        </ol>
        <p>
          There is no wizard and you do not need one: the project overview names one next
          action based on what the project actually needs. An empty library asks you to
          find papers; unscreened papers ask you to screen.
        </p>

        <h2>Things it does on purpose that look like bugs</h2>
        <ul>
          <li>
            <strong>&ldquo;κ is undefined&rdquo; instead of a number.</strong> If both
            extractors gave the same answer to every paper for a question, Cohen&rsquo;s κ
            genuinely cannot be computed — chance alone predicts complete agreement.
            Printing 1.00 there would be a confident number the data does not support, so
            it shows the reason and the raw agreement percentage instead.
          </li>
          <li>
            <strong>90% agreement but a poor κ.</strong> Not a contradiction. It means one
            answer dominates that question, so someone answering the same thing every time
            without reading would score nearly as well. Both numbers are shown for that
            reason.
          </li>
          <li>
            <strong>
              &ldquo;You already have your own extraction of this paper.&rdquo;
            </strong>{" "}
            You cannot reconcile a paper you extracted yourself — that would make you a
            third reader rather than a neutral one.
          </li>
          <li>
            <strong>A question you cannot rename or delete.</strong> It has answers.
            Renaming its key would silently change what a column in an old export meant.
            Make a new protocol version instead.
          </li>
          <li>
            <strong>An exclusion that will not save.</strong> Systematic reviews require a
            reason, and the rule lives in the database rather than the form.
          </li>
          <li>
            <strong>No column picker on a phone.</strong> Choosing among twenty columns is
            a desktop-shaped problem, and on a narrow layout that control made a link
            elsewhere in the table unclickable. The <code>?cols=</code> link still works
            on any screen; only the button is desktop-only.
          </li>
          <li>
            <strong>An error where you expected an empty list.</strong> Deliberate. A
            broken query and a genuinely empty table used to look identical, so failures
            are loud now and the message names what failed to load.
          </li>
        </ul>

        <h2>When something goes wrong</h2>
        <ul>
          <li>
            <strong>Everything fails, nothing loads.</strong> Docker is not running. Start
            Docker Desktop, then <code>pnpm db:start</code>.
          </li>
          <li>
            <strong>Search returns nothing.</strong> The providers are real external APIs
            and need internet. The page names any that failed.
          </li>
          <li>
            <strong>One provider failed and the rest worked.</strong> Normal, and the
            design point — four sets of results beat an error page. Semantic Scholar is
            the usual one; it rate-limits unauthenticated callers hard. Search again in a
            minute.
          </li>
          <li>
            <strong>Every provider failed.</strong> Five independent APIs do not fail
            together, so that one is ours. Please report it.
          </li>
        </ul>
      </div>

      <p className="text-muted text-ui border-rule border-t pt-8 text-pretty">
        For what each screen is for rather than how to run it, read{" "}
        <Link href="/about">how it works</Link>. For what the server can and cannot read,{" "}
        <Link href="/security">security</Link>.
      </p>
    </main>
  );
}
