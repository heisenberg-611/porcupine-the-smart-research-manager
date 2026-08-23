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
import { DeleteProjectDialog } from "./delete-project-dialog";
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
  isOwner = false,
}: {
  projectId: string;
  projectTitle: string;
  sections: ProjectSection[];
  isOwner?: boolean;
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
      className="bg-surface border-border hidden h-full w-64 shrink-0 flex-col border-r lg:flex"
    >
      <div className="bg-surface z-10 shrink-0 px-4 pt-8 pb-4">
        <Link
          href={sectionHref(projectId, "")}
          aria-current={active === "" ? "page" : undefined}
          className={cx(
            "block rounded-2xl px-4 py-3.5 transition-all duration-200 active:scale-95",
            "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
            active === ""
              ? "bg-raised shadow-xs ring-1 ring-black/5 dark:ring-white/5"
              : "bg-surface/40 hover:bg-surface hover:scale-[1.02] hover:shadow-xs",
          )}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <div className="bg-accent h-2 w-2 animate-pulse rounded-full" />
            <span className="text-muted font-mono text-[10px] font-semibold tracking-wider uppercase">
              Current Project
            </span>
          </div>
          <span className="text-ink block text-base leading-snug font-semibold text-pretty transition-colors">
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
                <h2 className="text-ink mb-2 flex items-center gap-3 px-3 font-mono text-xs font-bold tracking-widest uppercase">
                  {group}
                  <div className="bg-border/60 h-px flex-1" />
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
                            "text-ui flex min-h-10 items-center rounded-xl px-3.5 font-medium transition-all duration-200 active:scale-95",
                            "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
                            current
                              ? "bg-raised text-ink font-semibold shadow-xs"
                              : "text-muted hover:text-ink hover:bg-surface/80 hover:translate-x-1",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cx(
                              "mr-3 h-4 w-0.5 rounded-full transition-all duration-300",
                              current
                                ? "bg-accent scale-y-100"
                                : "scale-y-0 bg-transparent",
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
          <h2 className="text-ink mb-3 flex items-center gap-3 px-3 font-mono text-xs font-bold tracking-widest uppercase">
            Quick Actions
            <div className="bg-border/60 h-px flex-1" />
          </h2>
          <div className="flex flex-col gap-2 px-3">
            <QuickCreateButton type="doc" projectId={projectId} label="Create Doc" />
            <QuickCreateButton type="sheet" projectId={projectId} label="Create Sheet" />
            <QuickCreateButton type="slide" projectId={projectId} label="Create Slide" />
          </div>
        </div>

        {isOwner && (
          <div className="mt-8 mb-4">
            <h2 className="text-danger/80 mb-3 flex items-center gap-3 px-3 font-mono text-xs font-bold tracking-widest uppercase">
              Danger Zone
              <div className="bg-danger/20 h-px flex-1" />
            </h2>
            <div className="flex flex-col gap-2 px-3">
              <DeleteProjectDialog projectId={projectId} projectTitle={projectTitle} />
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
