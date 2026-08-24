import "server-only";

import { createAdminClient } from "./admin";

/**
 * Inserts a LOGIN audit event row into the permanent `member_auth_events` database table.
 * Deduplicates rapid concurrent triggers within 30 seconds to prevent double-logging.
 */
export async function recordUserSignIn(
  userId: string,
  action = "Signed in to Porcupine",
  deviceLabel = "Web Session",
): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return;

    // Check if a login was already logged for this user in the last 30 seconds
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000).toISOString();
    const { data: recent } = await admin
      .from("member_auth_events")
      .select("id")
      .eq("user_id", userId)
      .eq("event_type", "LOGIN")
      .gte("created_at", thirtySecondsAgo)
      .limit(1);

    if (recent && recent.length > 0) return;

    await admin.from("member_auth_events").insert({
      user_id: userId,
      event_type: "LOGIN",
      action,
      device_label: deviceLabel,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Non-blocking: failures in audit log must never break user auth flow
  }
}

/**
 * Inserts a LOGOUT audit event row into the permanent `member_auth_events` database table.
 */
export async function recordUserSignOut(
  userId: string,
  action = "Signed out of Porcupine",
  deviceLabel = "Web Session",
): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return;

    await admin.from("member_auth_events").insert({
      user_id: userId,
      event_type: "LOGOUT",
      action,
      device_label: deviceLabel,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Non-blocking: failures in audit log must never break user auth flow
  }
}
