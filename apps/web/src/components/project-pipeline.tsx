import Link from "next/link";
import type { WorkflowPipelineResult, WorkflowStep } from "@/lib/workflow-pipeline";

export function ProjectPipeline({ pipeline }: { pipeline: WorkflowPipelineResult }) {
  const { steps, overallPercent, completedStepsCount, totalStepsCount, nextAction } =
    pipeline;

  return (
    <section aria-labelledby="workflow-pipeline" className="flex flex-col gap-5">
      {/* ── Pipeline Header & Overall Progress Meter ─────────────────────── */}
      <div className="border-border/80 bg-raised/80 relative overflow-hidden rounded-2xl border p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-accent/15 text-accent border-accent/20 rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider uppercase">
                Workflow Pipeline
              </span>
              <span className="text-muted text-fine">
                {completedStepsCount} of {totalStepsCount} stages completed
              </span>
            </div>
            <h2
              id="workflow-pipeline"
              className="text-ink text-heading mt-2 font-semibold tracking-tight"
            >
              Research Lifecycle Progress
            </h2>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-ink text-title font-mono font-bold tabular-nums">
              {overallPercent}%
            </span>
            <span className="text-muted text-fine font-medium">overall</span>
          </div>
        </div>

        {/* ── Main Progress Meter ────────────────────────────────────────── */}
        <div className="mt-4">
          <div
            role="meter"
            aria-valuenow={overallPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Research progress: ${overallPercent}% completed`}
            className="bg-surface/80 border-border/60 h-3 w-full overflow-hidden rounded-full border shadow-inner"
          >
            <div
              className="bg-accent h-full rounded-full transition-all duration-700 ease-out"
              style={{ width: `${overallPercent}%` }}
            />
          </div>
        </div>

        {/* ── Integrated Next Recommended Action Spotlight ─────────────────── */}
        <div className="border-border/60 bg-surface/60 mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="bg-accent h-2 w-2 animate-pulse rounded-full" />
              <p className="text-accent text-fine font-semibold tracking-wider uppercase">
                Current Next Step
              </p>
            </div>
            <p className="text-ink text-ui mt-1 font-medium">{nextAction.why}</p>
          </div>
          <Link
            href={nextAction.href}
            className="bg-accent text-accent-ink hover:bg-accent-hover focus-visible:ring-accent text-ui inline-flex min-h-10 items-center justify-center rounded-xl px-5 font-semibold shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none active:scale-95"
          >
            {nextAction.label} →
          </Link>
        </div>
      </div>

      {/* ── 6-Stage Interactive Workflow Grid ────────────────────────────── */}
      <ol
        aria-label="Workflow stages"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {steps.map((step) => (
          <StepCard key={step.id} step={step} />
        ))}
      </ol>
    </section>
  );
}

function StepCard({ step }: { step: WorkflowStep }) {
  const isCompleted = step.status === "completed";
  const isCurrent = step.status === "current";

  return (
    <li>
      <Link
        href={step.href}
        aria-current={isCurrent ? "step" : undefined}
        className={`group focus-visible:ring-accent relative flex h-full flex-col justify-between rounded-2xl border p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:outline-none ${
          isCurrent
            ? "border-accent bg-raised/90 ring-accent/30 shadow-sm ring-1"
            : isCompleted
              ? "border-border/80 bg-raised/70 hover:border-accent/40 hover:bg-raised"
              : "border-border/50 bg-raised/40 hover:border-border hover:bg-raised/60 opacity-75 hover:opacity-100"
        }`}
      >
        {/* Top bar: Step number & Status badge */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center justify-center rounded-lg px-2 py-0.5 font-mono text-xs font-bold ${
                isCompleted
                  ? "bg-accent/15 text-accent border-accent/20 border"
                  : isCurrent
                    ? "bg-accent text-accent-ink"
                    : "bg-surface text-muted border-border/60 border"
              }`}
            >
              Step {step.stepNumber}
            </span>

            <span
              className={`text-fine inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium ${
                isCompleted
                  ? "bg-accent/10 text-accent"
                  : isCurrent
                    ? "bg-accent/15 text-accent font-semibold"
                    : "bg-surface/80 text-muted"
              }`}
            >
              {isCompleted ? (
                <>
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Done
                </>
              ) : isCurrent ? (
                <>
                  <span className="bg-accent h-1.5 w-1.5 animate-ping rounded-full" />
                  In Progress
                </>
              ) : (
                "Upcoming"
              )}
            </span>
          </div>

          <h3 className="text-ink text-ui group-hover:text-accent mt-3 font-semibold transition-colors">
            {step.label}
          </h3>

          <p className="text-muted text-fine mt-1 leading-relaxed text-pretty">
            {step.description}
          </p>
        </div>

        {/* Bottom bar: Metric & Mini Progress Meter */}
        <div className="border-border/50 mt-4 border-t pt-3">
          <div className="text-fine flex items-center justify-between">
            <span
              className={`truncate font-medium ${
                isCompleted
                  ? "text-accent"
                  : isCurrent
                    ? "text-ink font-semibold"
                    : "text-muted"
              }`}
            >
              {step.metric}
            </span>

            {step.percent > 0 && step.percent < 100 && (
              <span className="text-muted ml-2 shrink-0 font-mono">{step.percent}%</span>
            )}
          </div>

          {/* Mini progress bar for partially completed steps */}
          {step.percent > 0 && step.percent < 100 && (
            <div className="bg-surface/80 border-border/40 mt-1.5 h-1.5 w-full overflow-hidden rounded-full border">
              <div
                className="bg-accent h-full rounded-full transition-all duration-500"
                style={{ width: `${step.percent}%` }}
              />
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
