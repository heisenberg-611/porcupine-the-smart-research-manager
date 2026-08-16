import { google } from "googleapis";

export function getDriveClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth });
}

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
