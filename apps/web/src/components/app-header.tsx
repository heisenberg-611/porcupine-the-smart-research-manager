import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

import { getCurrentUser } from "@/lib/supabase/server";

/**
 * The application shell.
 *
 * Added late, and that was a mistake worth naming: thirteen pages shipped
 * before this existed, so landing on /queue left no way to reach anything
 * except the browser's back button. That is a functional defect rather than
 * polish — a tool whose pages cannot be reached from each other is a set of
 * URLs, not an application.
 *
 * Renders nothing when signed out, so the landing page and sign-in keep their
 * own full-bleed layout rather than being framed by navigation that would only
 * offer links the visitor cannot follow.
 */
export async function AppHeader() {
  const user = await getCurrentUser();
  if (!user) return null;

  return (
    <header className="border-rule bg-canvas/85 sticky top-0 z-40 border-b backdrop-blur">
      {/*
        Wraps, rather than overflowing.

        On a 390px phone the contents do not fit on one line, and without
        `flex-wrap` the last items simply sat on top of the ones before them —
        the theme control ended up covering Sign out, which Playwright caught
        as an element intercepting pointer events. The flexible spacer below
        takes the slack on the first row, so the wrap lands in a sensible place
        instead of breaking mid-group.
      */}
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-1 gap-y-1 px-6 py-2"
      >
        {/*
          Hidden on a phone, and nothing is lost: "Projects" below points at
          the same place, so this is a wordmark rather than a destination.

          It buys the ~85px the theme control needs to sit on the SAME ROW.
          That matters more than it sounds. With everything present the header
          wrapped to two lines, and a two-line header broke clicks much further
          down the page — a link in the evidence table could not be reached at
          all. A header that does not fit is not a cosmetic problem.
        */}
        <Link
          href="/dashboard"
          className="text-ink text-heading mr-4 hidden font-serif sm:inline"
          aria-label="Porcupine home"
        >
          Porcupine
        </Link>

        {/*
          Only the dashboard below `sm`, and that is a width calculation
          rather than a taste. Four links plus the theme control plus Sign out
          do not fit on a 390px header, and a header that wraps to two rows
          covers what the page scrolls to — a link in the evidence table
          became unreachable that way. The dashboard links to both of the
          others, so nothing is lost but a tap.
        */}
        <NavLink href="/dashboard">Dashboard</NavLink>
        <NavLink href="/projects" className="hidden sm:inline-flex">
          Projects
        </NavLink>
        <NavLink href="/queue" className="hidden sm:inline-flex">
          My queue
        </NavLink>

        <div className="flex-1" />

        {/* The address, not a display name: on a shared machine "signed in as
            who?" is the question, and a first name does not answer it.
            Hidden below `sm` because a phone header has no room for it — but
            then a phone user could not tell whose session they were in, so the
            address moves into the sign-out button's accessible name rather
            than disappearing. Visually it is redundant on desktop; on mobile
            and to a screen reader it is the only place the answer exists. */}
        <span
          aria-hidden
          className="text-muted text-fine hidden max-w-[16rem] truncate sm:block"
        >
          {user.email}
        </span>

        <ThemeToggle />

        <form action="/auth/sign-out" method="post">
          <button
            type="submit"
            aria-label={`Sign out ${user.email}`}
            className="text-muted hover:text-ink hover:bg-surface focus-visible:ring-accent text-ui inline-flex min-h-11 items-center rounded-lg px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}

/**
 * A nav link with a 44px touch target.
 *
 * `aria-current` is deliberately absent: marking the active item needs the
 * pathname, which would make this a client component and ship JavaScript for
 * a header that is otherwise entirely static. The project context is already
 * stated by every page's own heading.
 */
function NavLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`text-muted hover:text-ink hover:bg-surface focus-visible:ring-accent text-ui inline-flex min-h-11 items-center rounded-lg px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none ${className}`}
    >
      {children}
    </Link>
  );
}
