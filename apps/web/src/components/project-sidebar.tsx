"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  activeSection,
  SECTION_GROUPS,
  sectionHref,
  type ProjectSection,
  type SectionGroup,
} from "@/lib/project-sections";
import { QuickCreateButton } from "./quick-create-button";

/**
 * Where you are in a project, and what else there is.
 *
 * This replaces a strip of tabs that ran along the top under the app header,
 * and it is a different thing rather than the same thing moved. The tabs put
 * eleven destinations in one undifferentiated row, in an order only the code
 * knew, and then the overview page listed those same eleven AGAIN as a grid of
 * cards. Two presentations of one menu, on the same screen, disagreeing about
 * which order the work happens in.
 *
 * Grouping is the part that carries the meaning. Collect → Screen → Extract →
 * Synthesise is the shape of a review, so the menu is also a statement of
 * where the project is up to. That is something a row of tabs cannot say, and
 * the grid of cards said only by accident of its ordering.
 *
 * Sections come from `projectSections()`, so a screen this project kind does
 * not have is absent rather than disabled — a thesis student has no use for
 * knowing that reconciliation exists for someone else.
 */
export function ProjectSidebar({
  projectId,
  projectTitle,
  sections,
}: {
  projectId: string;
  projectTitle: string;
  sections: ProjectSection[];
}) {
  const pathname = usePathname();
  const active = activeSection(pathname ?? "", projectId);

  const byGroup = new Map<SectionGroup, ProjectSection[]>();
  for (const section of sections) {
    byGroup.set(section.group, [...(byGroup.get(section.group) ?? []), section]);
  }

  return (
    <nav
      aria-label={`${projectTitle} sections`}
      className="hidden lg:flex flex-col w-64 shrink-0 h-[calc(100vh-theme(spacing.16))] bg-surface border-r border-border"
    >
      <div className="shrink-0 pt-8 px-4 pb-4 bg-surface z-10">
        <Link
          href={sectionHref(projectId, "")}
          aria-current={active === "" ? "page" : undefined}
          className={cx(
            "block rounded-xl px-4 py-3 transition-all duration-200 active:scale-95 border",
            "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
            active === "" 
              ? "bg-surface border-border shadow-sm ring-1 ring-black/5 dark:ring-white/5" 
              : "bg-surface/40 border-transparent hover:bg-surface hover:border-border hover:shadow-sm hover:scale-[1.02]",
          )}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-muted text-[10px] font-mono tracking-wider uppercase font-semibold">
              Current Project
            </span>
          </div>
          <span className="text-ink text-base block leading-snug font-semibold text-pretty transition-colors">
            {projectTitle}
          </span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <div className="flex flex-col gap-6">
          {SECTION_GROUPS.map((group) => {
            const inGroup = byGroup.get(group);
            if (!inGroup || inGroup.length === 0) return null;

            return (
              <div key={group}>
                <h2 className="text-ink text-xs mb-2 px-3 font-mono tracking-widest uppercase font-bold flex items-center gap-3">
                  {group}
                  <div className="flex-1 h-px bg-border/60" />
                </h2>
                <ul className="space-y-1">
                  {inGroup.map((section) => {
                    const current = active === section.slug;
                    return (
                      <li key={section.slug}>
                        <Link
                          href={sectionHref(projectId, section.slug)}
                          aria-current={current ? "page" : undefined}
                          className={cx(
                            "text-ui flex min-h-9 items-center rounded-lg px-3 transition-all duration-200 active:scale-95",
                            "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
                            current
                              ? "bg-surface text-ink font-semibold shadow-sm"
                              : "text-muted hover:text-ink hover:bg-surface/50 hover:translate-x-1",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cx(
                              "mr-3 h-4 w-0.5 rounded-full transition-all duration-300",
                              current ? "bg-accent scale-y-100" : "bg-transparent scale-y-0",
                            )}
                          />
                          {section.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="mt-8">
          <h2 className="text-ink text-xs mb-3 px-3 font-mono tracking-widest uppercase font-bold flex items-center gap-3">
            Quick Actions
            <div className="flex-1 h-px bg-border/60" />
          </h2>
          <div className="px-3 flex flex-col gap-2">
            <QuickCreateButton type="doc" projectId={projectId} label="Create Doc" />
            <QuickCreateButton type="sheet" projectId={projectId} label="Create Sheet" />
            <QuickCreateButton type="slide" projectId={projectId} label="Create Slide" />
          </div>
        </div>
      </div>
    </nav>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
