"use client";

import { useState, useTransition } from "react";

import { Button, Input } from "@/components/ui";

import { setExtractionTarget } from "./actions";

/**
 * The per-member extraction target, edited where it is read.
 *
 * Not on the project settings page. The number only means anything next to
 * the counts it is measuring — someone looking at "18 · 24 · 9 · 25" is the
 * person who knows whether 25 each is still the right split, and making them
 * navigate to another screen to change it is how a stale target survives a
 * plan that changed.
 *
 * Owner and admin only; the server action checks that again rather than
 * trusting this component not to be rendered.
 */
export function TargetForm({
  projectId,
  target,
}: {
  projectId: string;
  target: number | null;
}) {
  const [value, setValue] = useState(target === null ? "" : String(target));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const response = await setExtractionTarget({ projectId, target: value });
      if (!response.ok) setError(response.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="extraction-target" className="text-muted text-fine block">
          Papers per member
        </label>
        <Input
          id="extraction-target"
          compact
          inputMode="numeric"
          // Not `type="number"`: the spinner is useless at this size and a
          // scroll wheel over a focused number field changes the value, which
          // is a genuinely bad way to lose a project setting.
          className="mt-1 w-20 text-center font-mono"
          placeholder="—"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>

      <Button type="submit" busy={pending} busyLabel="Saving…">
        Set target
      </Button>

      {error ? (
        <p role="alert" className="text-danger text-fine w-full">
          {error}
        </p>
      ) : (
        <p className="text-muted text-fine w-full">
          Leave it empty for no target — the dashboard then shows counts alone.
        </p>
      )}
    </form>
  );
}
