"use client";

import { useState, useTransition } from "react";

import { Banner, Button, Field, Input } from "@/components/ui";

import { setAccessRoute } from "./access-actions";

/**
 * Where this project's members go when a paper will not open.
 *
 * Set once per project by an owner or admin, then shown beside every paper.
 * The alternative — each person hunting for their own library's proxy every
 * time — is the thing that makes people give up on a paper they needed.
 */
export function AccessForm({
  projectId,
  url,
  label,
}: {
  projectId: string;
  url: string | null;
  label: string | null;
}) {
  const [nextUrl, setNextUrl] = useState(url ?? "");
  const [nextLabel, setNextLabel] = useState(label ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const response = await setAccessRoute({
        projectId,
        url: nextUrl,
        label: nextLabel,
      });
      if (response.ok) setSaved(true);
      else setError(response.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <Banner tone="danger">{error}</Banner>}
      {saved && <Banner>Saved. Every paper in this project now offers it.</Banner>}

      <Field
        label="Where to send people"
        id="access-url"
        hint="Your library's link resolver, EZproxy prefix, or interlibrary-loan form. Put {doi} where the identifier goes, or end with = or / and it will be appended."
      >
        <Input
          id="access-url"
          type="url"
          inputMode="url"
          placeholder="https://library.example.edu/openurl?id={doi}"
          value={nextUrl}
          onChange={(e) => setNextUrl(e.target.value)}
        />
      </Field>

      <Field
        label="What to call it"
        id="access-label"
        hint="What a member will see. “Find it in the university library” beats “Access link”."
      >
        <Input
          id="access-label"
          value={nextLabel}
          onChange={(e) => setNextLabel(e.target.value)}
          placeholder="Find it in the university library"
        />
      </Field>

      <div>
        <Button type="submit" busy={pending} busyLabel="Saving…">
          Save
        </Button>
      </div>

      <p className="text-muted text-fine text-pretty">
        {/* Said plainly, because someone will ask. */}
        Leave it empty to remove it. Papers with a free open-access copy already show that
        copy first, whether or not this is set.
      </p>
    </form>
  );
}
