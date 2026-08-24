"use server";

import { getCurrentUser } from "@/lib/supabase/server";
import { recordUserSignIn } from "@/server/auth-audit";

export async function recordSignInSessionAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await recordUserSignIn(user.id);
  }
}
