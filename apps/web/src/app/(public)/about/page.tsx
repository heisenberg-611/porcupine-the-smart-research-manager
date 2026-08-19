import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "A walkthrough of a review in porcupineResearch, from choosing a project kind to exporting the evidence table — what you do at each stage, what the app refuses to let you do, and why.",
};

/**
 * The guide somebody actually follows, in the order they will hit it.
 *
 * This used to be a description: four definitions, a list of screens with a
 * paragraph each, and the limits. Accurate, and no use to the person it was
 * written for — a reader who has just made an account does not want to know
 * what the Reconcile screen IS, they want to know whether they need it yet and
 * what happens if they skip it. A list of nouns cannot answer that.
 *
 * So it is a walkthrough now, numbered, in the order the work happens. Each
 * stage says what you do, what the app will not let you do, and what it costs
 * to get it wrong — because almost every expensive mistake in a review is made
 * early and discovered late.
 *
 * The two sections that were worth keeping are still here. The glossary sits
 * at the bottom rather than the top: somebody who needs "what is a protocol"
 * can jump to it, and somebody who does not should not have to scroll past
 * four definitions to reach step one. "What this does not do" stays at the end
 * and stays blunt.
 *
 * NOT behind auth, and that is the point. A guide you can only read once you
 * have committed to the product is a guide for nobody.
 */
export default function AboutPage() {
  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-16 sm:py-20">
      <h1 className="text-ink text-display text-balance">How it works</h1>

      <p className="text-ink-soft measure text-body mt-5 text-pretty">
        A review is a pipeline, and this is it in order. You do not have to use every
        stage — a thesis skips reconciliation and can skip the protocol entirely — and the
        app hides what your project kind does not need rather than offering it and then
        refusing.
      </p>

      <p className="text-muted measure text-ui mt-4 text-pretty">
        Roughly fifteen minutes to read. If you are stuck on something specific rather
        than starting out, <Link href="/guides">the guides page</Link> covers installing
        your own copy and the handful of things the app refuses on purpose.
      </p>

      {/* A contents list, because this is now long enough to arrive in the
          middle of and short enough that a sidebar would be overkill. */}
      <nav aria-label="Stages" className="border-rule mt-10 border-t pt-6">
        <ol className="text-ui flex flex-col gap-2">
          {STAGES.map((stage, index) => (
            <li key={stage.id}>
              <Link
                href={`#${stage.id}`}
                className="text-muted hover:text-ink focus-visible:ring-accent rounded focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="font-mono">{String(index + 1).padStart(2, "0")}</span>{" "}
                {stage.title}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {STAGES.map((stage, index) => (
        <section
          key={stage.id}
          id={stage.id}
          className="border-rule mt-12 scroll-mt-24 border-t pt-8"
        >
          <p className="text-accent text-fine font-mono tracking-widest uppercase">
            Step {String(index + 1).padStart(2, "0")}
          </p>
          <h2 className="text-ink text-title mt-2">{stage.title}</h2>

          <p className="text-ink-soft measure text-body mt-4 text-pretty">
            {stage.summary}
          </p>

          <ul className="mt-5 flex flex-col gap-4">
            {stage.points.map((point) => (
              <li key={point.heading} className="measure">
                <p className="text-ink text-ui font-medium">{point.heading}</p>
                <p className="text-muted text-ui mt-1 text-pretty">{point.detail}</p>
              </li>
            ))}
          </ul>

          {stage.watch && (
            <p className="border-accent bg-accent-soft text-ink-soft measure text-ui mt-6 border-l-2 py-2 pl-4 text-pretty">
              <strong className="text-ink">Watch out.</strong> {stage.watch}
            </p>
          )}
        </section>
      ))}

      <section className="border-rule mt-12 border-t pt-8">
        <h2 className="text-ink text-title">Encryption, and what it costs you</h2>
        <p className="text-muted measure text-ui mt-4 text-pretty">
          Messages and LaTeX sources are sealed in your browser with a key the server
          never holds. The database stores bytes it cannot interpret, and a test suite
          asserts those columns cannot hold readable text.
        </p>
        <p className="text-muted measure text-ui mt-4 text-pretty">
          The cost is real and it is not hidden: a recovery passphrase is shown once when
          you enrol, and if you lose it nobody — including us — can open your messages
          again. You can register a browser so it unlocks without retyping the passphrase,
          and revoke that browser later.
        </p>
        <p className="text-muted measure text-ui mt-4 text-pretty">
          The papers themselves, their titles, your screening decisions and your extracted
          answers are <em>not</em> encrypted this way. They have to be searchable and
          countable, and pretending otherwise would be a claim we could not keep.{" "}
          <Link href="/security">The security page</Link> has the full table of what the
          server can and cannot read.
        </p>
      </section>

      <section className="border-rule mt-12 border-t pt-8">
        <h2 className="text-ink text-title">Where it runs</h2>
        <p className="text-muted measure text-ui mt-4 text-pretty">
          Two ways, same build. The hosted service is this site —{" "}
          <Link href="/sign-in">sign in</Link> and you have a project in a minute. Or run
          your own copy against a database you control, which is the answer when the
          corpus itself is sensitive or your institution requires research data to stay on
          its own infrastructure.
        </p>
        <p className="text-muted measure text-ui mt-4 text-pretty">
          The one thing that does not cross between them is a project. Everybody working
          on a review has to be on the same instance.
        </p>
      </section>

      <section className="border-rule mt-12 border-t pt-8">
        <h2 className="text-ink text-title">The words this uses</h2>
        <p className="text-muted measure text-ui mt-2 text-pretty">
          Here rather than at the top, so that somebody who already knows them can start
          at step one.
        </p>
        <dl className="mt-6 flex flex-col gap-5">
          {GLOSSARY.map(({ term, detail }) => (
            <div key={term}>
              <dt className="text-ink text-ui font-medium">{term}</dt>
              <dd className="text-muted measure text-ui mt-1 text-pretty">{detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-rule mt-12 border-t pt-8">
        <h2 className="text-ink text-title">What this does not do</h2>
        <p className="text-muted measure text-ui mt-2 text-pretty">
          Every one of these is a thing a reviewer might reasonably assume is here.
          Finding out after importing three hundred papers is the expensive way to learn
          it.
        </p>
        <ul className="mt-5 flex flex-col gap-3">
          {LIMITS.map((limit) => (
            <li key={limit} className="text-muted measure text-ui text-pretty">
              {limit}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

interface Stage {
  id: string;
  title: string;
  summary: string;
  points: Array<{ heading: string; detail: string }>;
  /** The mistake people actually make at this stage. */
  watch?: string;
}

const STAGES: readonly Stage[] = [
  {
    id: "kind",
    title: "Choose the project kind — you cannot change it later",
    summary:
      "The first screen asks what sort of project this is, and that answer changes which features exist. Not cosmetically: whole screens appear or refuse to work. A student reading forty books should not be made to run a clinical review process, and a review team wants every guardrail.",
    points: [
      {
        heading: "Systematic review",
        detail:
          "A protocol is required before you can extract. Excluding a paper requires a reason from a controlled list. PRISMA is complete, and dual extraction with Cohen's κ is available.",
      },
      {
        heading: "Thesis, lab paper, general",
        detail:
          "The protocol is optional, exclusions need no reason, PRISMA is shown with a note that the reasons were optional, and reconciliation is hidden rather than offered and then refused.",
      },
      {
        heading: "If a screen says a feature is for systematic reviews",
        detail:
          "Your project is a thesis. There is no setting to change; make a new project. To see everything the app can do, create a systematic review.",
      },
    ],
    watch:
      "This is the only decision in the product with no undo. If you are unsure, a systematic review gives you every guardrail and you can ignore the ones you do not need — the reverse is not true.",
  },
  {
    id: "questions",
    title: "Write the research questions",
    summary:
      "Everything downstream is ranked and reported against these, so they come first. A question here is what the review asks, plus the keywords a paper would use if it answered.",
    points: [
      {
        heading: "Search ranks results against them",
        detail:
          "Every result reports which of your questions it matched and why, so your search strategy is something you can defend rather than assert.",
      },
      {
        heading: "The evidence table checks them",
        detail:
          "It warns you when a question has no evidence behind it at all — a gap that is very hard to notice by reading down a column.",
      },
    ],
  },
  {
    id: "collect",
    title: "Get papers in",
    summary:
      "Two routes, and both land in the same library. Nothing enters your library until you add it, which is what makes the top number of the PRISMA diagram mean something.",
    points: [
      {
        heading: "Find papers",
        detail:
          "One query across OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar. Records for the same paper are merged by DOI before you see them, so you judge each paper once. If a source is down the others still return and the page names the one that failed.",
      },
      {
        heading: "Import",
        detail:
          "Paste BibTeX or RIS straight from Zotero, Mendeley or a journal page. Preview first, then add. Re-importing the same file adds nothing, so pasting it twice is safe.",
      },
    ],
    watch:
      "Semantic Scholar rate-limits unauthenticated callers hard and is the usual one to fail. That is the design working — four sets of results beat an error page — not a bug to report. Search again in a minute.",
  },
  {
    id: "screen",
    title: "Decide what is in",
    summary:
      "One paper at a time: include, exclude, or skip. Three hundred of these is the most repetitive thing this product asks of anyone, so it is built for the keyboard and not the mouse.",
    points: [
      {
        heading: "The shortcuts",
        detail:
          "i to include, e to exclude, s to skip, 1–9 to pick an exclusion reason, ? for the list. Decisions apply immediately rather than waiting for the server.",
      },
      {
        heading: "Skip records that you looked",
        detail:
          "It moves the paper to the end of the queue rather than pretending you never saw it.",
      },
      {
        heading: "Two people cannot overwrite each other",
        detail:
          "Each decision carries the status your screen was showing when you made it. If a colleague decided the same paper first, yours is refused and the paper comes back naming them. If several of you screen at once, each sees the queue in a different order so you collide less.",
      },
      {
        heading: "Assign papers, with a due date",
        detail:
          "Assigned papers appear in that person's queue. A date means the end of that day, so a paper due today is not overdue the moment it is assigned.",
      },
    ],
    watch:
      "In a systematic review an exclusion without a reason will not save, and the rule lives in the database rather than the form — so imports and bulk actions obey it too. That controlled list is what the PRISMA diagram is built from later.",
  },
  {
    id: "protocol",
    title: "Agree the protocol before you extract",
    summary:
      "The protocol is the set of questions you ask of every included paper. Agreeing it up front is what makes the answers comparable, and changing it afterwards is expensive in a way that is worth understanding before you start.",
    points: [
      {
        heading: "Start from a template",
        detail:
          "Seventeen are built in, grouped by what they are for: PICO and SPIDER for what you are extracting, RoB 2 and ROBINS-I and QUADAS-2 for how good the study is, TIDieR and STROBE and CHEERS for how completely it was reported. Each names the paper that defined it.",
      },
      {
        heading: "Quote fields force provenance",
        detail:
          "A quote-typed question cannot be typed into. It can only be filled by selecting the passage in the paper, and the database refuses an answer that is not linked to one. This is the single constraint that makes the finished table defensible.",
      },
      {
        heading: "Two rules will stop you later, by design",
        detail:
          "Once a question has answers its key cannot be renamed, and it cannot be deleted. Both exist so two exports of the same review never disagree about what a column means. Make a new protocol version instead.",
      },
    ],
    watch:
      "A forty-question protocol looks thorough and gets abandoned at paper three. The templates are deliberately short; add the discipline-specific questions you actually need rather than everything you can imagine wanting.",
  },
  {
    id: "read",
    title: "Read and annotate",
    summary:
      "Click a paper's title in the library to open it. Select a passage to highlight it and attach a note, private to you or shared with the project.",
    points: [
      {
        heading: "Quotes stay anchored",
        detail:
          "A highlight is tied to the passage rather than to a character offset, so it survives the text around it moving. A quote whose passage no longer exists says so rather than pointing somewhere plausible.",
      },
      {
        heading: "Today this is the abstract",
        detail:
          "There is no file upload anywhere in the app yet, so the reader works on the abstract text. Highlights work; they just have less to work on than you might expect.",
      },
    ],
  },
  {
    id: "extract",
    title: "Extract against the protocol",
    summary:
      "The paper on one side, your protocol questions on the other, so you are not scrolling between them once per question. A header counts how far through you are and says plainly when there are changes you have not saved.",
    points: [
      {
        heading: "It does not autosave, on purpose",
        detail:
          "A half-typed number should never become a recorded answer. Save drafts as you go; the header tells you when there is something unsaved.",
      },
      {
        heading: "Submitting freezes it",
        detail:
          "A submitted extraction cannot be edited until you reopen it as a draft. If a required question is still empty, submitting names every one of them at once, each a link straight to the question.",
      },
    ],
  },
  {
    id: "reconcile",
    title: "Reconcile, if two people extracted the same paper",
    summary:
      "Systematic reviews only. When two people have independently extracted one paper, this shows where they disagree, side by side, and reports how much they agreed overall.",
    points: [
      {
        heading: "A third person resolves it",
        detail:
          "They pick one of the two answers, record a different one, or leave it unanswered — and they must not be either of the original extractors, which the database enforces rather than the interface.",
      },
      {
        heading: "Cohen's κ, honestly",
        detail:
          "Reported per question. Where κ genuinely cannot be computed — because both extractors gave the same answer every time, so chance alone predicts complete agreement — it says so and shows the raw agreement percentage instead of printing a confident number the data does not support.",
      },
      {
        heading: "90% agreement with a poor κ is not a contradiction",
        detail:
          "It means one answer dominates that question, so somebody answering the same thing every time without reading would score nearly as well. Both numbers are shown for exactly that reason.",
      },
    ],
    watch:
      "Nothing tells two people to extract the same paper. It happens when two people both choose it, and reconciliation notices afterwards. If you want dual extraction, assign it deliberately.",
  },
  {
    id: "report",
    title: "Get the results out",
    summary:
      "Everything here is built from decisions you already recorded. Nothing is retyped, which is the step where a methods section usually starts disagreeing with its own data.",
    points: [
      {
        heading: "The evidence table",
        detail:
          "Papers as rows, protocol questions as columns. Sort — numbers as numbers — filter, group, and choose which columns are shown. That choice lives in the URL, so a narrowed table is a link you can send a supervisor. A cell in italic dash is unanswered; a dotted-underlined cell was quoted, and clicking it opens the paper at that passage.",
      },
      {
        heading: "Export",
        detail:
          "CSV and Excel, containing exactly what your filters and columns show. Column headers are the question keys rather than the labels, so a script that reads the file keeps working when somebody rewords a label.",
      },
      {
        heading: "The PRISMA 2020 diagram",
        detail:
          "Drawn from your recorded decisions, with the counts copyable as text straight into a methods section. The boxes this app cannot count — reports sought from a library, records removed by an automation tool, studies found by citation chasing — are typed in by an owner or admin and drawn in the same figure. A box nobody has filled in shows a dash rather than a zero, because a zero is a claim and a dash is a question.",
      },
    ],
  },
  {
    id: "team",
    title: "Working with other people",
    summary:
      "Five roles, and they differ in ways that matter rather than in name only. Every rule below is enforced in the database, not in the interface.",
    points: [
      {
        heading: "The roles",
        detail:
          "Owner does everything including deleting the project. Admin does everything except that. Contributor can screen, read, annotate and extract, but not edit the protocol. Reviewer can read and annotate but cannot record screening decisions — this is the supervisor role. Observer is read-only.",
      },
      {
        heading: "You can only invite somebody who already has an account",
        detail: "Sign them up first, or the invitation is refused.",
      },
      {
        heading: "A project always keeps an owner",
        detail:
          "The last owner cannot leave, be demoted, or delete their account, until somebody else is made an owner. The app names the projects blocking you rather than just refusing.",
      },
    ],
  },
];

const LIMITS: readonly string[] = [
  "It does not read PDFs for you. There is no file upload anywhere in the app, so the reader works on the abstract. Highlights work over that text only.",
  "It does not decide anything. No automatic screening, no relevance model choosing papers — the ranking suggests an order and every decision is a person's, recorded under their name. That is deliberate and not on the roadmap.",
  "It does not write your review. The evidence table and the diagram are outputs you take somewhere else.",
  "Messages do not arrive live everywhere yet, and two people editing the same note at the same time is a later phase — today the last write wins. Screening decisions are the exception, and are protected from overwriting each other.",
  "It is not a reference manager. It will take your BibTeX; it will not replace Zotero while you cite.",
  "A project cannot cross between instances. Everybody working on a review has to be on the same one.",
];

const GLOSSARY: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: "Systematic review",
    detail:
      "A literature review done to a written method, so that someone else following the same steps would find the same papers. The alternative — reading whatever turns up — is fine for a seminar and not publishable.",
  },
  {
    term: "Screening",
    detail:
      "Deciding, paper by paper, whether each one belongs in the review, and recording why the rejected ones were rejected.",
  },
  {
    term: "Protocol",
    detail:
      "The questions recorded for every paper. Agreeing it before you start is what makes the answers comparable.",
  },
  {
    term: "PRISMA",
    detail:
      "The flow diagram journals ask for: how many papers you found, how many you excluded, why, and how many survived. porcupineResearch draws it from your recorded decisions rather than asking you to count.",
  },
  {
    term: "Cohen's κ",
    detail:
      "How much two extractors agreed, corrected for how much they would have agreed by chance. Reported per question, and refused rather than faked where it cannot be computed.",
  },
];
