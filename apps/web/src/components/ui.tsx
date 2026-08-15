import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Phase 0 primitives.
 *
 * Deliberately hand-written rather than pulled from a component library: at
 * this stage the app has one form and one list, and installing a design
 * system before there is a use case is how design systems become incoherent.
 * Radix arrives when we need a real dialog, menu, or combobox — the point of
 * it is keyboard and focus semantics, and nothing here has any yet.
 *
 * Every control here is labelled, focus-visible, and has a ≥44px touch
 * target. axe-core runs on a mobile viewport in CI, so regressions here fail
 * the build rather than shipping.
 */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4",
        "text-ui font-medium transition-colors",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2",
        "focus-visible:ring-offset-canvas focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "bg-accent text-accent-ink hover:brightness-110",
        // Ghost is a text button with a hover ground, not an outlined box.
        // Sixteen pages of outlined ghost buttons was most of why every screen
        // read as a form.
        variant === "ghost" && "text-ink hover:bg-surface",
        variant === "danger" && "text-danger hover:bg-danger-soft",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  id,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  id: string;
  children: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink text-ui font-medium">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-muted text-fine">
          {hint}
        </p>
      )}
      {children}
      {/* Announced on change so a screen reader hears the failure without
          the user having to hunt for it. */}
      {error && (
        <p id={errorId} role="alert" className="text-danger text-fine">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cx(
        "border-border bg-raised text-ink text-ui w-full rounded-lg border px-3",
        "min-h-11 transition-colors",
        "placeholder:text-muted/70",
        "focus:border-accent focus-visible:ring-accent focus-visible:ring-2",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cx(
        "border-border bg-raised text-ink text-ui w-full rounded-lg border px-3",
        "py-2 transition-colors",
        "placeholder:text-muted/70",
        "focus:border-accent focus-visible:ring-accent focus-visible:ring-2",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cx(
        "border-border bg-raised text-ink text-ui w-full rounded-lg border px-3",
        "min-h-11 transition-colors",
        "placeholder:text-muted/70",
        "focus:border-accent focus-visible:ring-accent focus-visible:ring-2",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A checkbox with a real touch target.
 *
 * Its own primitive rather than an exception in the lint rule: a checkbox is
 * a different control from a text field, with different sizing, and carving
 * it out of the rule with a `type="checkbox"` grep meant matching text on the
 * line above the attribute — which does not work and quietly let raw controls
 * back in.
 */
export function Checkbox({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={cx(
        "border-border text-accent accent-accent size-4 rounded",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A radio, for the same reason Checkbox exists.
 *
 * The CI rule forbids raw form controls outside this file and has no
 * exceptions — the previous carve-out for checkboxes never matched and
 * silently let raw controls back in.
 */
export function Radio({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="radio"
      className={cx(
        "border-border accent-accent size-4",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A hidden input, carrying state through a GET form.
 *
 * There is nothing to style here, which is exactly why it needs to be a
 * primitive rather than an exception: the CI rule forbidding raw form controls
 * has no carve-outs, because the last carve-out it had never matched and let
 * real controls through for weeks. A rule with one justified exception is a
 * rule with a hole in it.
 */
export function Hidden(props: Omit<ComponentProps<"input">, "type" | "className">) {
  return <input type="hidden" {...props} />;
}

/**
 * A horizontally scrollable wrapper for a wide table.
 *
 * `overflow-x-auto` alone is a keyboard trap in reverse: the region scrolls
 * with a mouse or a finger and cannot be reached at all with a keyboard, so a
 * keyboard user simply never sees the columns past the fold. WCAG 2.1.1, and
 * axe's `scrollable-region-focusable` — which caught this on the mobile
 * viewport across five tables at once, every one of them hand-rolling the same
 * div.
 *
 * `tabIndex={0}` makes it focusable and therefore scrollable with arrow keys;
 * the role and label mean a screen reader announces what has been entered
 * rather than an unnamed group.
 */
export function TableScroll({
  label,
  className,
  ...props
}: ComponentProps<"div"> & { label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cx(
        "border-border overflow-x-auto rounded-lg border",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx(
        "border-rule bg-raised rounded-[--radius-card] border p-5",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Empty states are a product surface, not a fallback (G-04). A research tool
 * with an empty library is useless on day one, and this is where most users
 * quit — so an empty state always names the next action.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-rule flex flex-col items-start gap-3 rounded-[--radius-card] border border-dashed px-6 py-10">
      <h2 className="text-ink text-heading">{title}</h2>
      <p className="text-muted measure text-ui text-pretty">{description}</p>
      {action}
    </div>
  );
}

/**
 * The heading every page repeats.
 *
 * This block — back link, title, optional description, optional actions — was
 * hand-written on ten pages before it became a component, and had already
 * drifted: different link colours, different spacing, some with a description
 * and some without. Ten copies of a pattern is not a pattern, it is ten
 * chances to be inconsistent.
 */
export function PageHeader({
  backHref,
  backLabel,
  title,
  description,
  actions,
}: {
  backHref?: string;
  backLabel?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    // A rule under the header rather than a card around it. Elevation from
    // lines and space is quieter than a box and does the same work.
    <header className="border-rule flex flex-wrap items-end justify-between gap-4 border-b pb-5">
      <div className="min-w-0">
        {backHref && backLabel && (
          <Link
            href={backHref}
            className="text-muted hover:text-ink text-fine focus-visible:ring-accent inline-flex items-center rounded focus-visible:ring-2 focus-visible:outline-none"
          >
            ← {backLabel}
          </Link>
        )}
        <h1 className="text-ink text-display mt-1">{title}</h1>
        {description && (
          <div className="text-muted measure text-ui mt-2 text-pretty">{description}</div>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/**
 * A link that looks and behaves like a Button.
 *
 * Navigation is an anchor, not a button with an onClick — middle-click, "open
 * in new tab", and the browser's own history all depend on it being a real
 * link. Sharing the visual treatment is not a reason to share the element.
 */
export function ButtonLink({
  href,
  variant = "ghost",
  className,
  children,
}: {
  href: string;
  variant?: "primary" | "ghost";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "focus-visible:ring-accent text-ui inline-flex min-h-11 items-center justify-center rounded-lg px-4 font-medium",
        "transition-colors focus-visible:ring-2 focus-visible:outline-none",
        variant === "primary" && "bg-accent text-accent-ink hover:opacity-90",
        variant === "ghost" && "border-border text-ink hover:bg-surface border",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/**
 * A placeholder for content that is on its way.
 *
 * Every page in this app is server-rendered on demand, and the measurement put
 * time-to-first-byte at 240–248 ms on a laptop against a local database —
 * considerably more on a real network. Until now that quarter-second produced
 * no visible change at all: no skeleton, no progress, nothing. A fast app with
 * no pending state feels broken in exactly the way a slow one does, and the
 * user cannot tell which they have.
 *
 * `aria-hidden`, deliberately. A screen reader user is told the page is
 * loading once, by the region wrapper below; hearing twelve grey rectangles
 * announced is worse than silence.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cx("bg-surface animate-pulse rounded", className)}
      {...props}
    />
  );
}

/**
 * A loading state shaped like the thing that is coming.
 *
 * A spinner says "wait". A skeleton in the shape of the page says "a table is
 * coming, about this big" — so the layout does not jump when it arrives, and
 * the wait is spent recognising the destination rather than staring at a
 * void.
 *
 * `role="status"` with a real label, so the wait is announced once. `busy`
 * rather than a live region full of noise.
 */
export function PageSkeleton({
  shape = "list",
  label = "Loading",
}: {
  shape?: "list" | "table" | "form" | "prose";
  label?: string;
}) {
  return (
    <main
      id="main"
      role="status"
      aria-busy="true"
      aria-label={label}
      className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12"
    >
      {/* The header block, which every page has. */}
      <div className="border-rule flex flex-col gap-3 border-b pb-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {shape === "table" && (
        <div className="border-border overflow-hidden rounded-lg border">
          <div className="border-rule bg-surface/60 flex gap-4 border-b p-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-4 flex-1" />
            ))}
          </div>
          {Array.from({ length: 8 }, (_, row) => (
            <div key={row} className="border-rule flex gap-4 border-b p-3 last:border-0">
              {Array.from({ length: 5 }, (_, col) => (
                <Skeleton key={col} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      )}

      {shape === "list" &&
        Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="border-rule flex flex-col gap-2 rounded-lg border p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}

      {shape === "form" && (
        <div className="flex max-w-xl flex-col gap-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
      )}

      {shape === "prose" && (
        <div className="measure flex flex-col gap-3">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className={cx("h-4", i % 4 === 3 ? "w-2/3" : "w-full")} />
          ))}
        </div>
      )}
    </main>
  );
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "text-ui rounded-lg px-4 py-3",
        // A left rule and a tint: it reads as an aside rather than another
        // card competing with the content.
        tone === "info" && "border-accent bg-accent-soft text-ink border-l-2",
        tone === "danger" && "border-danger bg-danger-soft text-danger border-l-2",
      )}
    >
      {children}
    </div>
  );
}
