import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";

import logo from "@/app/logo.png";

/**
 * The site index, on every public page.
 *
 * It used to be written inline at the bottom of the landing page, which meant
 * that following any link in it — to /pricing, say — landed you on a page with
 * no footer and no header, and therefore no way back to anything except the
 * browser's back button. Thirteen pages, one of which could reach the other
 * twelve.
 *
 * Deliberately not rendered inside the application. Someone with a project
 * open does not need a link to the pricing page, and the shell they are
 * working in should not grow a marketing site at the bottom of it.
 */
export function SiteFooter() {
  return (
    <footer className="border-rule border-t">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-4 lg:grid-cols-5">
          <div className="col-span-2 flex flex-col gap-5">
            <Link
              href="/"
              className="text-ink focus-visible:ring-accent flex w-fit items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
            >
              <Image src={logo} alt="" className="size-9 rounded-lg object-contain" />
              <span className="text-heading font-serif">porcupineResearch</span>
            </Link>

            <p className="text-muted text-ui measure text-pretty">
              A literature review from the first search to the finished evidence table,
              with every decision recorded under the name of the person who made it.
            </p>

            <div className="text-muted text-fine flex flex-col gap-1">
              <p>Designed and built by Dhrubojyoti Saha.</p>
              <p>
                <a
                  className="hover:text-ink focus-visible:ring-accent rounded underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
                  href="mailto:dhrubojyoti.saha@g.bracu.ac.bd"
                >
                  dhrubojyoti.saha@g.bracu.ac.bd
                </a>
              </p>
            </div>
          </div>

          {GROUPS.map((group) => (
            <nav key={group.heading} aria-labelledby={`footer-${group.id}`}>
              <h2
                id={`footer-${group.id}`}
                className="text-ink text-fine font-sans font-semibold tracking-wide uppercase"
              >
                {group.heading}
              </h2>
              <ul className="text-ui mt-4 flex flex-col gap-3">
                {group.links.map(({ href, label }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="text-muted hover:text-ink focus-visible:ring-accent rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="border-rule mt-14 flex flex-col items-start justify-between gap-4 border-t pt-8 sm:flex-row sm:items-center">
          {/*
            No year. `new Date().getFullYear()` here would be the year of
            whichever machine rendered the page — and on a statically rendered
            route, the year it was BUILT, which is how a footer ends up
            confidently claiming 2026 in 2028.
          */}
          <p className="text-muted text-fine">
            © porcupineResearch. Free for students and academic use.
          </p>

          <ul className="text-muted flex items-center gap-1">
            {SOCIAL.map(({ href, label, path, evenOdd }) => (
              <li key={href}>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                  className="hover:text-ink hover:bg-surface focus-visible:ring-accent inline-flex size-11 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <svg
                    className="size-5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    {/* The GitHub and LinkedIn marks are single paths whose
                        counters — the holes in the cat's outline, the dot on
                        the "i" — are cut by winding direction. Filled with the
                        default nonzero rule they come out as solid blobs. */}
                    <path
                      d={path}
                      fillRule={evenOdd ? "evenodd" : undefined}
                      clipRule={evenOdd ? "evenodd" : undefined}
                    />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

/*
 * Grouped by what a reader is trying to do, not by who owns the page.
 *
 * "Documentation" used to point at /about while /guides sat under a different
 * heading, so the two pages that both explain how to use the thing were in
 * different columns. They are together now, and every label matches the
 * heading of the page it opens — a link called "Documentation" that lands on a
 * page titled "How it works" is a small lie that costs a reader a moment every
 * time.
 */
const GROUPS: ReadonlyArray<{
  id: string;
  heading: string;
  links: ReadonlyArray<{ href: Route; label: string }>;
}> = [
  {
    id: "product",
    heading: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/security", label: "Security" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    id: "learn",
    heading: "Learn",
    links: [
      { href: "/about", label: "How it works" },
      { href: "/guides", label: "Guides" },
      { href: "/feedback-and-contributions" as Route, label: "Contributors & Feedback" },
      { href: "/api", label: "API and exports" },
      { href: "/blog", label: "Build notes" },
    ],
  },
  {
    id: "legal",
    heading: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/dpa", label: "Data processing" },
      { href: "/cookies", label: "Cookies" },
    ],
  },
];

/** Inline paths rather than an icon package, so the CSP has no origin to allow. */
const SOCIAL: ReadonlyArray<{
  href: string;
  label: string;
  path: string;
  evenOdd?: boolean;
}> = [
  {
    href: "https://x.com/Dhruboj52821394",
    label: "porcupineResearch on X",
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.005 4.15H5.059z",
  },
  {
    href: "https://github.com/heisenberg-611",
    label: "porcupineResearch on GitHub",
    evenOdd: true,
    path: "M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z",
  },
  {
    href: "https://linkedin.com/in/dhrubojyoti-saha-3084a02bb/",
    label: "Dhrubojyoti Saha on LinkedIn",
    evenOdd: true,
    path: "M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z",
  },
];
