"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";

/**
 * The overlay layer, on Radix — and the first thing in this codebase that
 * needed one.
 *
 * Week 2 deferred this deliberately. The only confirmation in the app is a
 * two-step pair of inline buttons, with a written argument that a modal needs
 * a focus trap and escape handling to be correct and that inline is harder to
 * trigger by accident than a dialog whose default button is OK. That argument
 * still stands and that button pair is untouched.
 *
 * What changed is the evidence table's column chooser: a panel that must sit
 * above a horizontally scrolling region without being clipped by it, dismiss
 * on Escape and on an outside click, and return focus to its trigger. That is
 * exactly the case where hand-rolled goes wrong.
 *
 * A Dialog wrapper was written here too, for a row-detail panel that was
 * reverted — see the BUILD-LOG. It is not kept: an unused primitive with a
 * long comment is the kind of thing that rots quietly. It comes back with the
 * panel.
 *
 * Radix rather than shadcn/ui: the value here is focus management, dismissal
 * and ARIA wiring. shadcn would also bring its own token names, its own `cn`,
 * and a second visual vocabulary alongside a palette that was designed on
 * purpose and already passes AA.
 *
 * Wrapped so pages import Porcupine primitives and never Radix directly — one
 * place to restyle, and one place to look when the next overlay is needed.
 */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const PANEL =
  "border-rule bg-raised text-ink rounded-[--radius-card] border shadow-lg " +
  "focus-visible:outline-none";

/**
 * A non-modal panel anchored to its trigger.
 *
 * Portalled, which is the whole reason it exists here: the column chooser sits
 * above a region with `overflow-x: auto`, and anything rendered inside that
 * region gets clipped by it. A portal escapes the clip; `collisionPadding`
 * keeps it on screen near the edge.
 */
export function Popover({
  trigger,
  title,
  children,
  align = "start",
}: {
  trigger: ReactNode;
  title: string;
  children: ReactNode;
  align?: "start" | "center" | "end";
}) {
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          aria-label={title}
          className={cx(
            PANEL,
            "z-50 max-h-[min(28rem,60dvh)] w-[min(20rem,calc(100vw-2rem))]",
            "overflow-y-auto p-4",
          )}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
