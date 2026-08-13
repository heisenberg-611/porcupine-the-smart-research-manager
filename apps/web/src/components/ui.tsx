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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-accent-ink hover:opacity-90",
        variant === "ghost" && "border-border text-ink hover:bg-surface border",
        variant === "danger" && "text-danger border-danger/40 hover:bg-danger/10 border",
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
  hint?: string;
  error?: string;
  id: string;
  children: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink text-sm font-medium">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-muted text-xs">
          {hint}
        </p>
      )}
      {children}
      {/* Announced on change so a screen reader hears the failure without
          the user having to hunt for it. */}
      {error && (
        <p id={errorId} role="alert" className="text-danger text-xs">
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
        "border-border bg-canvas text-ink min-h-11 rounded-lg border px-3 text-sm",
        "placeholder:text-muted/70",
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
        "border-border bg-canvas text-ink min-h-24 rounded-lg border px-3 py-2 text-sm",
        "placeholder:text-muted/70",
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
        "border-border bg-canvas text-ink min-h-11 rounded-lg border px-3 text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx("border-border bg-surface rounded-xl border p-5", className)}
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
    <Card className="flex flex-col items-start gap-3 py-10 text-left">
      <h2 className="text-ink text-base font-medium">{title}</h2>
      <p className="text-muted max-w-prose text-sm text-pretty">{description}</p>
      {action}
    </Card>
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
        "rounded-lg border px-4 py-3 text-sm",
        tone === "info" && "border-border bg-surface text-ink",
        tone === "danger" && "border-danger/40 bg-danger/10 text-danger",
      )}
    >
      {children}
    </div>
  );
}
