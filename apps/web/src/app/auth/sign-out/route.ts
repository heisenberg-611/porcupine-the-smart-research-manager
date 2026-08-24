import { NextResponse, type NextRequest } from "next/server";

import { recordUserSignOut } from "@/server/auth-audit";
import { createClient } from "@/lib/supabase/server";

/**
 * POST-only: a GET sign-out can be triggered by any image tag or link
 * prefetch on a page the user visits, which makes it a trivial nuisance CSRF.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await recordUserSignOut(user.id);
  }

  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/", request.url), {
    status: 303,
  });
}
