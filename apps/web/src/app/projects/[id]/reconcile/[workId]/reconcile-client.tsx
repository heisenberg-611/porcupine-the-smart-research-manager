"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Banner, Button, Card, Radio, Textarea } from "@/components/ui";

import { recordReconciliation } from "../actions";

export interface ComparisonRow {
  fieldId: string;
  fieldKey: string;
  label: string;
  type: string;
  valueA: unknown;
  textA: string | null;
  anchorA: string | null;
  valueB: unknown;
  textB: string | null;
  anchorB: string | null;
  agree: boolean;
  answeredByEither: boolean;
}

type Choice = "a" | "b" | "custom" | "skip";

export function ReconcileClient({
  projectId,
  projectWorkId,
  protocolId,
  extractionA,
  extractionB,
  nameA,
  nameB,
  rows,
  isParty,
  alreadyReconciled,
}: {
  projectId: string;
  projectWorkId: string;
  protocolId: string;
  extractionA: string;
  extractionB: string;
  nameA: string;
  nameB: string;
  rows: ComparisonRow[];
  isParty: boolean;
  alreadyReconciled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /*
   * Nothing is preselected on a disagreement.
   *
   * A default would be answered for the reviewer by whichever column happened
   * to be first, and a reconciliation screen where "next, next, next" produces
   * a complete record is not adjudication — it is a rubber stamp with an audit
   * trail. Fields the two AGREE on are preselected, because there is no
   * judgement to make there.
   */
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      rows.map((row) => [row.fieldId, row.agree ? "a" : ("skip" as Choice)]),
    ),
  );
  const [custom, setCustom] = useState<Record<string, string>>({});

  const conflicts = rows.filter((r) => r.answeredByEither && !r.agree);
  const undecided = conflicts.filter((r) => choices[r.fieldId] === "skip");

  function submit() {
    setError(null);
    startTransition(async () => {
      const resolutions = rows.map((row) => {
        const choice = choices[row.fieldId] ?? "skip";
        if (choice === "a") {
          return {
            fieldId: row.fieldId,
            choice,
            value: row.valueA,
            valueText: row.textA,
            anchorId: row.anchorA,
          };
        }
        if (choice === "b") {
          return {
            fieldId: row.fieldId,
            choice,
            value: row.valueB,
            valueText: row.textB,
            anchorId: row.anchorB,
          };
        }
        if (choice === "custom") {
          const text = custom[row.fieldId] ?? "";
          return {
            fieldId: row.fieldId,
            choice,
            value: text,
            valueText: text,
            // A third answer belongs to neither reading, so it inherits
            // neither passage. Provenance has to be earned, not borrowed.
            anchorId: null,
          };
        }
        return { fieldId: row.fieldId, choice: "skip" as const, value: null };
      });

      const result = await recordReconciliation({
        projectId,
        projectWorkId,
        protocolId,
        extractionA,
        extractionB,
        resolutions,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/projects/${projectId}/reconcile`);
      router.refresh();
    });
  }

  if (alreadyReconciled) {
    return (
      <Banner>
        This paper has already been reconciled. The resolved answers are in the evidence
        table.
      </Banner>
    );
  }

  if (isParty) {
    return (
      <Banner tone="danger">
        <strong>You extracted this paper yourself.</strong> A disagreement has to be
        resolved by someone who was not part of it — otherwise the record would say a
        third reader adjudicated when one of the two did. Ask a colleague who has not read
        it.
      </Banner>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="prose-body">
        {conflicts.length === 0
          ? "The two readings agree on every field. Recording the reconciliation keeps the agreed answers as the verified record."
          : `${conflicts.length} ${conflicts.length === 1 ? "field needs" : "fields need"} a decision. Fields the two agree on are already selected.`}
      </p>

      {error && <Banner tone="danger">{error}</Banner>}

      <ol className="flex list-none flex-col gap-4">
        {rows.map((row) => {
          const choice = choices[row.fieldId] ?? "skip";
          const settled = row.agree;

          return (
            <li key={row.fieldId}>
              <Card className={settled ? "" : "border-danger/40"}>
                <fieldset>
                  <legend className="text-heading text-ink mb-1 flex flex-wrap items-baseline gap-2">
                    {row.label}
                    <span className="text-muted text-fine font-mono">{row.fieldKey}</span>
                    {settled ? (
                      <span className="text-muted text-fine">· agreed</span>
                    ) : row.answeredByEither ? (
                      <span className="text-danger text-fine">· disagreement</span>
                    ) : (
                      <span className="text-muted text-fine">· neither answered</span>
                    )}
                  </legend>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Option
                      name={`f-${row.fieldId}`}
                      checked={choice === "a"}
                      onChange={() => setChoices((c) => ({ ...c, [row.fieldId]: "a" }))}
                      who={nameA}
                      text={row.textA}
                      hasAnchor={!!row.anchorA}
                    />
                    <Option
                      name={`f-${row.fieldId}`}
                      checked={choice === "b"}
                      onChange={() => setChoices((c) => ({ ...c, [row.fieldId]: "b" }))}
                      who={nameB}
                      text={row.textB}
                      hasAnchor={!!row.anchorB}
                    />
                  </div>

                  {!settled && (
                    <div className="mt-3 flex flex-col gap-2">
                      <label className="text-ui text-ink-soft flex items-center gap-2">
                        <Radio
                          name={`f-${row.fieldId}`}
                          checked={choice === "custom"}
                          onChange={() =>
                            setChoices((c) => ({ ...c, [row.fieldId]: "custom" }))
                          }
                        />
                        Neither — record a different answer
                      </label>
                      {choice === "custom" && (
                        <Textarea
                          aria-label={`A different answer for ${row.label}`}
                          rows={2}
                          value={custom[row.fieldId] ?? ""}
                          onChange={(e) =>
                            setCustom((v) => ({ ...v, [row.fieldId]: e.target.value }))
                          }
                        />
                      )}

                      <label className="text-ui text-muted flex items-center gap-2">
                        <Radio
                          name={`f-${row.fieldId}`}
                          checked={choice === "skip"}
                          onChange={() =>
                            setChoices((c) => ({ ...c, [row.fieldId]: "skip" }))
                          }
                        />
                        Leave unanswered — neither reading was supportable
                      </label>
                    </div>
                  )}
                </fieldset>
              </Card>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" onClick={submit} disabled={pending}>
          {pending ? "Recording…" : "Record the reconciliation"}
        </Button>
        {undecided.length > 0 && (
          <p className="text-muted text-ui">
            {undecided.length} of the {conflicts.length} disagreements will be left
            unanswered.
          </p>
        )}
      </div>
    </div>
  );
}

function Option({
  name,
  checked,
  onChange,
  who,
  text,
  hasAnchor,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  who: string;
  text: string | null;
  hasAnchor: boolean;
}) {
  return (
    <label
      className={`border-border flex cursor-pointer gap-3 rounded-lg border p-3 ${
        checked ? "border-accent bg-accent-soft" : ""
      }`}
    >
      <Radio name={name} checked={checked} onChange={onChange} className="mt-1" />
      <span className="flex flex-col gap-1">
        <span className="text-fine text-muted">{who}</span>
        {text ? (
          <span className="text-ui text-ink">{text}</span>
        ) : (
          <span className="text-ui text-muted italic">did not answer</span>
        )}
        {hasAnchor && <span className="text-fine text-muted">quoted from the paper</span>}
      </span>
    </label>
  );
}
