"use client";

import { usePathname } from "next/navigation";

import { isPublicPage } from "@/lib/public-routes";

/**
 * Keeps the signed-in application header off the pages in front of the door.
 *
 * The public pages carry their own header — a wordmark, three links, one way
 * in — and the two must not stack. They used to: this component knew about
 * four public routes and the middleware knew about thirteen, so /pricing,
 * /features, /security and six others rendered Dashboard / Projects /
 * Assigned to me / Sign out above marketing copy for a signed-in reader, and
 * nothing at all for a signed-out one.
 *
 * Both now read the same list. See `lib/public-routes.ts`.
 *
 * Still a client component, and still only because `usePathname` is: the
 * header itself is a server component and stays one. `/sign-in` is deliberately
 * NOT in this check — nobody signed in ever sees it, the middleware redirects
 * them away first.
 */
export function AppHeaderVisibility({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isPublicPage(pathname)) return null;
  return <>{children}</>;
}
