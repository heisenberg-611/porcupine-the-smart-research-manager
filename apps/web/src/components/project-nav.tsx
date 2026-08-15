"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeSection, sectionHref, type ProjectSection } from "@/lib/project-sections";

/**
 * The bar that says which project you are in and which part of it — on a
 * narrow screen only. Wide screens get `ProjectSidebar`, which can afford to
 * group the same links by workflow phase; this is the version for a viewport
 * that cannot spare a column.
 *
 * A client component, reversing an earlier call. `AppHeader` deliberately
 * omitted `aria-current` on the reasoning that marking the active item needs
 * the pathname, which would ship JavaScript for an otherwise static header,
 * and that "the project context is already stated by every page's own
 * heading."
 *
 * That was true and it was not enough. With nine screens per project and no
 * lateral links, every move between them went back through the hub, and
 * nothing on screen said which of the nine you were looking at. This is a
 * handful of anchors — the JavaScript cost is real and small, and the thing it
 * buys is the answer to "where am I", which the audit found the app could not
 * give.
 *
 * The sections come from `projectSections()`, so a screen this project kind
 * does not have is absent rather than disabled: an unavailable feature is not
 * information a thesis student needs on every page.
 */
export function ProjectNav({
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

  return (
    // Sticky directly under the app header, and opaque rather than tinted:
    // a translucent bar over scrolling text reads as a rendering fault. The
    // wide-screen sidebar has been sticky since it was built; this is the
    // narrow-screen half catching up.
    <>
      <div className="border-rule bg-canvas fixed inset-x-0 top-[var(--app-header-h)] z-30 border-b lg:hidden">
        <div className="mx-auto max-w-5xl px-6">
          <nav aria-label={`${projectTitle} sections`}>
            {/* Scrolls on a phone rather than wrapping to three lines. The
                region is focusable for the same reason TableScroll is: a
                scroll container a keyboard cannot reach hides its own contents
                (WCAG 2.1.1). */}
            <ul
              className="focus-visible:ring-accent -mx-2 flex items-center gap-1 overflow-x-auto px-2 focus-visible:ring-2 focus-visible:outline-none"
              tabIndex={0}
            >
              <li className="shrink-0">
                <Link
                  href={sectionHref(projectId, "")}
                  aria-current={active === "" ? "page" : undefined}
                  className={cx(
                    "text-ui inline-flex min-h-11 items-center rounded-xl px-4 font-medium",
                    "focus-visible:ring-accent transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    active === ""
                      ? "text-ink bg-accent/10"
                      : "text-muted hover:text-ink hover:bg-raised/70",
                  )}
                >
                  {/* The project's name IS the overview link. One less thing on
                      the bar, and it reads as a breadcrumb rather than a tab. */}
                  <span className="max-w-[14rem] truncate">{projectTitle}</span>
                </Link>
              </li>

              <li aria-hidden className="text-muted/50 shrink-0 px-1">
                /
              </li>

              {sections.map((section) => (
                <li key={section.slug} className="shrink-0">
                  <Link
                    href={sectionHref(projectId, section.slug)}
                    aria-current={active === section.slug ? "page" : undefined}
                    className={cx(
                      "text-ui inline-flex min-h-11 items-center rounded-xl px-4",
                      "focus-visible:ring-accent transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      active === section.slug
                        ? "text-ink bg-accent/10 font-medium"
                        : "text-muted hover:text-ink hover:bg-raised/70",
                    )}
                  >
                    {section.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
      <div className="h-[var(--project-nav-h)] shrink-0 lg:hidden" aria-hidden />
    </>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
