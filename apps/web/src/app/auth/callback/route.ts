import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / magic-link callback. Exchanges the code for a session, then sends
 * the user through enrollment, which decides whether they still need
 * identity keys.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Local paths only — an open redirect on an auth callback is a phishing
  // primitive, and this is the highest-trust moment in the whole flow.
  const destination = next?.startsWith("/") ? next : "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=exchange_failed`);
  }

  const response = NextResponse.redirect(
    `${origin}/enroll?next=${encodeURIComponent(destination)}`,
  );

  // @supabase/ssr intentionally drops the provider_token from its own session
  // cookies to avoid hitting HTTP header size limits. Since we need it to talk
  // to Google Drive, we explicitly stash it in a separate cookie.
  if (data.session?.provider_token) {
    response.cookies.set("google_provider_token", data.session.provider_token, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 3600, // Google access tokens last 1 hour
    });
  }
  
  if (data.session?.provider_refresh_token) {
    response.cookies.set("google_provider_refresh_token", data.session.provider_refresh_token, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  }

  return response;
}
