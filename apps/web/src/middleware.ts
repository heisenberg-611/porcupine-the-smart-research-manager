import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isPublicPath } from "@/lib/public-routes";

/**
 * Refreshes the Supabase session on every request and gates private routes.
 *
 * Server Components cannot write cookies, so without this the access token
 * expires and users get silently logged out mid-session. `server.ts`
 * swallows its cookie-write failures precisely because this runs first.
 *
 * This is a convenience gate, not the security boundary — RLS is. A bug here
 * shows someone an empty page; it does not show them another user's data.
 */
/*
 * `/about` is public deliberately: it is the page that explains the product to
 * someone deciding whether to sign up. Behind auth it would only ever be read
 * by people who no longer need it — and the same argument covers every other
 * page in `app/(public)`.
 *
 * The list itself lives in `lib/public-routes.ts` because the app header needs
 * the same answer, and when the two were written out separately here they
 * disagreed.
 */

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must be getUser(), not getSession() — getSession trusts the cookie
  // without verifying it. This call is also what performs the refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimization.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|.well-known/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|html)$).*)",
  ],
};
