/**
 * The pages you can read without an account — one list, two consumers.
 *
 * It was two lists, and they had already diverged. `middleware.ts` let all
 * thirteen marketing routes through; `app-header-visibility.tsx` knew about
 * four of them. The other nine therefore rendered the SIGNED-IN application
 * header — Dashboard, Projects, Assigned to me, the sign-out form — above a
 * page written for someone who has not signed up. Signed out, they showed no
 * navigation at all, so /pricing was a dead end with no way back.
 *
 * Adding a public page now means adding it here, once. The route group at
 * `app/(public)` is the third place this shape appears, and it cannot be
 * derived from — a route group leaves no trace in the URL, which is exactly
 * why it is the right way to share a layout and the wrong way to answer a
 * question about a pathname.
 */
export const PUBLIC_PATHS = [
  "/",
  "/about",
  "/features",
  "/pricing",
  "/security",
  "/guides",
  "/feedback-and-contributions",
  "/api",
  "/changelog",
  "/blog",
  "/privacy",
  "/terms",
  "/dpa",
  "/cookies",
] as const;

/**
 * Routes that need no session but are not marketing pages: they are the
 * machinery of getting one. Public to the middleware, and never framed by the
 * public layout.
 */
export const AUTH_PATHS = ["/sign-in", "/auth"] as const;

/**
 * Reachable without a session, and not a page at all.
 *
 * The scheduled-purge endpoint authenticates itself with a shared secret and
 * runs from a cron with no cookies, so the middleware must let it through —
 * but it is emphatically not a marketing page and must not get the public
 * shell, so it is a third list rather than an entry in either of the two
 * above.
 *
 * It is `/tasks/...` and deliberately NOT `/api/...`: `/api` is a marketing
 * page in this app, `PUBLIC_PATHS` matches it by prefix, and a cron endpoint
 * that inherited that match would have been public to the middleware by
 * accident rather than by decision.
 */
export const MACHINE_PATHS = ["/tasks"] as const;

/** True for a marketing page — the ones that get the public shell. */
export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)),
  );
}

/** True for anything reachable without signing in. */
export function isPublicPath(pathname: string): boolean {
  return (
    isPublicPage(pathname) ||
    [...AUTH_PATHS, ...MACHINE_PATHS].some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    )
  );
}
