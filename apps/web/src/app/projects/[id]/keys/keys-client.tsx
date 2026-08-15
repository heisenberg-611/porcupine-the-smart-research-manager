"use client";

import {
  createProjectKey,
  fromBase64,
  toBase64,
  unwrapProjectKey,
  wrapProjectKeyFor,
} from "@porcupine/crypto";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Banner, Button, Card } from "@/components/ui";
import { useCryptoSession } from "@/lib/crypto/session";

import {
  getKeyState,
  getMemberKeys,
  provisionProjectKey,
  type MemberKey,
} from "./actions";

/**
 * Set up, hold and rotate this project's content key.
 *
 * The first screen in the product that does real cryptography with more than
 * one person's keys, and the first thing to write a `project_keys` row outside
 * a test.
 *
 * Everything here needs an unlocked identity, because sealing a key to a
 * member requires signing the wrap. Rather than prompting from under whatever
 * the user was doing, it links to `/unlock` with a `next` — a passphrase
 * prompt should never be something a page can raise by surprise.
 */
export function KeysClient({ projectId }: { projectId: string }) {
  const { identity, unlocked } = useCryptoSession();
  const pathname = usePathname();

  const [members, setMembers] = useState<MemberKey[] | null>(null);
  const [epoch, setEpoch] = useState<number>(0);
  const [nextEpoch, setNextEpoch] = useState<number>(1);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const [memberResult, state] = await Promise.all([
      getMemberKeys(projectId),
      getKeyState(projectId),
    ]);

    if (!memberResult.ok) {
      setError(memberResult.error);
      return;
    }
    setMembers(memberResult.data);

    if (state.ok) {
      setEpoch(state.data.currentEpoch);
      setNextEpoch(state.data.nextEpoch);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Mint an epoch and seal it to every member who can receive one.
   *
   * First provisioning and rotation are the same call, which is deliberate:
   * the only difference is the epoch number, and one code path means the
   * rotation case cannot be the one nobody exercised.
   */
  async function provision() {
    if (!identity || !members) return;
    setPending(true);
    setError(null);
    setStatus(null);

    try {
      const receivable = members.filter((m) => m.identityPubKey !== "");
      // Told by the server, not computed here — the number goes inside every
      // signature, so the two must agree exactly.
      const projectKey = await createProjectKey();

      const wraps = await Promise.all(
        receivable.map(async (member) => {
          const wrap = await wrapProjectKeyFor(
            projectKey,
            await fromBase64(member.identityPubKey),
            identity.signingPrivKey,
            { projectId, userId: member.userId, epoch: nextEpoch },
          );
          return {
            userId: member.userId,
            wrappedKey: await toBase64(wrap.wrappedKey),
            signature: await toBase64(wrap.signature),
          };
        }),
      );

      const result = await provisionProjectKey({ projectId, epoch: nextEpoch, wraps });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setStatus(
        `Epoch ${result.data.epoch} sealed to ${result.data.wraps} ${
          result.data.wraps === 1 ? "member" : "members"
        }.`,
      );
      await load();
    } catch {
      setError("Could not create the project key.");
    } finally {
      setPending(false);
    }
  }

  /** Open my own wrap, verifying who made it — the check the design rests on. */
  async function verifyMine() {
    if (!identity || !members) return;
    setPending(true);
    setError(null);
    setStatus(null);

    try {
      const me = members.find((m) => m.isMe);
      if (!me || me.identityPubKey === "") {
        setError("Your own keys are not on record yet.");
        return;
      }

      const state = await getKeyState(projectId);
      if (!state.ok) {
        setError(state.error);
        return;
      }

      const wrap = state.data.myWraps[0];
      if (!wrap) {
        setError("You hold no key for this project yet.");
        return;
      }

      const wrapper = members.find((m) => m.userId === wrap.wrappedBy);
      if (!wrapper || wrapper.signingPubKey === "") {
        setError("The member who wrapped this key has no signing key on record.");
        return;
      }

      // The context must be rebuilt exactly as it was signed. Getting any part
      // of it wrong reads as a forgery, which is the correct failure but a
      // confusing one — so it is assembled from the row and the session, never
      // from anything the user typed.
      const key = await unwrapProjectKey(
        {
          wrappedKey: await fromBase64(wrap.wrappedKey),
          signature: await fromBase64(wrap.signature),
        },
        { projectId, userId: me.userId, epoch: wrap.epoch },
        await fromBase64(wrapper.signingPubKey),
        await fromBase64(me.identityPubKey),
        identity.identityPrivKey,
      );

      setStatus(
        `Your epoch ${wrap.epoch} key opened, and its signature verifies against ${wrapper.displayName}. ${key.length * 8} bits.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open your key.");
    } finally {
      setPending(false);
    }
  }

  if (!unlocked) {
    return (
      <Card className="flex flex-col gap-3">
        <p className="text-ink text-ui">
          Your keys are locked. Sealing a project key to a member means signing it, which
          needs the identity only you can unlock.
        </p>
        <Link
          href={`/unlock?next=${encodeURIComponent(pathname ?? "/projects")}`}
          className="text-accent text-ui underline underline-offset-4"
        >
          Unlock your keys
        </Link>
      </Card>
    );
  }

  const receivable = members?.filter((m) => m.identityPubKey !== "").length ?? 0;
  const total = members?.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {error && <Banner tone="danger">{error}</Banner>}
      {status && <Banner>{status}</Banner>}

      <Card className="flex flex-col gap-2">
        <p className="text-ink text-ui">
          {epoch === 0
            ? "This project has no content key yet."
            : `Current epoch: ${epoch}.`}
        </p>
        <p className="text-muted text-fine">
          {receivable} of {total} {total === 1 ? "member" : "members"} can be given a key.
          {receivable < total &&
            " The rest have not finished setting up their keys, and are not silently skipped — they simply cannot receive one yet."}
        </p>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={provision} disabled={pending || receivable === 0}>
          {epoch === 0 ? "Create the project key" : "Rotate to a new epoch"}
        </Button>
        <Button variant="ghost" onClick={verifyMine} disabled={pending || epoch === 0}>
          Open and verify my key
        </Button>
      </div>

      <p className="text-muted text-fine">
        Rotating adds an epoch; it never edits one. Content written under an older epoch
        stays readable by whoever already held that key — rotation protects what comes
        next, and saying otherwise would be untrue.
      </p>
    </div>
  );
}
