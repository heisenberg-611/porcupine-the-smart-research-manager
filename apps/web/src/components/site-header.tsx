import Image from "next/image";
import Link from "next/link";

import logo from "@/app/logo.png";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * The header for the pages in front of the door.
 *
 * Separate from `AppHeader` on purpose, and not a variant of it. They answer
 * different questions: the application header answers "where else in my
 * project can I go", this one answers "what is this and how do I get in". A
 * single component with a `variant` prop would be two components sharing a
 * file and a bug surface.
 *
 * The only stateful thing here is the call to action, and it has to be. A
 * page that offers "Sign in" to someone already signed in is the tell that it
 * was written for one audience and shown to two — the same reason `/` stopped
 * redirecting to the dashboard.
 *
 * Not fixed, unlike the application header. There is nothing to scroll past
 * here that a reader needs to keep in reach, and a fixed bar costs the top
 * 4.5rem of every phone screen on a page whose whole job is to be read.
 */
export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-rule border-b">
      <nav
        aria-label="Site"
        className="mx-auto flex h-20 max-w-5xl items-center gap-8 px-6"
      >
        <Link
          href="/"
          className="text-ink focus-visible:ring-accent flex shrink-0 items-center gap-3 rounded-xl focus-visible:ring-2 focus-visible:outline-none"
          aria-label="porcupineResearch home"
        >
          <Image
            src={logo}
            alt=""
            className="size-9 rounded-xl object-contain shadow-xs"
            priority
          />
          <span className="text-heading font-serif">porcupineResearch</span>
        </Link>

        {/*
          Below `sm` this is the wordmark and the way in, and nothing else.

          The DISPLAY utility is on the list itself rather than on each link,
          because `hidden sm:flex` on a element that also carries `flex` in its
          base class list does nothing: Tailwind emits `.hidden` BEFORE
          `.flex`, so at equal specificity the base wins. That trap cost six
          e2e specs in the application header — see the note on `NavLink`.
        */}
        <ul className="text-ui hidden flex-1 items-center gap-1 sm:flex">
          {NAV.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className="text-muted hover:text-ink hover:bg-surface/80 focus-visible:ring-accent inline-flex min-h-11 items-center rounded-xl px-3.5 transition-all focus-visible:ring-2 focus-visible:outline-none"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex flex-1 justify-end sm:flex-none">
          {user ? (
            <Link
              href="/dashboard"
              className="bg-accent text-accent-ink focus-visible:ring-accent text-ui inline-flex min-h-11 items-center rounded-xl px-5 font-medium shadow-xs transition-all hover:opacity-90 hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              Dashboard
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className="border-border text-ink hover:bg-surface/80 hover:border-accent/40 focus-visible:ring-accent text-ui inline-flex min-h-11 items-center rounded-xl border px-5 font-medium shadow-xs transition-all focus-visible:ring-2 focus-visible:outline-none"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}

/*
 * Four, not thirteen. The footer carries the full index; a header that lists
 * every page is a sitemap with a background colour.
 *
 * `/about` is deliberately absent even though it is the most useful of them:
 * the landing page's own "How it works" button is the one link on the site
 * that has to be unambiguous, and a second link with the same name in the
 * header would make it ambiguous — to a screen-reader user reading the link
 * list, and to the test that asserts the button exists.
 */
const NAV: ReadonlyArray<{
  href: "/features" | "/pricing" | "/security" | "/guides" | "/feedback-and-contributions";
  label: string;
}> = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
  { href: "/guides", label: "Guides" },
  { href: "/feedback-and-contributions", label: "Contributions" },
];
