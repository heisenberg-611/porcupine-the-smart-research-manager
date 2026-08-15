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
    <>
      <nav
        aria-label={`${projectTitle} sections`}
        className="fixed top-[var(--app-header-h)] hidden max-h-[calc(100dvh-var(--app-header-h))] w-56 shrink-0 overflow-y-auto py-8 lg:block"
      >
        <Link
          href={sectionHref(projectId, "")}
          aria-current={active === "" ? "page" : undefined}
          className={cx(
            "block rounded-lg px-3 py-2 transition-colors",
            "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
            active === "" ? "bg-accent-soft" : "hover:bg-surface",
          )}
        >
          <span className="text-muted text-fine block">Project</span>
          <span className="text-ink text-ui mt-0.5 block leading-snug font-medium text-pretty">
            {projectTitle}
          </span>
        </Link>
  
        <div className="mt-6 flex flex-col gap-6">
          {SECTION_GROUPS.map((group) => {
            const inGroup = byGroup.get(group);
            if (!inGroup || inGroup.length === 0) return null;
  
            return (
              <div key={group}>
                <h2 className="text-muted text-fine mb-1 px-3 font-mono tracking-wider uppercase">
                  {group}
                </h2>
                <ul>
                  {inGroup.map((section) => {
                    const current = active === section.slug;
                    return (
                      <li key={section.slug}>
                        <Link
                          href={sectionHref(projectId, section.slug)}
                          aria-current={current ? "page" : undefined}
                          className={cx(
                            "text-ui flex min-h-10 items-center rounded-lg px-3 transition-colors",
                            "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
                            current
                              ? "bg-accent-soft text-ink font-medium"
                              : "text-muted hover:text-ink hover:bg-surface",
                          )}
                        >
                          {/* A rule down the left of the active item, drawn in
                              the accent. The tinted background alone reads as
                              hover on a warm palette; the marker does not. */}
                          <span
                            aria-hidden
                            className={cx(
                              "mr-2 h-4 w-0.5 rounded-full",
                              current ? "bg-accent" : "bg-transparent",
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
      </nav>
      {/* Spacer to hold the width in the flex container since the nav is fixed */}
      <div className="hidden w-56 shrink-0 lg:block" aria-hidden />
    </>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
