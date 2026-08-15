"use client";

import {
  createProjectKey,
  fromBase64,
  toBase64,
  wrapProjectKeyFor,
} from "@porcupine/crypto";
import { useState } from "react";

import {
  getKeyState,
  getMemberKeys,
  provisionProjectKey,
} from "@/app/projects/[id]/keys/actions";
import { createChannel } from "@/app/projects/[id]/messages/actions";
import { Banner, Button } from "@/components/ui";
import { useCryptoSession } from "@/lib/crypto/session";

/**
 * Mint this project's first content key, from wherever you happened to need it.
 *
 * The same call the keys screen makes, deliberately: one code path, so the
 * version nobody exercises cannot drift. What changes is where it can be
 * reached from — a project's first key used to require finding a screen called
 * "Encryption", which is named after the mechanism rather than the thing you
 * were trying to do.
 *
 * The wraps are built HERE, in the browser, because sealing a key to a member
 * means signing it with an identity the server has never held.
 */
export function SetUpEncryption({
  projectId,
  onReady,
}: {
  projectId: string;
  onReady: () => void;
}) {
  const { identity } = useCryptoSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setUp() {
    if (!identity) return;
    setPending(true);
    setError(null);

    try {
      const [members, state] = await Promise.all([
        getMemberKeys(projectId),
        getKeyState(projectId),
      ]);

      if (!members.ok || !state.ok) {
        setError(members.ok ? "Could not read the key state." : members.error);
        return;
      }

      // Members who have not finished enrolling have no public key to seal to.
      // They are skipped and counted rather than silently dropped.
      const receivable = members.data.filter((m) => m.identityPubKey !== "");
      if (receivable.length === 0) {
        setError("Nobody in this project has finished setting up their keys yet.");
        return;
      }

      // The epoch comes from the server, not from here: it goes inside every
      // signature, so the two must agree exactly.
      const epoch = state.data.nextEpoch;
      const projectKey = await createProjectKey();

      const wraps = await Promise.all(
        receivable.map(async (member) => {
          const wrap = await wrapProjectKeyFor(
            projectKey,
            await fromBase64(member.identityPubKey),
            identity.signingPrivKey,
            { projectId, userId: member.userId, epoch },
          );
          return {
            userId: member.userId,
            wrappedKey: await toBase64(wrap.wrappedKey),
            signature: await toBase64(wrap.signature),
          };
        }),
      );

      const result = await provisionProjectKey({ projectId, epoch, wraps });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (epoch === 1) {
        try {
          const { sealMessage } = await import("@porcupine/crypto");
          const channelId = crypto.randomUUID();
          const nameCt = await sealMessage("general", projectKey, {
            channelId,
            messageId: channelId,
            epoch: 1,
          });
          await createChannel({
            projectId,
            channelId,
            nameCt: await toBase64(nameCt),
            epoch: 1,
          });
        } catch (e) {
          // If channel creation fails, the key is still validly created.
          console.error("Failed to auto-create general channel", e);
        }
      }

      onReady();
    } catch {
      setError("Could not create the project key.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Banner tone="danger">{error}</Banner>}
      <Button variant="primary" disabled={pending} onClick={setUp}>
        {pending ? "Setting up…" : "Set up encryption for this project"}
      </Button>
    </div>
  );
}
