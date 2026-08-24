"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { WorkflowPipelineResult, WorkflowStep } from "@/lib/workflow-pipeline";

/**
 * Compact Top Bar Workflow Status Stepper with Arrows.
 *
 * Appears across sub-pages in a project (hidden on the dashboard overview)
 * to give members an instant map of the 6-stage research workflow.
 */
export function ProjectWorkflowBar({
  pipeline,
  projectId,
}: {
  pipeline: WorkflowPipelineResult;
  projectId: string;
}) {
  const pathname = usePathname() ?? "";

  // Do not render on the overview dashboard, as it already contains the full pipeline widget
  const isDashboard =
    pathname === `/projects/${projectId}` ||
    pathname === `/projects/${projectId}/`;

  if (isDashboard) return null;

  return (
    <div className="border-rule bg-canvas/95 sticky top-0 z-20 w-full border-b backdrop-blur-md transition-all">
      <div className="flex items-center justify-between gap-3 overflow-x-auto px-4 py-2.5 sm:px-6 lg:px-12 scrollbar-none">
        {/* Left: Workflow Stages Stepper connected with Arrows */}
        <nav aria-label="Research workflow progress" className="min-w-max flex-1">
          <ol className="flex items-center gap-1.5 sm:gap-2">
            {pipeline.steps.map((step, idx) => {
              const isLast = idx === pipeline.steps.length - 1;
              const isCurrentRoute =
                step.href === pathname ||
                (step.id === "search" &&
                  (pathname.includes("/search") ||
                    pathname.includes("/import") ||
                    pathname.includes("/library"))) ||
                (step.id === "screen" &&
                  (pathname.includes("/screen") ||
                    pathname.includes("/progress") ||
                    pathname.includes("/prisma"))) ||
                (step.id === "extract" &&
                  (pathname.includes("/extract") || pathname.includes("/reconcile")));

              return (
                <li key={step.id} className="flex items-center gap-1.5 sm:gap-2">
                  <WorkflowStepPill
                    step={step}
                    isCurrentRoute={isCurrentRoute}
                  />
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className={`text-xs font-semibold select-none ${
                        step.status === "completed"
                          ? "text-accent/70 font-bold"
                          : "text-muted/40"
                      }`}
                    >
                      →
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Right: Overall Progress Metric */}
        <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
          <div className="flex items-center gap-1.5">
            <span className="text-muted text-[11px] font-medium tracking-wider uppercase">
              Pipeline
            </span>
            <span className="text-ink text-xs font-bold tabular-nums">
              {pipeline.overallPercent}%
            </span>
          </div>

          <div
            className="bg-raised h-1.5 w-16 overflow-hidden rounded-full ring-1 ring-black/5 dark:ring-white/5"
            role="progressbar"
            aria-valuenow={pipeline.overallPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Overall project pipeline progress"
          >
            <div
              className="bg-accent h-full rounded-full transition-all duration-500"
              style={{ width: `${pipeline.overallPercent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowStepPill({
  step,
  isCurrentRoute,
}: {
  step: WorkflowStep;
  isCurrentRoute: boolean;
}) {
  const isCompleted = step.status === "completed";
  const isCurrentStep = step.status === "current";

  return (
    <Link
      href={step.href}
      title={`${step.label}: ${step.metric}`}
      className={`group focus-visible:ring-accent inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:outline-none ${
        isCompleted
          ? "bg-accent/10 text-ink hover:bg-accent/20 border border-accent/25"
          : isCurrentStep
            ? "bg-raised text-ink ring-accent/60 shadow-xs ring-1.5 font-semibold"
            : "text-muted hover:text-ink hover:bg-raised/70 border border-transparent"
      } ${isCurrentRoute ? "ring-1 ring-ink/20 dark:ring-white/20" : ""}`}
    >
      {/* Status icon / dot / step number */}
      {isCompleted ? (
        <span
          aria-hidden="true"
          className="text-accent flex h-3.5 w-3.5 items-center justify-center text-[11px] font-bold"
        >
          ✓
        </span>
      ) : isCurrentStep ? (
        <span className="relative flex h-2 w-2">
          <span className="bg-accent absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
          <span className="bg-accent relative inline-flex h-2 w-2 rounded-full" />
        </span>
      ) : (
        <span className="text-muted/60 font-mono text-[10px] font-semibold">
          {step.stepNumber}.
        </span>
      )}

      {/* Label */}
      <span className="truncate">
        {step.shortLabel}
      </span>

      {/* In-progress percentage badge if partial */}
      {isCurrentStep && step.percent > 0 && step.percent < 100 && (
        <span className="text-accent text-[10px] font-bold tabular-nums">
          {step.percent}%
        </span>
      )}
    </Link>
  );
}
