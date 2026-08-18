"use client";

import { capabilities, type ProjectKind } from "@Porcupine/shared";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { Banner, Button, Field, Input, Radio, Textarea } from "@/components/ui";

import { createProject } from "./actions";

/**
 * R-06 in the UI: `kind` is chosen up front because it branches every screen
 * that follows, not because it is a label. THESIS is first and default — it
 * is the larger population and the path we build for.
 *
 * A radio list rather than a dropdown, and not for taste. This is the single
 * most consequential decision in the product: it decides whether the project
 * gets a required protocol, required exclusion reasons, dual extraction and
 * κ — whole screens, not a label — and NOTHING can change it afterwards. A
 * dropdown hides three of the four options behind a click at exactly the
 * moment the difference matters, which is the same reason the protocol
 * template picker is radios.
 */
const KIND_OPTIONS: ReadonlyArray<{
  value: ProjectKind;
  label: string;
  who: string;
}> = [
  {
    value: "THESIS",
    label: "Thesis or dissertation",
    who: "One person reading widely, deciding what matters as they go.",
  },
  {
    value: "SYSTEMATIC_REVIEW",
    label: "Systematic review",
    who: "A team answering one question reproducibly, to a protocol.",
  },
  {
    value: "LAB_PAPER",
    label: "Lab paper",
    who: "A group writing up work, sharing a corpus.",
  },
  {
    value: "GENERAL",
    label: "Something else",
    who: "Reading you want kept together.",
  },
];

/**
 * What a kind actually gives you, read from `capabilities()` rather than
 * written out here.
 *
 * The alternative is a list of promises maintained separately from the code
 * that keeps them — and this app already had one of those. The new-project
 * form used to say "You can add structure later", which was never true: the
 * `structureUpgradePath` flag it referred to is declared in capabilities.ts
 * and read by nothing at all, no server action updates `kind`, and no screen
 * offers to. Meanwhile the project overview said the opposite. Deriving the
 * list means it cannot drift again.
 */
function consequences(kind: ProjectKind): string[] {
  const caps = capabilities(kind);
  return [
    caps.protocolRequired
      ? "A protocol is required before anything can be extracted"
      : "A protocol is optional — extract as much or as little as you like",
    caps.exclusionReasonRequired
      ? "Excluding a paper requires a reason, from a controlled list"
      : "Papers can be excluded without giving a reason",
    caps.dualExtraction
      ? "Two people extract each paper independently, and a third resolves disagreements"
      : "One extraction per paper; no reconciliation step",
    caps.interRaterAgreement
      ? "Inter-rater agreement (Cohen's κ) is reported"
      : "No inter-rater agreement reporting",
  ];
}

export function NewProjectForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [kind, setKind] = useState<ProjectKind>("THESIS");

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);

    const result = await createProject({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      kind: (formData.get("kind") as ProjectKind) ?? kind,
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    startTransition(() => {
      router.push(`/projects/${result.data.id}`);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      {error && <Banner tone="danger">{error}</Banner>}

      <Field label="Title" id="title">
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          placeholder="Transformer efficiency in low-resource NLP"
        />
      </Field>

      <fieldset>
        <legend className="text-ink text-ui font-medium">Kind</legend>
        <p className="text-muted text-fine mt-0.5">
          This changes how the project works, not just what it is called — and it cannot
          be changed afterwards.
        </p>

        <div className="mt-2 flex flex-col gap-1">
          {KIND_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="hover:bg-surface flex cursor-pointer items-start gap-3 rounded-lg p-2"
            >
              <Radio
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="mt-1"
              />
              <span>
                <span className="text-ink text-ui font-medium">{option.label}</span>
                <span className="text-muted text-fine block">{option.who}</span>
              </span>
            </label>
          ))}
        </div>

        {/* The consequences of the CURRENT choice, in place, before it is
            made. Reading them after creating the project is reading them too
            late. */}
        <ul className="border-rule text-muted text-fine mt-3 flex list-disc flex-col gap-1 border-t pt-3 pl-5">
          {consequences(kind).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </fieldset>

      <Field label="Description" id="description" hint="Optional.">
        <Textarea id="description" name="description" maxLength={2000} rows={3} />
      </Field>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Creating…" : "Create project"}
      </Button>
    </form>
  );
}
