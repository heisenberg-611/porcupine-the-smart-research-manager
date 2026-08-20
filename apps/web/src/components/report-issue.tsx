"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui";
import {
  collectContext,
  formatContext,
  issueUrl,
  mailtoUrl,
  SUPPORT_EMAIL,
  type IssueKind,
} from "@/lib/support";

/**
 * Report a problem, or ask for something.
 *
 * Both open a prefilled issue form on GitHub. There is no backend behind this
 * and there should not be: an issue tracker already does the job, and adding a
 * table to store feedback would mean securing, moderating and eventually
 * migrating a worse version of it.
 *
 * The context is shown BEFORE the tab opens, not attached quietly. A GitHub
 * issue is public and permanent, and a person pressing "report a problem"
 * about a broken layout is not expecting to publish anything about themselves.
 * They get to read the five lines first, every time — which is also the only
 * honest way to claim, as the copy does, that it carries no project data.
 */
export function ReportIssue() {
  const pathname = usePathname() ?? "/";
  const [kind, setKind] = useState<IssueKind | null>(null);

  // Read at press time rather than on render: on the server there is no
  // `navigator` and no viewport, and a value captured during hydration would
  // describe the window before the reader resized it.
  const context = kind ? collectContext(pathname) : null;

  return (
    <section
      aria-labelledby="feedback"
      className="border-border rounded-[--radius-card] border p-4"
    >
      <h2 id="feedback" className="text-ink text-ui font-medium">
        Something broken, or missing?
      </h2>
      <p className="text-muted text-fine mt-1 text-pretty">
        Reports go to the public issue tracker. Nothing from your projects is attached —
        see for yourself before it opens.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant={kind === "bug" ? "primary" : "ghost"}
          className={kind === "bug" ? "" : "border-border border"}
          onClick={() => setKind(kind === "bug" ? null : "bug")}
          aria-expanded={kind === "bug"}
        >
          Report a problem
        </Button>
        <Button
          variant={kind === "feature" ? "primary" : "ghost"}
          className={kind === "feature" ? "" : "border-border border"}
          onClick={() => setKind(kind === "feature" ? null : "feature")}
          aria-expanded={kind === "feature"}
        >
          Request a feature
        </Button>
      </div>

      {kind && context && (
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <p className="text-muted text-fine mb-1">
              This much goes with it, and nothing else:
            </p>
            {/* The whole point of this block is that it can be read. It is
                deliberately the literal text that will be pasted into the
                issue's last field, not a summary of it. */}
            <pre className="border-rule bg-surface text-ink-soft text-fine overflow-x-auto rounded-lg border p-3 font-mono">
              {formatContext(context)}
            </pre>
            <p className="text-muted text-fine mt-1 text-pretty">
              The screen is the route&rsquo;s shape, not its address — project identifiers
              are replaced before they leave the page.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={issueUrl(kind, context)}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-accent text-accent-ink text-ui focus-visible:ring-accent inline-flex min-h-11 items-center rounded-lg px-4 focus-visible:ring-2 focus-visible:outline-none"
            >
              Open GitHub{" "}
              <span className="sr-only">(opens in a new tab, needs an account)</span>
              <span aria-hidden> ↗</span>
            </a>

            {/* Only when a deployment has configured one. A GitHub account is
                a real barrier for the people this product is for, and losing
                their reports is worse than an extra link. */}
            {SUPPORT_EMAIL && (
              <a
                href={mailtoUrl(kind, context)}
                className="text-accent text-fine underline underline-offset-4"
              >
                No GitHub account? Email it instead
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
