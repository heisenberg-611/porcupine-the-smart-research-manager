import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import {
  exportValue,
  fetchEvidenceRows,
  parseEvidenceQuery,
  visibleFields,
  type EvidenceRow,
} from "@/lib/evidence";
import { getSheetsClient } from "@/lib/google";
import { must } from "@/lib/supabase/query";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

const EXPORT_LIMIT = 5000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first", { status: 401 });

  const { id } = await params;
  const formData = await request.formData();
  const search = formData.get("search") as string;
  const queryObj = Object.fromEntries(new URLSearchParams(search));

  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const providerToken = session?.provider_token;

  if (!providerToken) {
    return new Response(
      "Google Workspace not linked. Sign in with Google to export to Sheets.",
      { status: 403 },
    );
  }

  const project = await must(
    supabase
      .from("projects")
      .select("id, title, drive_folder_id")
      .eq("id", id)
      .maybeSingle(),
    "the project",
  );
  if (!project) return new Response("Project not found", { status: 404 });

  const protocol = await must(
    supabase
      .from("protocols")
      .select("id, name, version, protocol_fields(key, label, order)")
      .eq("project_id", id)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
    "the protocol",
  );

  if (!protocol)
    return new Response("This project has no active protocol", { status: 404 });

  const allFields = [
    ...((
      protocol as unknown as {
        protocol_fields: { key: string; label: string; order: number }[];
      }
    ).protocol_fields ?? []),
  ].sort((a, b) => a.order - b.order);

  const query = parseEvidenceQuery(queryObj);
  const fields = visibleFields(allFields, query);
  const rows = await fetchEvidenceRows(id, protocol.id, query, EXPORT_LIMIT);

  const header = [
    "Title",
    "Year",
    "Status",
    "Answered",
    "Total Fields",
    ...fields.map((f) => f.label),
  ];

  const cellsFor = (row: EvidenceRow): (string | number | null)[] => [
    row.work_title,
    row.published_year,
    row.status,
    row.answered,
    row.field_total,
    ...fields.map((f) => exportValue(row.cells?.[f.key])),
  ];

  const sheetData = [header, ...rows.map(cellsFor)].map((row) =>
    row.map((cell) => (cell === null ? "" : String(cell))),
  );

  try {
    const sheets = getSheetsClient(providerToken);

    // Create new spreadsheet
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `Evidence: ${project.title}`,
        },
      },
    });

    const spreadsheetId = spreadsheet.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error("Failed to create spreadsheet");
    }

    // Update values
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Sheet1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: sheetData,
      },
    });

    // Attempt to move it into the project folder, if one exists and we have drive scope
    if (project.drive_folder_id) {
      try {
        const { getDriveClient } = await import("@/lib/google");
        const drive = getDriveClient(providerToken);
        const file = await drive.files.get({
          fileId: spreadsheetId,
          fields: "parents",
        });

        const previousParents = file.data.parents?.join(",") || "";
        await drive.files.update({
          fileId: spreadsheetId,
          addParents: project.drive_folder_id,
          removeParents: previousParents,
          fields: "id, parents",
        });
      } catch (driveErr) {
        console.warn("Could not move sheet to project folder", driveErr);
      }
    }

    // Redirect to the new sheet
    return redirect(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  } catch (error) {
    console.error("Sheets export error:", error);
    return new Response("Failed to export to Google Sheets", { status: 500 });
  }
}
