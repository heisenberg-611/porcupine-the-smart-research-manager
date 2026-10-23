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
  const { pathname } = request.nextUrl;

  // Sanitize incoming headers to prevent client-side header spoofing
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-supabase-user");

  // Fast path for public routes without an active Supabase session cookie:
  // If an unauthenticated visitor requests a public marketing page, do not waste
  // an external HTTPS network call to Supabase Auth.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  if (isPublicPath(pathname) && !hasAuthCookie) {
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

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
          response = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          });
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

  if (user) {
    requestHeaders.set("x-supabase-user", JSON.stringify(user));
  } else {
    requestHeaders.delete("x-supabase-user");
  }

  // Preserve any cookies set by Supabase SSR during token refresh
  const existingCookies = response.cookies.getAll();
  response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  for (const cookie of existingCookies) {
    response.cookies.set(cookie);
  }

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
