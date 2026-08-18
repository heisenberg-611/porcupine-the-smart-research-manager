import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "What has shipped in porcupineResearch, by phase — from the security boundary and the five-provider search through screening, extraction, the evidence table, reconciliation and end-to-end encrypted messaging.",
};

/**
 * By phase, not by version number.
 *
 * There are no releases to number: the hosted service deploys from the
 * repository, so "v1.4.2" would be a label nothing is pinned to. What a reader
 * of this page actually wants to know is which capabilities exist yet, and the
 * build phases are the honest unit for that — each one ends with an exit
 * criterion that had to be demonstrated before the next began.
 *
 * Dates are the dates in `docs/BUILD-LOG.md`. Where a phase found a real bug
 * during its exit trial, that is recorded here too. A changelog that lists only
 * features is a marketing document with timestamps.
 */
export default function ChangelogPage() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
      <PageHeader
        title="Changelog"
        description="Grouped by build phase rather than by release number. The hosted service tracks the repository, so what is described here is what is live."
      />

      <ol className="flex flex-col gap-10">
        {ENTRIES.map(({ phase, date, title, status, items }) => (
          <li key={phase} className="border-rule border-l-2 pl-6">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className="text-accent text-fine font-mono tracking-widest uppercase">
                {phase}
              </p>
              <p className="text-muted text-fine font-mono">{date}</p>
              {status && (
                <p className="border-border text-muted text-fine rounded-full border px-2 py-0.5">
                  {status}
                </p>
              )}
            </div>

            <h2 className="text-ink text-title mt-2 font-serif">{title}</h2>

            <ul className="text-ink-soft text-ui mt-4 flex flex-col gap-3">
              {items.map((item) => (
                <li key={item} className="measure text-pretty">
                  {item}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <p className="text-muted text-ui border-rule border-t pt-8 text-pretty">
        What is still missing is listed on the <Link href="/features">features page</Link>
        , and the reasoning behind the larger absences is on{" "}
        <Link href="/about">how it works</Link>.
      </p>
    </main>
  );
}

const ENTRIES: ReadonlyArray<{
  phase: string;
  date: string;
  title: string;
  status?: string;
  items: readonly string[];
}> = [
  {
    phase: "Phase 4",
    date: "2026-08",
    title: "Comprehension",
    status: "In progress",
    items: [
      "A dashboard, and an application shell with navigation — thirteen pages had shipped before there was any way to get from one to another.",
      "Assignment with due dates: a paper can be given to a member with a date, and it appears in their queue. A date means the end of that day, so a paper due today is not overdue the moment it is assigned.",
      "Public pages — features, pricing, security, the policies — moved behind one shared header, footer and light palette, and every claim on them checked against a screen that exists.",
      "A single focus indicator. Clicking a text field used to draw two green outlines, because the rule that drew the first sat outside every cascade layer and quietly beat the utility that was meant to replace it.",
    ],
  },
  {
    phase: "Phase 3",
    date: "2026-08-15",
    title: "Encryption and messaging",
    items: [
      "A recovery passphrase, shown once at enrolment, and a key hierarchy that lets a browser be registered and later revoked without it.",
      "Per-project keys sealed to each member, and end-to-end encrypted project messages and direct messages.",
      "Member removal rotates the project key to a new epoch, so someone removed cannot read what is said after they leave.",
      "The rotation was written, believed, and found to be triggered by nothing. It is now tested by dropping the trigger and watching the suite go red.",
    ],
  },
  {
    phase: "Phase 2c",
    date: "2026-08-15",
    title: "Usability",
    items: [
      "Keyboard screening: include, exclude, skip and numbered exclusion reasons, with decisions applied before the server answers.",
      "Per-member queue ordering, so four people screening at once collide far less often.",
      "Orientation on the two long screens — the evidence table and the extraction form — including column choice that lives in the URL and can be sent to a supervisor.",
      "A capability flag that claimed a feature existed when no screen implemented it, found and removed.",
    ],
  },
  {
    phase: "Phase 2b",
    date: "2026-08-14",
    title: "Dual extraction and reconciliation",
    items: [
      "Two people extract the same paper independently; reconciliation shows only the disagreements, side by side.",
      "Cohen's κ per question, with an explicit refusal to print a number where the statistic genuinely cannot be computed.",
      "A reconciler cannot be one of the two extractors. Enforced in the database.",
    ],
  },
  {
    phase: "Phase 2",
    date: "2026-08-14",
    title: "The extraction pipeline",
    items: [
      "Protocols with eight question types, four built-in templates, and versioning — a question with answers cannot be renamed or deleted.",
      "Quote-typed questions that can only be filled by selecting a passage, so a claim is linked to the sentence it came from.",
      "The evidence table: sort, filter, group, choose columns, and export to CSV or Excel with question keys as headers.",
      "The PRISMA diagram, drawn from recorded decisions rather than typed in.",
    ],
  },
  {
    phase: "Phase 1",
    date: "2026-08-14",
    title: "Discovery, corpus and reading",
    items: [
      "Search across OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar at once, with cross-source duplicates merged before ranking.",
      "BibTeX and RIS import, idempotent — pasting the same file twice adds nothing.",
      "Highlights and notes anchored to the text, so a quote survives the passage moving.",
      "An exit trial with four people and three hundred papers, which found a real bug: two screeners could overwrite each other's decisions. Fixed with a locked compare-and-swap.",
      "Five providers all reported as down, and none of them were — an unreachable address had been pinned and the socket hung. The failover is now tested.",
    ],
  },
  {
    phase: "Phase 0",
    date: "2026-08-13",
    title: "Foundations",
    items: [
      "The security boundary first: row-level security on every table, and a test suite that verifies each rule by disabling it and watching the assertion fail.",
      "Passwordless authentication by emailed code, and the identity key material that Phase 3 later built on.",
      "Accessibility in CI from the first week — WCAG 2.2 AA, checked on every public route rather than retrofitted later.",
    ],
  },
];
