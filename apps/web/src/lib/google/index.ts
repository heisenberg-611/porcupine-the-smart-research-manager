import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID,
  process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET,
);

export async function getAdminToken(refreshToken: string): Promise<string | null> {
  try {
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const res = await oauth2Client.getAccessToken();
    return res.token ?? null;
  } catch (e) {
    console.error("Failed to refresh admin token:", e);
    return null;
  }
}

export function getDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

export async function getGoogleEmail(accessToken: string): Promise<string | null> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: "v2", auth });
  try {
    const res = await oauth2.userinfo.get();
    return res.data.email ?? null;
  } catch (e) {
    console.error("Failed to get google email:", e);
    return null;
  }
}

/**
 * Unused since the Sheets export was removed.
 *
 * Kept because the removal was of a broken ROUTE, not of the idea: that export
 * failed because it read `session.provider_token`, which Supabase only
 * populates in the moments after a Google OAuth sign-in, so it 403'd for
 * everybody who signed in with an emailed code. A version built on the stored
 * refresh token — the one the Drive integration already uses — would work, and
 * would start from this function.
 */
export function getSheetsClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth });
}

export async function createProjectFolder(accessToken: string, projectName: string) {
  const drive = getDriveClient(accessToken);

  const response = await drive.files.create({
    requestBody: {
      name: `Porcupine: ${projectName}`,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  return response.data.id;
}

export async function listFolderFiles(accessToken: string, folderId: string) {
  const drive = getDriveClient(accessToken);
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields:
      "files(id, name, mimeType, webViewLink, iconLink, modifiedTime, createdTime, owners(displayName, photoLink))",
    orderBy: "modifiedTime desc",
  });
  return response.data.files ?? [];
}

export async function listProjectFiles(
  accessToken: string,
  projectId: string,
  onlyOwnedByMe: boolean = false,
  folderId?: string,
) {
  const drive = getDriveClient(accessToken);

  let q = `(appProperties has { key='PorcupineProjectId' and value='${projectId}' }`;
  if (folderId) {
    q += ` or '${folderId}' in parents`;
  }
  q += `) and trashed = false`;

  if (onlyOwnedByMe) {
    q += " and 'me' in owners";
  }

  const response = await drive.files.list({
    q,
    fields:
      "files(id, name, mimeType, webViewLink, iconLink, modifiedTime, createdTime, owners(displayName, photoLink))",
    orderBy: "modifiedTime desc",
  });
  return response.data.files ?? [];
}

export async function createGoogleDoc(
  accessToken: string,
  name: string,
  projectId: string,
  folderId?: string,
) {
  const drive = getDriveClient(accessToken);
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.document",
      ...(folderId ? { parents: [folderId] } : {}),
      appProperties: { PorcupineProjectId: projectId },
    },
    fields: "id, webViewLink",
  });
  return response.data;
}

export async function createGoogleSheet(
  accessToken: string,
  name: string,
  projectId: string,
  folderId?: string,
) {
  const drive = getDriveClient(accessToken);
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.spreadsheet",
      ...(folderId ? { parents: [folderId] } : {}),
      appProperties: { PorcupineProjectId: projectId },
    },
    fields: "id, webViewLink",
  });
  return response.data;
}

export async function createGoogleSlide(
  accessToken: string,
  name: string,
  projectId: string,
  folderId?: string,
) {
  const drive = getDriveClient(accessToken);
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.presentation",
      ...(folderId ? { parents: [folderId] } : {}),
      appProperties: { PorcupineProjectId: projectId },
    },
    fields: "id, webViewLink",
  });
  return response.data;
}

export async function shareGoogleFile(
  accessToken: string,
  fileId: string,
  emailAddress: string,
  role: "reader" | "commenter" | "writer",
) {
  const drive = getDriveClient(accessToken);
  const response = await drive.permissions.create({
    fileId,
    sendNotificationEmail: true,
    requestBody: {
      type: "user",
      role,
      emailAddress,
    },
  });
  return response.data;
}

export async function revokeGoogleFileAccess(
  accessToken: string,
  fileId: string,
  emailAddress: string,
) {
  const drive = getDriveClient(accessToken);
  const response = await drive.permissions.list({
    fileId,
    fields: "permissions(id, emailAddress)",
  });

  const permissions = response.data.permissions || [];
  console.log(
    `[revokeGoogleFileAccess] Found ${permissions.length} permissions for file ${fileId}`,
  );

  const targetPermission = permissions.find((p) => {
    console.log(
      `[revokeGoogleFileAccess] Checking permission id=${p.id} email=${p.emailAddress}`,
    );
    return p.emailAddress?.toLowerCase() === emailAddress.toLowerCase();
  });

  if (targetPermission?.id) {
    console.log(
      `[revokeGoogleFileAccess] Deleting permission id=${targetPermission.id} for email=${emailAddress}`,
    );
    await drive.permissions.delete({
      fileId,
      permissionId: targetPermission.id,
    });
    console.log(`[revokeGoogleFileAccess] Successfully deleted permission.`);
  } else {
    console.log(
      `[revokeGoogleFileAccess] Could not find permission for email=${emailAddress}`,
    );
  }
}

export async function createGoogleShortcut(
  accessToken: string,
  targetFileId: string,
  targetFolderId: string,
  name: string,
) {
  const drive = getDriveClient(accessToken);
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.shortcut",
      parents: [targetFolderId],
      shortcutDetails: {
        targetId: targetFileId,
      },
    },
    fields: "id",
  });
  return response.data;
}
