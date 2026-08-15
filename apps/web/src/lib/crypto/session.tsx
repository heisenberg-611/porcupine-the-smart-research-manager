"use client";

import type { UnwrappedIdentity } from "@porcupine/crypto";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Where an unlocked identity lives.
 *
 * IN MEMORY, in one React tree, and nowhere else. Not `localStorage`, not
 * `sessionStorage`, not a cookie.
 *
 * That is a real cost and it is worth naming rather than discovering: a reload
 * loses the unlock, and so does opening the project in a second tab. Anything
 * that would fix that stores private keys somewhere a cross-site scripting bug
 * could read them, which would make the end-to-end claim considerably weaker
 * than the word "end-to-end" implies to the person reading it.
 *
 * The proper answer is device registration — a device key wraps the Master Key
 * so a later unlock uses WebAuthn rather than the passphrase. That is week 4,
 * and it is the reason week 1 put a Master Key in the middle of the hierarchy
 * at all. Until then, re-entering the passphrase is the honest interim.
 *
 * `identity` is deliberately not exposed through a getter that could be called
 * from anywhere: a component asks for it, and if it is absent the caller sends
 * the user to `/unlock`. There is no ambient "unlock if needed" side effect,
 * because a prompt for a passphrase should never be something a page can
 * trigger by accident.
 */

interface CryptoSession {
  identity: UnwrappedIdentity | null;
  unlocked: boolean;
  setIdentity: (identity: UnwrappedIdentity) => void;
  /** Forget it. Called on sign-out, and available for a "lock" control. */
  lock: () => void;
}

const Context = createContext<CryptoSession | null>(null);

export function CryptoSessionProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentityState] = useState<UnwrappedIdentity | null>(null);

  const setIdentity = useCallback((next: UnwrappedIdentity) => {
    setIdentityState(next);
  }, []);

  const lock = useCallback(() => {
    // Best effort: React state cannot be scrubbed the way a buffer can, and
    // pretending otherwise would be worse than saying so. Dropping the
    // reference is what is actually available in a browser.
    setIdentityState(null);
  }, []);

  const value = useMemo<CryptoSession>(
    () => ({ identity, unlocked: identity !== null, setIdentity, lock }),
    [identity, setIdentity, lock],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCryptoSession(): CryptoSession {
  const value = useContext(Context);
  if (!value) {
    throw new Error("useCryptoSession must be used inside CryptoSessionProvider");
  }
  return value;
}
