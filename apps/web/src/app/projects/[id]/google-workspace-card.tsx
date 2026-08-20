"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { provisionSharedDriveFolder, disconnectGoogleAccount } from "../actions";

export function GoogleWorkspaceCard({
  projectId,
  driveFolderId,
  canManage,
  hasToken,
  connectionStatus,
  userEmail,
  accessRole,
}: {
  projectId: string;
  driveFolderId: string | null;
  canManage: boolean;
  hasToken: boolean;
  connectionStatus: { connected: boolean; scopes: string[] };
  userEmail?: string | null;
  accessRole?: string;
}) {
  // Connecting and disconnecting share this flag, and the confirmation panel
  // can be on screen at the same time as the connect buttons — so the label
  // has to be tied to the action, not merely to "something is happening".
  const [running, setRunning] = useState<null | "connect" | "disconnect">(null);
  const pending = running !== null;
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  // If we just returned from OAuth, automatically attempt to provision the folder or register the account
  useEffect(() => {
    if (searchParams.get("provisionDrive") === "true") {
      router.replace(`/projects/${projectId}/docs`);

      if (!driveFolderId && canManage) {
        connectAndCreate();
      }
    }
  }, [searchParams, canManage, driveFolderId, projectId, router]);

  async function connectAndCreate() {
    setRunning("connect");
    setError(null);
    const supabase = createClient();

    if (!hasToken || !hasFullAccess) {
      // Check if the current user ALREADY has a Google identity linked
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const hasGoogleIdentity = user?.identities?.some((id) => id.provider === "google");

      const scopes = "https://www.googleapis.com/auth/drive.file email profile";

      const queryParams: Record<string, string> = {
        access_type: "offline",
        prompt: "consent",
      };
      if (userEmail) queryParams.login_hint = userEmail;

      if (hasGoogleIdentity) {
        // They already linked their account, but the token is missing/expired/lacks scopes.
        // We must run the OAuth flow to refresh the token with the correct scopes.
        await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback?next=/projects/${projectId}/docs?provisionDrive=true`,
            queryParams,
            scopes,
          },
        });
        return; // Browser redirects
      }

      // If they don't have a Google identity linked yet, we try to link it.
      const { error: linkError } = await supabase.auth.linkIdentity({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/projects/${projectId}/docs?provisionDrive=true`,
          queryParams,
          scopes,
        },
      });

      if (linkError) {
        if (
          linkError.message.includes("already linked") ||
          linkError.message.includes("Identity is already linked")
        ) {
          setError(
            "This Google account is already connected to another Porcupine account. Please use a different Google account or log in with that account.",
          );
        } else {
          setError(linkError.message);
        }
        setRunning(null);
      }
      return; // Browser redirects if successful
    }

    // If we have the token, create the shared drive folder via server action
    // But only if we have permissions and there is no folder yet
    if (canManage && !driveFolderId) {
      const res = await provisionSharedDriveFolder(projectId);
      if (!res.ok) {
        setError(res.error);
      }
    }
    setRunning(null);
  }

  async function handleDisconnect() {
    setRunning("disconnect");
    await disconnectGoogleAccount();
    router.refresh();
    setRunning(null);
    setShowConfirm(false);
  }

  const hasFullAccess = connectionStatus.scopes.some(
    (s) => s.includes("drive.file") || s.includes("drive"),
  );

  const renderConfirmation = () => {
    if (!showConfirm) return null;
    return (
      <div className="border-danger/30 bg-danger-soft/30 animate-in fade-in slide-in-from-top-2 mt-4 flex flex-col gap-3 rounded-lg border p-4 duration-200">
        <h4 className="text-danger flex items-center gap-2 font-medium">
          <svg
            className="h-5 w-5 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          Are you sure you want to disconnect?
        </h4>

        <div className="text-danger/80 text-fine ml-7 space-y-2">
          {accessRole === "OWNER" || accessRole === "ADMIN" ? (
            <p>
              As an Admin/Owner, disconnecting will disable automated Google Drive sharing
              for this project. Other members will no longer be automatically added to the
              shared folder. <br />
              <br />
              Because you are the folder owner, you will retain native access to the
              folder in Google Drive.
            </p>
          ) : (
            <p>
              Disconnecting will immediately revoke your access to the project's shared
              Google Drive folder and all files within it. <br />
              <br />
              You will only retain access to individual files that you explicitly created.
            </p>
          )}
        </div>

        <div className="mt-2 ml-7 flex gap-2">
          <Button
            type="button"
            onClick={handleDisconnect}
            className="bg-danger hover:bg-danger/90 min-h-9 px-4 text-sm font-medium text-white shadow-none hover:brightness-100"
            busy={running === "disconnect"}
            busyLabel="Disconnecting…"
          >
            Yes, Disconnect
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowConfirm(false)}
            disabled={pending}
            className="min-h-9 px-4 text-sm"
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  };

  if (driveFolderId) {
    return (
      <Card className="border-border mt-8 flex flex-col gap-2 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-ink text-heading font-medium">Google Workspace</h3>
            <p className="text-muted text-ui">
              This project has a central Google Drive folder. Data exported to Sheets will
              be saved here.
            </p>
            {hasToken && (
              <p className="text-muted text-fine mt-2">
                Status: <span className="text-accent font-medium">Connected</span>
                {!hasFullAccess && " (Missing Google Drive permissions)"}
              </p>
            )}
            {error && <p className="text-danger text-ui mt-2">{error}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {hasToken && !showConfirm ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowConfirm(true)}
                disabled={pending}
                className="text-danger hover:text-danger hover:bg-danger/10 h-auto px-2 py-1 text-sm"
              >
                Disconnect Account
              </Button>
            ) : null}
          </div>
        </div>

        {renderConfirmation()}

        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            onClick={() =>
              window.open(
                `https://drive.google.com/drive/folders/${driveFolderId}`,
                "_blank",
              )
            }
          >
            Open Shared Drive Folder
          </Button>
          {!hasToken && (
            <Button
              type="button"
              variant="ghost"
              onClick={connectAndCreate}
              disabled={pending}
              busy={running === "connect"}
              busyLabel="Connecting…"
            >
              Connect your Google Account
            </Button>
          )}
          {hasToken && !hasFullAccess && (
            <Button
              type="button"
              variant="ghost"
              onClick={connectAndCreate}
              disabled={pending}
              busy={running === "connect"}
              busyLabel="Connecting…"
              className="ring-warning text-warning hover:bg-warning/10 ring-1"
            >
              Reconnect with Drive permissions
            </Button>
          )}
        </div>
      </Card>
    );
  }

  if (!canManage) {
    return null; // Only owners/admins can see the setup prompt
  }

  return (
    <Card className="border-accent mt-8 flex flex-col gap-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-ink text-heading font-medium">Connect Google Workspace</h3>
          <p className="text-muted text-ui">
            Connect your Google account to create a central Google Drive folder for this
            project, for the documents your team writes alongside the review.
          </p>
          {hasToken && (
            <p className="text-muted text-fine mt-2">
              Status: <span className="text-accent font-medium">Connected</span>
              {!hasFullAccess && " (Missing Google Drive permissions)"}
            </p>
          )}
          {error && <p className="text-danger text-ui mt-2">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {hasToken && !showConfirm ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowConfirm(true)}
              disabled={pending}
              className="text-danger hover:text-danger hover:bg-danger/10 h-auto px-2 py-1 text-sm"
            >
              Disconnect Account
            </Button>
          ) : null}
        </div>
      </div>

      {renderConfirmation()}

      <div className="mt-3">
        <Button
          type="button"
          onClick={connectAndCreate}
          busy={running === "connect"}
          busyLabel="Connecting…"
        >
          {hasToken && !hasFullAccess
            ? "Reconnect & Create Folder"
            : "Connect & Create Folder"}
        </Button>
      </div>
    </Card>
  );
}
