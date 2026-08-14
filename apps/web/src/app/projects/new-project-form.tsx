"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Banner, Button, Field, Input, Select, Textarea } from "@/components/ui";

import { createProject } from "./actions";

/**
 * R-06 in the UI: `kind` is chosen up front because it branches every screen
 * that follows, not because it is a label. THESIS is first and default — it
 * is the larger population and the path we build for.
 */
const KIND_OPTIONS = [
  { value: "THESIS", label: "Thesis or dissertation" },
  { value: "SYSTEMATIC_REVIEW", label: "Systematic review" },
  { value: "LAB_PAPER", label: "Lab paper" },
  { value: "GENERAL", label: "Something else" },
] as const;

export function NewProjectForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);

    const result = await createProject({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      kind: formData.get("kind") as (typeof KIND_OPTIONS)[number]["value"],
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/projects/${result.data.id}`);
    router.refresh();
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

      <Field
        label="Kind"
        id="kind"
        hint="This changes how the project works, not just what it's called. You can add structure later."
      >
        <Select id="kind" name="kind" defaultValue="THESIS">
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Description" id="description" hint="Optional.">
        <Textarea id="description" name="description" maxLength={2000} rows={3} />
      </Field>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Creating…" : "Create project"}
      </Button>
    </form>
  );
}
