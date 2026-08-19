import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Build notes",
  description:
    "Notes from building porcupineResearch: the bug four people found in an afternoon, why there is no AI in it, and the rule that a database rule is not done until it has been seen to fail.",
};

/**
 * Not a blog, and it should not pretend to be one.
 *
 * The footer link used to say "Blog" and led to a page saying a blog was
 * coming soon, which is the least interesting thing a page can say. There is
 * no publishing schedule here and there is not going to be one.
 *
 * What there is, and what is worth reading, is `docs/BUILD-LOG.md` — a record
 * of what broke and what the fix turned out to actually be. These are the
 * entries from it that change how you would use the product, written out in
 * full rather than linked, because a link to a file in a repository is not
 * something a visitor can read.
 *
 * Each one is here for the same reason: it is a decision a user is entitled to
 * disagree with, and they can only do that if they know it was made.
 */
export default function BuildNotesPage() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
      <PageHeader
        title="Build notes"
        description="Not a blog and not a release feed. Four decisions taken while building this that a user is entitled to disagree with — which requires knowing they were taken."
      />

      <div className="flex flex-col gap-12">
        {NOTES.map(({ id, date, title, standfirst, body }) => (
          <article key={id} aria-labelledby={id} className="border-rule border-t pt-8">
            <p className="text-muted text-fine font-mono">{date}</p>
            <h2 id={id} className="text-ink text-title mt-2 font-serif">
              {title}
            </h2>
            <p className="text-ink measure text-body mt-3 text-pretty">{standfirst}</p>
            <div className="mt-4 flex flex-col gap-4">
              {body.map((paragraph) => (
                <p key={paragraph} className="text-ink-soft measure text-ui text-pretty">
                  {paragraph}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>

      <p className="text-muted text-ui border-rule border-t pt-8 text-pretty">
        The full log — every phase, every bug, including the ones that were embarrassing —
        is <code>docs/BUILD-LOG.md</code> in the repository. What is built and what is not
        is on the <Link href="/features">features page</Link>.
      </p>
    </main>
  );
}

const NOTES: ReadonlyArray<{
  id: string;
  date: string;
  title: string;
  standfirst: string;
  body: readonly string[];
}> = [
  {
    id: "no-ai",
    date: "Decided at the start, and not revisited",
    title: "There is no AI in this, and there is not going to be",
    standfirst:
      "Every other tool in this category now offers to screen your papers and fill in your extraction fields. This one refuses, and the refusal is the product.",
    body: [
      "A systematic review is not a summarisation task. It is an argument that a specific set of papers was found by a stated method, judged against stated criteria, by named people — and that someone following the same steps would arrive at the same set. The value is entirely in the traceability. A screening decision nobody can account for is worth less than no decision at all, because it looks like one.",
      'The practical version of the objection is simpler. A reviewer asks why paper 147 was excluded. The answer has to be a person, a reason from the agreed list, and a timestamp. "The model scored it below threshold" is not an answer that survives peer review, and neither is a person who says they checked the model\'s work on three hundred papers.',
      "So the ranking in search suggests an order and nothing more, extraction fields are typed by people, and quote-typed questions cannot be typed into at all — only filled by selecting the passage in the paper. The database rejects an answer that is not linked to one. That constraint is annoying about twice a week and it is the reason the evidence table means something.",
    ],
  },
  {
    id: "four-people",
    date: "Phase 1 exit trial",
    title: "Four people, three hundred papers, and one bug worth the whole trial",
    standfirst:
      "Screening was tested by four people going through a real corpus in an afternoon. Five decisions each. Seven papers came out screened instead of twenty.",
    body: [
      "Every screener's interface reported that they had decided five papers that session, and every one of them was telling the truth about what it had done. They were overwriting each other. Two people opening the same paper both read its status as unscreened, both wrote a decision, and the second write replaced the first with no trace anywhere a human would look — including a supervisor's exclusion being reversed by a colleague's include.",
      "No amount of single-user testing finds this. It needs concurrency and it needs the same queue, which is exactly what an exit trial with real people is for and exactly what a demo never reproduces.",
      "The fix is that every decision now carries the status the screen was showing when the person decided, and the write locks the row and compares before it swaps. A decision made about a paper that has since moved is refused and returned, naming who moved it. The first version of that check used a plain read instead of a lock and caught fourteen of fifteen collisions — a number that looks like success and is not, because the fifteenth is a silently wrong review.",
      "The other half of the fix is that no two people see the same queue order. Collisions are rarer now because the app stopped arranging them.",
    ],
  },
  {
    id: "seen-to-fail",
    date: "A rule the whole test suite follows",
    title: "A database rule is not done until it has been seen to fail",
    standfirst:
      "Several rules in this project were written, believed, and later found to be enforcing nothing at all.",
    body: [
      "A test that asserts a query returns no rows passes just as happily when the rule works, when the rule was never applied, and when the query was wrong. Three very different situations, one green tick. Row-level security is especially good at this: a policy with a typo in its condition denies everything, which looks exactly like a policy that is working.",
      "So every check that expects to find nothing is paired with a mutation: the same query with the rule switched off, which must fail. Drop the trigger, watch the suite go red, put it back. If it stays green without the rule, the test was measuring nothing.",
      "This caught a real one in the encryption work. Removing a member from a project was supposed to rotate the project key to a new epoch, so that someone removed cannot read what is said afterwards. The rotation was implemented, reviewed and covered by a passing test. It was triggered by nothing — no code path called it. The test passed because it called the rotation itself. What replaced it is honest rather than automatic: removal marks the project as needing rotation, and an admin performs it in a browser, because the key exists nowhere else. The window between those two moments is real, and every page that mentions removal now says so.",
    ],
  },
  {
    id: "two-borders",
    date: "Phase 4",
    title: "Two green borders, and why the fix was in the wrong place for a week",
    standfirst:
      "Clicking any text field drew two accent-coloured outlines. Every control in the app already carried the utility that was supposed to prevent the second one.",
    body: [
      "The focus rule lived at the top of the stylesheet, outside any cascade layer. Unlayered CSS beats layered CSS regardless of specificity, and Tailwind's utilities are layered — so `focus-visible:outline-none`, which the form primitives and the nav links and most of the buttons all carried, had never applied. Not overridden: never applied. It compiled, it shipped, it did nothing.",
      "This is a whole family of bug that only exists in a utility-first codebase, and it is genuinely hard to see, because the failure mode is that the correct-looking code has no effect. The same afternoon turned up a second one in the header: links marked `hidden sm:inline-flex` were visible on a phone, because Tailwind emits `.hidden` before `.inline-flex` and the base class list already contained `inline-flex`. Equal specificity, later rule wins, the link stays. The header wrapped to two rows, covered the top of the page, and six end-to-end tests failed somewhere else entirely.",
      "Both fixes are one line. Finding them was not, and the reason is worth writing down: when an override silently does nothing, the instinct is to add a stronger override. That works, and it buries the actual cause one layer deeper for whoever looks next.",
    ],
  },
];
