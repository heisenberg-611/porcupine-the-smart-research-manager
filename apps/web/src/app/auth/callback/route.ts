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
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=exchange_failed`);
  }

  return NextResponse.redirect(
    `${origin}/enroll?next=${encodeURIComponent(destination)}`,
  );
}
