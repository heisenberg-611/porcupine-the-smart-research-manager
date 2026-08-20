"use client";

import { useState, useTransition } from "react";

import { Banner, Button, Input } from "@/components/ui";

import { setPrismaCounts, type CountField } from "./actions";
import type { PrismaManualCounts } from "./prisma-diagram";

/**
 * The numbers a person has to supply, because nothing here can count them.
 *
 * Grouped the way the diagram is, so that filling this in reads as walking
 * down the figure rather than as a form. Each field says where the number
 * comes from in real life — "your library's document supply", "the reference
 * lists you chased" — because the commonest reason these boxes end up blank is
 * that nobody knew who was supposed to know.
 *
 * Empty is not zero, and the hint says so once, at the top. Everything else in
 * this feature depends on people believing that, so it is stated where they
 * are about to act on it rather than in documentation.
 */
export function PrismaCountsForm({
  projectId,
  initial,
}: {
  projectId: string;
  initial: PrismaManualCounts;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const start: Record<string, string> = {};
    for (const group of GROUPS) {
      for (const field of group.fields) {
        const current = initial[field.name];
        start[field.name] = current === null ? "" : String(current);
      }
    }
    return start;
  });

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const response = await setPrismaCounts({ projectId, counts: values });
      if (response.ok) setSaved(true);
      else setError(response.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {error && <Banner tone="danger">{error}</Banner>}
      {saved && <Banner>Saved. The diagram above has been redrawn.</Banner>}

      <p className="text-muted measure text-ui text-pretty">
        Leave a box empty and the diagram shows a dash — an open question for whoever
        reads the figure. Type <strong>0</strong> and it shows zero, which asserts that
        you checked and there were none. They are different claims, so the form does not
        turn one into the other.
      </p>

      {GROUPS.map((group) => (
        <fieldset key={group.legend} className="flex flex-col gap-3">
          <legend className="text-ink text-ui font-medium">{group.legend}</legend>
          <p className="text-muted text-fine text-pretty">{group.hint}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            {group.fields.map((field) => (
              <label key={field.name} className="flex flex-col gap-1">
                <span className="text-ink text-fine">{field.label}</span>
                <Input
                  inputMode="numeric"
                  // Not `type="number"`: a scroll wheel over a focused number
                  // field silently changes it, and these end up in a published
                  // figure.
                  className="font-mono"
                  placeholder="—"
                  value={values[field.name] ?? ""}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                />
                {field.hint && (
                  <span className="text-muted text-fine text-pretty">{field.hint}</span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div>
        <Button type="submit" busy={pending} busyLabel="Saving…">
          Save counts
        </Button>
      </div>
    </form>
  );
}

interface CountFieldSpec {
  name: CountField;
  label: string;
  hint?: string;
}

const GROUPS: ReadonlyArray<{
  legend: string;
  hint: string;
  fields: CountFieldSpec[];
}> = [
  {
    legend: "Identification",
    hint: "Records identified from databases and imports are counted from your library. These are the ones that are not.",
    fields: [
      {
        name: "registersIdentified",
        label: "Records from registers",
        hint: "Trial registers searched by hand, not through the search screen.",
      },
      {
        name: "automationIneligible",
        label: "Marked ineligible by automation",
        hint: "A tool that filtered records before a person saw them.",
      },
      {
        name: "otherRemovedBefore",
        label: "Removed before screening, other reasons",
        hint: "Duplicates the importer merged are already counted.",
      },
    ],
  },
  {
    legend: "Retrieval",
    hint: "There is no file store in this app, so nothing here knows which full texts arrived. Your library's document supply does.",
    fields: [
      { name: "reportsSought", label: "Reports sought for retrieval" },
      {
        name: "reportsNotRetrieved",
        label: "Reports not retrieved",
        hint: "Never arrived, paywalled beyond reach, or no reply.",
      },
      {
        name: "reportsOfIncludedStudies",
        label: "Reports of included studies",
        hint: "One study published twice is two reports and one study. PRISMA asks for both numbers.",
      },
    ],
  },
  {
    legend: "Identified via other methods",
    hint: "The right-hand column of the diagram. Fill any of these in and it appears; leave them all empty and the figure stays single-column, which is the correct shape for a review that only searched databases.",
    fields: [
      { name: "otherWebsites", label: "From websites" },
      { name: "otherOrganisations", label: "From organisations" },
      {
        name: "otherCitationSearching",
        label: "From citation searching",
        hint: "Reference lists chased forwards or backwards.",
      },
      { name: "otherReportsSought", label: "Reports sought" },
      { name: "otherReportsNotRetrieved", label: "Reports not retrieved" },
      { name: "otherReportsAssessed", label: "Reports assessed for eligibility" },
      { name: "otherReportsExcluded", label: "Reports excluded" },
      { name: "otherStudiesIncluded", label: "Studies included from these" },
    ],
  },
];
