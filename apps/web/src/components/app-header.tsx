import Link from "next/link";

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
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-5xl items-center gap-1 px-6 py-2"
      >
        <Link
          href="/projects"
          className="text-ink text-heading mr-4 font-serif"
          aria-label="Porcupine home"
        >
          Porcupine
        </Link>

        <NavLink href="/projects">Projects</NavLink>
        <NavLink href="/queue">My queue</NavLink>

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
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-muted hover:text-ink hover:bg-surface focus-visible:ring-accent text-ui inline-flex min-h-11 items-center rounded-lg px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}
