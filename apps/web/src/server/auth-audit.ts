import "server-only";

import { createAdminClient } from "./admin";

/**
 * Inserts a LOGIN audit event row into the permanent `member_auth_events` database table.
 * Executed every time a user authenticates / signs in.
 */
export async function recordUserSignIn(
  userId: string,
  action = "Signed in to Porcupine",
  deviceLabel = "Web Session",
): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return;

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
 * Executed every time a user signs out.
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
