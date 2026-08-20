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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5",
        "text-ui font-medium transition-all duration-200",
        "focus-visible:ring-accent focus-visible:ring-2 focus-visible:ring-offset-2",
        "focus-visible:ring-offset-canvas focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none",
        variant === "primary" &&
          "bg-accent text-accent-ink shadow-sm hover:-translate-y-0.5 hover:shadow-md hover:brightness-110",
        // Ghost is a text button with a hover ground, not an outlined box.
        // Sixteen pages of outlined ghost buttons was most of why every screen
        // read as a form.
        variant === "ghost" && "text-ink hover:bg-surface",
        variant === "danger" && "text-danger hover:bg-danger-soft hover:-translate-y-0.5",
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

/**
 * Focus, for the three controls that are a bordered box.
 *
 * The box already HAS a hairline; the focused state recolours it to accent
 * instead of drawing a second shape around it. That is why each of these
 * suppresses the base ring — a ring plus a recoloured border is two green
 * outlines on one field, which is what this used to look like, and the
 * `outline-none` meant to prevent it only started working once the base rule
 * moved into a cascade layer.
 *
 * One border, one pixel, one colour change. Small controls that have no
 * border worth recolouring — Checkbox, Radio — keep the ring instead.
 *
 * `compact` is a variant rather than something a caller layers on with
 * `className`, because `cx` concatenates and does not merge: passing `h-7`
 * alongside the default `min-h-12` leaves both in the class list and lets
 * stylesheet order decide which wins. Swapping the size classes here is the
 * only way an override is actually reliable.
 *
 * It is for dense toolbars — the editor's text-size field — where a 48px
 * full-width field is not a smaller version of the right control, it is the
 * wrong one. Everything that takes real typing stays at the default size.
 */
export function Input({
  className,
  compact,
  ...props
}: ComponentProps<"input"> & { compact?: boolean }) {
  return (
    <input
      className={cx(
        "border-border bg-raised text-ink rounded-xl border shadow-sm",
        "transition-colors duration-200",
        "placeholder:text-muted/70",
        "hover:border-accent/40",
        "focus:border-accent focus-visible:outline-none",
        compact ? "text-fine h-7 rounded-md px-1" : "text-ui min-h-12 w-full px-4",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A file picker that looks like it belongs to this design system.
 *
 * Its own primitive rather than `<Input type="file" />`, because a file input
 * is two controls in one trench coat: the browser draws a button and a
 * filename label inside it, and neither responds to the border, padding or
 * background that make `Input` look like `Input`. Styling has to go through
 * `file:` to reach the button, and the surrounding text is the page's, not the
 * field's.
 *
 * The button mirrors `Button variant="ghost"` — same height, same radius, same
 * hover ground — so the picker reads as a control rather than as the raw
 * browser default sitting in the middle of a styled form.
 */
export function FileInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="file"
      className={cx(
        "text-ui text-ink w-full",
        "file:text-ui file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-full",
        "file:border-0 file:px-5 file:font-medium",
        "file:bg-surface file:text-ink hover:file:bg-border file:transition-colors",
        "focus-visible:ring-accent rounded-xl focus-visible:ring-2 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-40",
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
        "border-border bg-raised text-ink text-ui w-full rounded-xl border px-4 shadow-sm",
        "py-3 transition-colors duration-200",
        "placeholder:text-muted/70",
        "hover:border-accent/40",
        "focus:border-accent focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

/**
 * `compact` is a variant, not a className override — same reason as `Input`.
 *
 * `cx` is a plain join; there is no tailwind-merge in this repo. Passing
 * `className="w-auto"` to a control whose base list contains `w-full` does not
 * replace it, it appends a second width utility of equal specificity and lets
 * the stylesheet's emission order decide. That is not a rule anyone can hold
 * in their head, so the properties that a caller might reasonably want to
 * change — width, height, padding, type scale — are chosen HERE, by branch,
 * and never by concatenation.
 *
 * The compact form exists for the two places a select sits inline in a row of
 * other controls rather than in a form: the member role picker and the Drive
 * sharing dialog. Both were raw `<select>` elements until the guard caught
 * them, and both were raw precisely because the full-width primitive did not
 * fit and overriding it appeared not to work.
 */
export function Select({
  className,
  compact,
  ...props
}: ComponentProps<"select"> & { compact?: boolean }) {
  return (
    <select
      className={cx(
        "border-border bg-raised text-ink rounded-xl border shadow-sm",
        "transition-all duration-200",
        "hover:border-accent/40",
        "focus:border-accent focus-visible:outline-none",
        compact ? "text-ui min-h-9 rounded-lg px-2" : "text-ui min-h-12 w-full px-4",
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
        // No focus style of its own: a 16px box has no border worth
        // recolouring, so this keeps the base ring, which reads clearly around
        // something this small. It used to suppress the ring AND recolour the
        // border — a focused checkbox that showed almost nothing, once the
        // suppression started working.
        "border-border text-accent accent-accent size-4 rounded",
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
        // Keeps the base ring, for the reason Checkbox does.
        "border-border accent-accent size-4",
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
        /*
         * `relative` is load-bearing, not decoration.
         *
         * `overflow-x: auto` only clips an absolutely positioned descendant
         * when this element is that descendant's CONTAINING BLOCK — which it
         * is not unless it is positioned. Tailwind's `sr-only` is
         * `position: absolute`, and the evidence table has one inside every
         * sortable column header and every unanswered cell. Their static
         * positions are spread across a 3,700px-wide table, so they escaped
         * this clip, were laid out against the initial containing block, and
         * stretched `documentElement.scrollWidth` to 3,783px on a 1,280px
         * viewport.
         *
         * The symptom was the whole page scrolling sideways when the table
         * was scrolled — with `body.scrollWidth` still a correct 1,280, which
         * is the tell that something is positioned against the viewport rather
         * than flowing in the document.
         *
         * Measured: `window.scrollTo(600, 0)` moved the page before this line
         * and does nothing after it.
         */
        "border-border relative overflow-x-auto rounded-lg border",
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
