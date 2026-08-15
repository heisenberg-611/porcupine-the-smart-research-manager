"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Popover } from "@/components/overlay";
import { Button, Checkbox } from "@/components/ui";

/**
 * Which of the protocol's fields are columns right now.
 *
 * Twenty columns is not a rendering problem — the table renders them in
 * 400 ms. It is a "which five do I care about today" problem, and until now
 * the only answer was to scroll sideways past the other fifteen every time.
 *
 * The choice lives in the URL (`?cols=a,b,c`), so a table someone has set up
 * is a link they can send. That is the same reasoning as sort and filter, and
 * it is why this writes a URL rather than component state.
 *
 * Applying resets to page 1. A column choice does not change which rows match,
 * but it does change what "page 4" looks like, and leaving someone on a page
 * whose contents they cannot recognise is worse than sending them to the top.
 */
export function ColumnChooser({
  fields,
  selected,
  search,
}: {
  fields: Array<{ key: string; label: string }>;
  /** Currently visible field keys, in display order. */
  selected: string[];
  /**
   * The page's current query string, handed down from the server.
   *
   * NOT `useSearchParams()`, which was the first version and was wrong in a
   * way that took a while to find. Calling that hook in a client component
   * with no `<Suspense>` boundary above it opts the WHOLE page out of static
   * rendering and widens its client boundary — and the observable symptom was
   * nothing to do with search params: on a 390px viewport a cell link in the
   * table below became visible, enabled, stable and unclickable, with the
   * filter form reported as intercepting the pointer. An existing mobile test
   * caught it; four wrong hypotheses were tried before this one.
   *
   * The server already knows the query. Passing it down costs nothing and
   * keeps this component a leaf.
   */
  search: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<string[]>(selected);

  const allKeys = fields.map((f) => f.key);
  const showingAll = draft.length === fields.length;

  function apply(keys: string[]) {
    const next = new URLSearchParams(search);
    next.delete("page");

    // Every column selected is the default, so it is expressed by the ABSENCE
    // of the parameter rather than by listing all twenty. A default spelled
    // out in the URL is a link that breaks when the protocol gains a field.
    if (keys.length === fields.length) next.delete("cols");
    else next.set("cols", keys.join(","));

    router.push(`?${next.toString()}`, { scroll: false });
  }

  function toggle(key: string) {
    setDraft((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : // Re-derived from `fields` rather than appended, so a column that is
          // switched off and on again returns to its protocol position instead
          // of jumping to the end.
          allKeys.filter((k) => prev.includes(k) || k === key),
    );
  }

  return (
    <Popover
      title="Columns"
      trigger={
        <Button variant="ghost" className="border-border border">
          Columns{" "}
          <span className="text-muted tabular-nums">
            {draft.length}/{fields.length}
          </span>
        </Button>
      }
    >
      <fieldset>
        <legend className="text-ink text-ui mb-2 font-medium">Show these columns</legend>

        <div className="flex flex-col gap-1">
          {fields.map((field) => {
            const checked = draft.includes(field.key);
            return (
              <label
                key={field.key}
                className="hover:bg-surface text-ui flex min-h-11 cursor-pointer items-center gap-2 rounded px-2"
              >
                <Checkbox
                  checked={checked}
                  onChange={() => toggle(field.key)}
                  // The last remaining column cannot be removed: a table with
                  // no field columns is a list of titles, and the way back
                  // from it is not obvious.
                  disabled={checked && draft.length === 1}
                />
                <span className="text-ink">{field.label}</span>
              </label>
            );
          })}
        </div>

        <div className="border-rule mt-3 flex flex-wrap gap-2 border-t pt-3">
          <Button variant="primary" onClick={() => apply(draft)}>
            Apply
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(allKeys);
              apply(allKeys);
            }}
            disabled={showingAll}
          >
            Show all
          </Button>
        </div>
      </fieldset>
    </Popover>
  );
}
