"use client";

import type { UnwrappedIdentity } from "@porcupine/crypto";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
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
  /** True while a remembered browser is being tried. */
  restoring: boolean;
  setIdentity: (identity: UnwrappedIdentity) => void;
  /** Forget it. Called on sign-out, and available for a "lock" control. */
  lock: () => void;
}

const Context = createContext<CryptoSession | null>(null);

export function CryptoSessionProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentityState] = useState<UnwrappedIdentity | null>(null);
  const [restoring, setRestoring] = useState(true);

  /*
   * A remembered browser unlocks itself, HERE, in the shell.
   *
   * This lived in the unlock form first, which meant it only ran on /unlock —
   * so a remembered browser opening a project link directly was still locked,
   * and the feature appeared not to work at all. Being remembered has to hold
   * everywhere or it holds nowhere.
   *
   * Silent on failure, deliberately. A browser that was never registered, or
   * whose device row has been revoked, should simply arrive locked; turning
   * either into an error would be alarming about the ordinary case.
   *
   * Everything it needs is loaded with `import()` INSIDE the effect, and that
   * is not a style choice. This provider wraps the root layout, so a static
   * import would put libsodium in the first-load bundle of every page in the
   * product — a WASM crypto library shipped to people reading a paper list.
   * It was measurable and it was strange: the main thread stayed busy long
   * enough after streaming that React's hidden `<div hidden id="S:0">` slot —
   * where streamed content lands before an inline script relocates it — was
   * still in the DOM, so pages briefly contained two copies of themselves.
   * Seven tests across the suite caught it as duplicated elements.
   *
   * For the same reason the marker below is read inline rather than imported
   * from `./device`: this module wraps every page, and it should pull in
   * nothing at runtime but React. The marker's meaning lives in device.ts.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Synchronous, and false for anyone who has never registered — which
        // is almost everyone, almost always. Everything past this point is
        // loaded on demand, so the common path costs one `localStorage` read.
        if (localStorage.getItem("porcupine.device") !== "1") {
          setRestoring(false);
          return;
        }

        const [{ fromBase64, toBase64, unwrapIdentityWithMasterKey }, device, wrap] =
          await Promise.all([
            import("@porcupine/crypto"),
            import("./device"),
            import("@/app/unlock/device-actions"),
          ]);
        const { getMyKeyMaterial } = await import("@/app/unlock/actions");

        const deviceKey = await device.getOrCreateDeviceKey();
        const stored = await wrap.getDeviceWrap(
          await toBase64(await device.exportDevicePublicKey(deviceKey)),
        );
        if (!stored.ok || !stored.data) return;

        const masterKey = await device.unwrapMasterKeyFromDevice(
          await fromBase64(stored.data.wrappedMasterKey),
          deviceKey,
        );

        const material = await getMyKeyMaterial();
        if (!material.ok || !material.data) return;

        const opened = await unwrapIdentityWithMasterKey(
          await fromBase64(material.data.wrappedBundle),
          masterKey,
        );

        if (!cancelled) setIdentityState(opened);
      } catch {
        // Locked is the correct outcome for every failure here.
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
    () => ({ identity, unlocked: identity !== null, restoring, setIdentity, lock }),
    [identity, restoring, setIdentity, lock],
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
