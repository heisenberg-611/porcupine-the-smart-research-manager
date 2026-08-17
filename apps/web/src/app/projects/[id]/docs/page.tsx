import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getProject } from "@/lib/project";
import { createClient, getCurrentUser, getUserClaims } from "@/lib/supabase/server";
import { GoogleWorkspaceCard } from "../google-workspace-card";
import { FileList } from "./file-list";
import { registerGoogleAccount } from "../../actions";

export const metadata: Metadata = { title: "Collaboration Docs" };

export default async function CollaborationDocsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ provisionDrive?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const claims = await getUserClaims();
  if (!claims) redirect("/sign-in");

  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const cookieStore = await cookies();
  const providerToken = cookieStore.get("google_provider_token")?.value;

  // Verify membership to get role
  const memberData = await supabase
    .from("project_members")
    .select("access_role")
    .eq("project_id", id)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .single();

  const accessRole = memberData.data?.access_role;
  const canManage = accessRole === "OWNER" || accessRole === "ADMIN";

  const sp = await searchParams;
  let driveError: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let files: any[] = [];

  if (sp?.provisionDrive === "true" && project.drive_folder_id && providerToken) {
    // If returning from OAuth, ensure the account is registered with Google Drive BEFORE loading files
    const reg = await registerGoogleAccount(id);
    if (!reg.ok) {
      driveError = reg.error;
    }
  }

  if (project.drive_folder_id && providerToken && !driveError) {
    const { listProjectFiles } = await import("@/lib/google");
    try {
      // If the user is an Admin/Owner, they see everyone's files.
      // If they are a Collaborator, they only see files they created.
      const targetFolderId = canManage ? project.drive_folder_id : undefined;
      files = await listProjectFiles(providerToken, project.id, !canManage, targetFolderId);
    } catch (e: unknown) {
      console.error("Drive API error", e);
      if (e instanceof Error && e.message.includes("insufficient authentication scopes")) {
        driveError = "missing_scopes";
      } else {
        driveError = "Could not load files from Google Drive. Your session may have expired.";
      }
    }
  }

  const { checkGoogleConnection } = await import("../../actions");
  const connectionStatus = await checkGoogleConnection();

  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
      <PageHeader
        backHref={`/projects/${id}`}
        backLabel="Project overview"
        title="Collaboration Docs"
        description="Shared Google Docs and Sheets for this project."
      />

      <GoogleWorkspaceCard
        projectId={project.id}
        driveFolderId={project.drive_folder_id}
        canManage={canManage}
        hasToken={!!providerToken}
        connectionStatus={connectionStatus}
        userEmail={user.email ?? null}
        accessRole={accessRole ?? undefined}
      />

      {!project.drive_folder_id && !canManage && (
        <div className="mt-8 p-6 rounded-lg border border-border bg-surface text-center">
          <p className="text-muted text-ui">
            A central Google Drive folder has not been created for this project yet.
          </p>
          <p className="text-muted text-ui mt-2">
            Please ask the project owner or an admin to connect their Google Workspace account to set it up.
          </p>
        </div>
      )}

      {project.drive_folder_id && providerToken && !driveError && (
        <div className="space-y-6">
          {!canManage && (
            <div className="bg-accent-soft/50 border border-accent/20 rounded-xl p-5 flex gap-4 text-ui text-ink-soft">
              <svg className="w-6 h-6 text-accent shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-semibold text-ink mb-1 text-base">Personal Workspace</p>
                <p className="leading-relaxed">
                  For privacy and organization, this view only displays the documents that <strong>you have created</strong>.
                  To browse or access files created by other team members, simply click the <strong>Open Shared Drive Folder</strong> button above.
                </p>
              </div>
            </div>
          )}
          <FileList
            projectId={project.id}
            files={files}
            rootFolderId={project.drive_folder_id}
          />
        </div>
      )}

      {driveError && (
        <div className={`mt-8 p-6 rounded-xl flex flex-col md:flex-row gap-4 items-start md:items-center justify-between border ${driveError === "missing_scopes" ? "bg-warning-soft/20 border-warning/40" : "bg-danger-soft/20 border-danger/30"}`}>
          <div className="flex gap-3 items-start">
            {driveError === "missing_scopes" ? (
              <svg className="w-6 h-6 text-warning shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-danger shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <div>
              <p className={`font-semibold mb-1 text-base ${driveError === "missing_scopes" ? "text-warning-strong" : "text-danger"}`}>
                {driveError === "missing_scopes" ? "Action Required: Missing Google Drive Permissions" : "Google Workspace Connection Error"}
              </p>
              <p className={`text-sm leading-relaxed ${driveError === "missing_scopes" ? "text-warning-strong" : "text-danger-strong"}`}>
                {driveError === "missing_scopes" ? "Your Google account is connected, but it lacks permission to access Google Drive files. Please click the \"Reconnect with Drive permissions\" button in the card above, and ensure you check all boxes on the Google consent screen." : driveError}
              </p>
            </div>
          </div>
          {driveError !== "missing_scopes" && (
            <form action={async () => {
              "use server";
              const { disconnectGoogleAccount } = await import("../../actions");
              await disconnectGoogleAccount();
              const { revalidatePath } = await import("next/cache");
              revalidatePath(`/projects/${id}/docs`);
            }}>
              <button className="whitespace-nowrap px-4 py-2 bg-danger text-white text-sm font-medium rounded hover:bg-danger/90 transition-colors">
                Disconnect Account
              </button>
            </form>
          )}
        </div>
      )}

      {project.drive_folder_id && !providerToken && (
        <div className="mt-8 bg-surface border border-border rounded-xl p-6">
          <div className="flex gap-4">
            <svg className="w-6 h-6 text-accent shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-semibold text-ink mb-2 text-base">Action Required: Connect Google Workspace</p>
              <p className="text-ink-soft leading-relaxed mb-4">
                To access the shared documents for this project, you must connect your Google account using the button above.
              </p>
              {accessRole === "CONTRIBUTOR" && (
                <p className="text-muted text-ui bg-canvas p-3 rounded-lg border border-border">
                  <strong>As a Contributor</strong>, connecting your account will allow you to create new Docs, Sheets, and Slides directly in the shared folder, and collaborate on files created by your team.
                </p>
              )}
              {accessRole === "REVIEWER" && (
                <p className="text-muted text-ui bg-canvas p-3 rounded-lg border border-border">
                  <strong>As a Reviewer</strong>, connecting your account will grant you Commenter access. You will be able to review and leave feedback on the team's documents, but you will not be able to create or edit files.
                </p>
              )}
              {accessRole === "OBSERVER" && (
                <p className="text-muted text-ui bg-canvas p-3 rounded-lg border border-border">
                  <strong>As an Observer</strong>, connecting your account will grant you Read-Only access. You will be able to view all shared documents without accidentally making changes.
                </p>
              )}
              {canManage && (
                <p className="text-muted text-ui bg-canvas p-3 rounded-lg border border-border">
                  <strong>As an Admin/Owner</strong>, connecting your account will give you full access to manage and view all files in the shared directory.
                </p>
              )}
              <div className="mt-4 p-3 bg-danger-soft/30 border border-danger/20 rounded-lg flex gap-3 items-start">
                <svg className="w-5 h-5 text-danger shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-danger text-fine font-medium leading-relaxed">
                  <strong>CRITICAL:</strong> When prompted by Google, you MUST select the exact same Google account you use to log into Porcupine. If you select a different account, the connection will fail.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
