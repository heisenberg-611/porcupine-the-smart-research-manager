"use client";

import {
  createProjectKey,
  fromBase64,
  keyFingerprint,
  toBase64,
  unwrapProjectKey,
  wrapProjectKeyFor,
} from "@Porcupine/crypto";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Banner, Button, Card } from "@/components/ui";
import { useCryptoSession } from "@/lib/crypto/session";
import { useProjectKeys } from "@/lib/crypto/use-project-keys";

import {
  getKeyState,
  getMemberKeys,
  provisionProjectKey,
  removeMember,
  shareProjectKey,
  type KeylessMember,
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

  // Every key this browser can open, so an existing one can be handed on
  // rather than a new one minted.
  const keys = useProjectKeys(projectId);
  const [keyless, setKeyless] = useState<KeylessMember[]>([]);
  const [members, setMembers] = useState<MemberKey[] | null>(null);
  const [epoch, setEpoch] = useState<number>(0);
  const [status, setStatus] = useState<string | null>(null);
  const [rotationNeeded, setRotationNeeded] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * Which action is running, not merely that one is.
   *
   * These buttons share a single flag, and as a disabled-only flag a boolean
   * was enough: they all grey out together, which reads correctly. A busy
   * LABEL is a claim about one specific action, so the boolean would have
   * "Open and verify my key" announce that it was working because somebody
   * pressed Rotate. The name is what makes the claim true.
   */
  const [running, setRunning] = useState<
    null | "provision" | "remove" | "verify" | `share:${string}`
  >(null);
  const pending = running !== null;
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});

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
      setRotationNeeded(state.data.rotationNeeded);
      setKeyless(state.data.keyless);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Safety numbers for everyone in the project.
   *
   * `keyFingerprint` has existed since Phase 0 and was displayed NOWHERE,
   * which made it decoration. It is the only defence against a server that
   * hands you a public key of its own choosing: every wrap this project makes
   * is sealed to keys the server served, and a swapped key is undetectable
   * from inside the app. Two people reading these aloud — on a call, in a
   * corridor — is what detects it, and that is only possible if the number is
   * on the screen.
   *
   * Computed from the same bytes the wraps are sealed to, deliberately: a
   * fingerprint derived from anything else would verify the wrong thing.
   */
  useEffect(() => {
    if (!members) return;
    let cancelled = false;

    void (async () => {
      const next: Record<string, string> = {};
      for (const member of members) {
        if (member.identityPubKey === "") continue;
        next[member.userId] = await keyFingerprint(
          await fromBase64(member.identityPubKey),
        );
      }
      if (!cancelled) setFingerprints(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [members]);

  /**
   * Mint an epoch and seal it to every member who can receive one.
   *
   * First provisioning and rotation are the same call, which is deliberate:
   * the only difference is the epoch number, and one code path means the
   * rotation case cannot be the one nobody exercised.
   */
  async function provision() {
    setRunning("provision");
    setError(null);
    setStatus(null);
    // `rotate` sets the status it wants shown. An earlier version cleared it
    // again right here on success, which wiped the only confirmation the user
    // — and the test — had that anything happened.
    await rotate();
    setRunning(null);
  }

  /** Mint the next epoch and seal it to everyone who can hold one. */
  async function rotate(): Promise<boolean> {
    if (!identity) return false;

    // Read the roster fresh rather than trusting component state: after a
    // removal the stale list still contains the person who just left, and
    // sealing the new key to them would undo the removal entirely.
    const current = await getMemberKeys(projectId);
    const state = await getKeyState(projectId);
    if (!current.ok || !state.ok) {
      setError(current.ok ? "Could not read the key state." : current.error);
      return false;
    }

    try {
      const receivable = current.data.filter(
        (m) => m.identityPubKey !== "" && !m.isRemoved,
      );
      // Told by the server, not computed here — the number goes inside every
      // signature, so the two must agree exactly.
      const epochToWrite = state.data.nextEpoch;
      const projectKey = await createProjectKey();

      const wraps = await Promise.all(
        receivable.map(async (member) => {
          const wrap = await wrapProjectKeyFor(
            projectKey,
            await fromBase64(member.identityPubKey),
            identity.signingPrivKey,
            { projectId, userId: member.userId, epoch: epochToWrite },
          );
          return {
            userId: member.userId,
            wrappedKey: await toBase64(wrap.wrappedKey),
            signature: await toBase64(wrap.signature),
          };
        }),
      );

      const result = await provisionProjectKey({
        projectId,
        epoch: epochToWrite,
        wraps,
      });
      if (!result.ok) {
        setError(result.error);
        return false;
      }

      setStatus(
        `Epoch ${result.data.epoch} sealed to ${result.data.wraps} ${
          result.data.wraps === 1 ? "member" : "members"
        }.`,
      );
      await load();
      return true;
    } catch {
      setError("Could not create the project key.");
      return false;
    }
  }

  /**
   * Hand an existing key to a member who does not hold it.
   *
   * The counterpart to rotation, and the operation the product was missing.
   * Rotation is for DEPARTURE — a former member must not read what comes next.
   * Arrival is the opposite: nothing needs to be kept from the newcomer, and
   * minting a new key to admit them throws away everyone's history and splits
   * the project between people holding different epochs.
   *
   * So this seals the keys ALREADY HELD to the newcomer's public key. How many
   * of them is `history_access`, which the schema has carried since Phase 0
   * and nothing consulted until now.
   */
  async function share(userId: string, name: string) {
    if (!identity) {
      setStatus("Unlock first — the key is sealed to you, not to the server.");
      return;
    }

    setRunning(`share:${userId}`);
    setStatus(null);

    try {
      const [membersNow, stateNow] = await Promise.all([
        getMemberKeys(projectId),
        getKeyState(projectId),
      ]);
      if (!membersNow.ok || !stateNow.ok) {
        setStatus("Could not read the key state.");
        return;
      }

      const target = membersNow.data.find((m) => m.userId === userId);
      if (!target || target.identityPubKey === "") {
        setStatus(`${name} has not finished setting up their keys yet.`);
        return;
      }

      const keyless = stateNow.data.keyless.find((k) => k.userId === userId);
      const fromJoinOnly = keyless?.historyAccess === "FROM_JOIN";
      const targetPub = await fromBase64(target.identityPubKey);

      // Only epochs this browser can actually open, which is the same set the
      // server will accept.
      const epochs = [...keys.byEpoch.keys()]
        .filter((epoch) => !fromJoinOnly || epoch === stateNow.data.currentEpoch)
        .sort((a, b) => a - b);

      if (epochs.length === 0) {
        setStatus("You do not hold a key to share.");
        return;
      }

      const wraps = await Promise.all(
        epochs.map(async (epoch) => {
          const wrap = await wrapProjectKeyFor(
            keys.byEpoch.get(epoch)!,
            targetPub,
            identity.signingPrivKey,
            { projectId, userId, epoch },
          );
          return {
            epoch,
            wrappedKey: await toBase64(wrap.wrappedKey),
            signature: await toBase64(wrap.signature),
          };
        }),
      );

      const result = await shareProjectKey({ projectId, userId, wraps });
      if (!result.ok) {
        setStatus(result.error);
        return;
      }

      setStatus(
        `${name} now holds the key${
          fromJoinOnly
            ? " for the current epoch — they joined with access from their join date."
            : `, for ${result.data.epochs === 1 ? "1 epoch" : `${result.data.epochs} epochs`}.`
        }`,
      );
      await load();
    } catch {
      setStatus("Could not share the key.");
    } finally {
      setRunning(null);
    }
  }

  /**
   * Remove a member, then immediately rotate.
   *
   * One button, because they are one operation. A removal that does not rotate
   * leaves the departed member holding a key that opens everything written
   * afterwards, which is the opposite of what anyone means by removing them.
   *
   * The order is not interchangeable. Removing first means the new epoch is
   * sealed only to who remains; rotating first would hand the new key to the
   * person being removed, since they are still a member at that moment.
   *
   * If the rotation half fails, the removal stands and `rotationNeeded` starts
   * reporting it. That is the honest failure: the member IS gone, and the key
   * they still hold is a fact the screen now states.
   */
  async function removeAndRotate(userId: string, name: string) {
    setRunning("remove");
    setError(null);
    setStatus(null);
    setConfirming(null);

    try {
      const removed = await removeMember({ projectId, userId });
      if (!removed.ok) {
        setError(removed.error);
        return;
      }

      await load();
      const rotated = await rotate();
      setStatus(
        rotated
          ? `${name} was removed and the key rotated. They cannot read anything written from now on.`
          : `${name} was removed, but the key was NOT rotated — they can still read new messages until it is.`,
      );
    } finally {
      setRunning(null);
    }
  }

  /** Open my own wrap, verifying who made it — the check the design rests on. */
  async function verifyMine() {
    if (!identity || !members) return;
    setRunning("verify");
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
      setRunning(null);
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

  const activeMembers = members?.filter((m) => !m.isRemoved) ?? [];
  const receivable = activeMembers.filter((m) => m.identityPubKey !== "").length;
  const total = activeMembers.length;

  return (
    <div className="flex flex-col gap-4">
      {error && <Banner tone="danger">{error}</Banner>}
      {status && <Banner>{status}</Banner>}

      {rotationNeeded && (
        // The window, named. Rotation happens in a browser — the server holds
        // no key and cannot do it — so between a removal and the next unlocked
        // admin there is a period where a former member can still read new
        // content. Saying so is the only honest option.
        <Banner tone="danger">
          Someone was removed from this project after the current key was made, so they
          can still read anything written since. Rotate to stop that.
        </Banner>
      )}

      <Card className="flex flex-col gap-2">
        <p className="text-ink text-ui">
          {epoch === 0
            ? "This project has no content key yet."
            : `Current epoch: ${epoch}.`}
        </p>
        {epoch > 0 && (
          <p className="text-muted text-fine mt-1">
            Rotating the key generates a new cryptographic epoch and seals it only to
            current members. This ensures that anyone who was removed or compromised loses
            access to all new messages going forward.
          </p>
        )}
        <p className="text-muted text-fine">
          {receivable} of {total} {total === 1 ? "member" : "members"} can be given a key.
          {receivable < total &&
            " The rest have not finished setting up their keys, and are not silently skipped — they simply cannot receive one yet."}
        </p>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={provision}
          disabled={pending || receivable === 0}
          busy={running === "provision"}
          busyLabel={epoch === 0 ? "Creating the project key…" : "Rotating…"}
        >
          {epoch === 0 ? "Create the project key" : "Rotate to a new epoch"}
        </Button>
        <Button
          variant="ghost"
          onClick={verifyMine}
          disabled={pending || epoch === 0}
          busy={running === "verify"}
          busyLabel="Opening…"
        >
          Open and verify my key
        </Button>
      </div>

      <section aria-labelledby="holders">
        <h2 id="holders" className="text-ink text-heading mb-2 font-medium">
          Who holds a key
        </h2>
        <ul className="divide-border bg-surface/50 ring-border divide-y rounded-xl shadow-sm ring-1">
          {(members ?? [])
            .filter((m) => !m.isRemoved)
            .map((member) => {
              const me = (members ?? []).find((m) => m.isMe);
              const canRemove =
                me && (me.accessRole === "OWNER" || me.accessRole === "ADMIN");

              return (
                <li
                  key={member.userId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <span className="text-ink text-ui">
                    {member.displayName}
                    {member.isMe && <span className="text-muted"> — you</span>}
                    {member.identityPubKey === "" ? (
                      <span className="text-muted text-fine block">
                        Has not set up keys yet, so cannot be given one.
                      </span>
                    ) : (
                      <span className="text-muted text-fine block font-mono">
                        {fingerprints[member.userId] ?? "…"}
                      </span>
                    )}
                  </span>

                  {/*
                    The repair, offered where the problem is visible.
                    A member who holds no wrap cannot read a word of the
                    conversation, and until now the only thing anyone could do
                    about it was rotate the project — which fixed their access
                    by breaking everybody's history.
                  */}
                  {!member.isMe &&
                    keyless.some((k) => k.userId === member.userId) &&
                    member.identityPubKey !== "" && (
                      <Button
                        disabled={pending || keys.byEpoch.size === 0}
                        busy={running === `share:${member.userId}`}
                        busyLabel="Sharing…"
                        onClick={() => void share(member.userId, member.displayName)}
                      >
                        Give {member.displayName} the key
                      </Button>
                    )}

                  {!member.isMe &&
                    canRemove &&
                    (confirming === member.userId ? (
                      <div className="flex flex-col items-end gap-2">
                        <p className="text-muted text-fine max-w-xs text-right">
                          This will permanently remove {member.displayName} from the
                          project and immediately rotate the project key. They will lose
                          access to the project and all future messages, but will keep
                          access to past messages they already have keys for.
                        </p>
                        <span className="flex flex-wrap gap-2">
                          <Button
                            variant="danger"
                            disabled={pending}
                            busy={running === "remove"}
                            busyLabel="Removing and rotating…"
                            onClick={() =>
                              void removeAndRotate(member.userId, member.displayName)
                            }
                          >
                            Yes, remove and rotate
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirming(null)}>
                            Cancel
                          </Button>
                        </span>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        disabled={pending}
                        onClick={() => setConfirming(member.userId)}
                      >
                        Remove
                      </Button>
                    ))}
                </li>
              );
            })}
        </ul>
        <p className="text-muted text-fine mt-2">
          {/* What the number under each name is FOR. A safety number nobody is
              told to compare is a string of characters. */}
          The line under each name is that person&rsquo;s safety number. Read it to them
          out loud, on a call or in person — if it matches what they see under their own
          name, nobody has swapped their key. Every key this project seals is sealed to
          keys the server handed us, so this is the only check that does not depend on
          trusting it.
        </p>
        <p className="text-muted text-fine mt-2">
          {/* Two steps, said as one thing, because they are one thing. */}
          Removing someone rotates the key in the same action: they lose access to
          anything written afterwards, and keep what they could already read. Rotation
          cannot reach backwards — the messages they have seen are on their machine, and
          no key change recalls them.
        </p>
      </section>

      <p className="text-muted text-fine">
        Rotating adds an epoch; it never edits one. Content written under an older epoch
        stays readable by whoever already held that key — rotation protects what comes
        next, and saying otherwise would be untrue.
      </p>
    </div>
  );
}
