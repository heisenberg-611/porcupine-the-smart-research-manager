"use server";

import { getCurrentUser } from "@/lib/supabase/server";
import { recordUserSignIn } from "@/server/auth-audit";

export async function recordSignInSessionAction(userId?: string): Promise<void> {
  const targetId = userId || (await getCurrentUser())?.id;
  if (targetId) {
    await recordUserSignIn(targetId);
  }
}
