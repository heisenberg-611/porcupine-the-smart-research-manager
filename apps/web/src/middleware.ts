import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
// `/about` is public deliberately: it is the page that explains the product to
// someone deciding whether to sign up. Behind auth it would only ever be read
// by people who no longer need it.
const PUBLIC_PATHS = ["/", "/about", "/sign-in", "/auth"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)),
  );
}

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

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
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
     *
     * `/latex/` is excluded too: it holds the TeX distribution the LaTeX
     * studio compiles against — a wasm module, a 13 MB bundle and package
     * tarballs. Running the auth middleware on those meant a Supabase session
     * lookup per asset request, and the compile worker's own script was
     * answered with a 307 to /sign-in when it had no cookie. There is nothing
     * private in a TeX distribution; it is the same bytes for everyone.
     */
    "/((?!_next/static|_next/image|latex/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)",
  ],
};
