"use client";

import { fromBase64, unwrapProjectKey } from "@porcupine/crypto";
import { useCallback, useEffect, useState } from "react";

import { getKeyState, getMemberKeys } from "@/app/projects/[id]/keys/actions";

import { useCryptoSession } from "./session";

/**
 * Every project key this member holds, by epoch.
 *
 * By epoch, not "the current one", and that is the whole reason this returns a
 * Map. Rotation does not re-encrypt history — the server holds no key and
 * could not — so a conversation spanning a rotation needs every key the member
 * was ever given. A hook that returned only the latest would silently render
 * older messages as unreadable, which looks exactly like corruption.
 *
 * Each wrap's signature is verified against the public signing key of the
 * member who made it, before the box is opened. That check is the reason a
 * `crypto_box_seal` — which anyone holding a public key can produce, the
 * server included — is trustworthy at all.
 *
 * A wrap that fails verification is DROPPED and counted rather than thrown:
 * one bad row should not make a whole conversation unreadable, and the count
 * is surfaced so it cannot pass unnoticed.
 */
export interface ProjectKeys {
  byEpoch: Map<number, Uint8Array>;
  currentEpoch: number;
  /** Wraps that did not verify. Anything above zero deserves attention. */
  rejected: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useProjectKeys(projectId: string): ProjectKeys {
  const { identity } = useCryptoSession();

  const [byEpoch, setByEpoch] = useState<Map<number, Uint8Array>>(new Map());
  const [currentEpoch, setCurrentEpoch] = useState(0);
  const [rejected, setRejected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setByEpoch(new Map());
      setCurrentEpoch(0);
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const [state, members] = await Promise.all([
          getKeyState(projectId),
          getMemberKeys(projectId),
        ]);

        if (!state.ok) {
          if (!cancelled) setError(state.error);
          return;
        }
        if (!members.ok) {
          if (!cancelled) setError(members.error);
          return;
        }

        const me = members.data.find((m) => m.isMe);
        if (!me || me.identityPubKey === "") {
          if (!cancelled) setError("Your own keys are not on record yet.");
          return;
        }

        const myPub = await fromBase64(me.identityPubKey);
        const opened = new Map<number, Uint8Array>();
        let bad = 0;

        for (const wrap of state.data.myWraps) {
          const wrapper = members.data.find((m) => m.userId === wrap.wrappedBy);
          if (!wrapper || wrapper.signingPubKey === "") {
            bad++;
            continue;
          }

          try {
            const key = await unwrapProjectKey(
              {
                wrappedKey: await fromBase64(wrap.wrappedKey),
                signature: await fromBase64(wrap.signature),
              },
              { projectId, userId: me.userId, epoch: wrap.epoch },
              await fromBase64(wrapper.signingPubKey),
              myPub,
              identity.identityPrivKey,
            );
            opened.set(wrap.epoch, key);
          } catch {
            bad++;
          }
        }

        if (!cancelled) {
          setByEpoch(opened);
          setCurrentEpoch(state.data.currentEpoch);
          setRejected(bad);
        }
      } catch {
        if (!cancelled) setError("Could not open your project keys.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity, projectId, nonce]);

  return { byEpoch, currentEpoch, rejected, loading, error, reload };
}
