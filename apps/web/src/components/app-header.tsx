import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";

import { getPendingDeletion } from "@/lib/account-state";
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

  const pendingDeletion = await getPendingDeletion(user.id);

  return (
    <>
      <header className="border-rule bg-canvas/85 fixed inset-x-0 top-0 z-40 h-[var(--app-header-h)] border-b backdrop-blur">
        {/*
        Wraps, rather than overflowing.

        On a 390px phone the contents do not fit on one line, and without
        `flex-wrap` the last items simply sat on top of the ones before them —
        the theme control ended up covering Sign out, which Playwright caught
        as an element intercepting pointer events. The flexible spacer below
        takes the slack on the first row, so the wrap lands in a sensible place
        instead of breaking mid-group.
      */}
        <nav aria-label="Main" className="flex h-full w-full flex-wrap items-center px-6">
          <Link
            href="/"
            className="text-ink text-heading mr-8 hidden font-serif sm:inline"
            aria-label="porcupineResearch home"
          >
            porcupineResearch
          </Link>

          <div className="flex items-center gap-1">
            <NavLink href="/dashboard">Dashboard</NavLink>
            <NavLink href="/projects" className="hidden sm:inline-flex">
              Projects
            </NavLink>
            <NavLink href="/assigned" className="hidden sm:inline-flex">
              Assigned to me
            </NavLink>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="text-muted text-fine hidden max-w-[16rem] truncate sm:block"
            >
              {user.email}
            </span>

            <NavLink href="/account" className="hidden sm:inline-flex">
              Account
            </NavLink>

            <ThemeToggle />

            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                aria-label={`Sign out ${user.email}`}
                className="text-muted hover:text-ink hover:bg-surface focus-visible:ring-accent text-ui inline-flex h-9 items-center rounded-lg px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                Sign out
              </button>
            </form>
          </div>
        </nav>
      </header>
      <div className="h-[var(--app-header-h)] shrink-0" aria-hidden />

      {/*
        The one notice worth putting above every screen.
        
        Nothing has happened yet — the account still works and still belongs to
        its projects — so this is not a warning about a broken state, it is the
        only place the person will reliably see that a clock is running. It is
        below the spacer rather than inside the fixed header, so it scrolls away
        instead of eating 44px of every page for thirty days.
      */}
      {pendingDeletion && (
        <div
          role="status"
          className="border-danger/30 bg-danger-soft text-ink text-ui border-b px-6 py-3"
        >
          <p className="mx-auto max-w-5xl text-pretty">
            This account is scheduled for deletion on <strong>{pendingDeletion}</strong>.{" "}
            <Link href="/account" className="text-accent underline underline-offset-4">
              Keep it
            </Link>
          </p>
        </div>
      )}
    </>
  );
}

/**
 * A nav link with a 44px touch target.
 *
 * `aria-current` is deliberately absent: marking the active item needs the
 * pathname, which would make this a client component and ship JavaScript for
 * a header that is otherwise entirely static. The project context is already
 * stated by every page's own heading.
 *
 * The DISPLAY utility comes from `className` and is deliberately absent from
 * the base list. It used to be `inline-flex` there, with callers appending
 * `hidden sm:inline-flex` to drop a link on a phone — and that silently did
 * nothing. Tailwind emits `.hidden{display:none}` BEFORE
 * `.inline-flex{display:inline-flex}`, so with both on one element and equal
 * specificity the base won and `hidden` lost. Every link meant to be hidden
 * below `sm` was in fact showing, the header wrapped to two rows on a phone,
 * and the fixed header then covered the top of the page — clicks landed on a
 * nav link instead of what was under it, which is the failure the comments
 * above describe and the e2e suite hit across six specs.
 */
function NavLink({
  href,
  children,
  className = "inline-flex",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`text-muted hover:text-ink hover:bg-surface focus-visible:ring-accent text-ui min-h-11 items-center rounded-lg px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none ${className}`}
    >
      {children}
    </Link>
  );
}
