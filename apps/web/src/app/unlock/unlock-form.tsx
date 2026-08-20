"use client";

import { fromBase64, rewrapIdentity, toBase64, unwrapIdentity } from "@Porcupine/crypto";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { Banner, Button, Checkbox, Field, Input } from "@/components/ui";
import {
  exportDevicePublicKey,
  getOrCreateDeviceKey,
  markRegistered,
  wrapMasterKeyForDevice,
} from "@/lib/crypto/device";
import { useCryptoSession } from "@/lib/crypto/session";

import { getMyKeyMaterial, storeRewrappedBundle } from "./actions";
import { registerDevice } from "./device-actions";

/**
 * Turn the recovery passphrase into keys, in this browser.
 *
 * Two things happen here that are easy to miss:
 *
 * 1. A v1 bundle is UPGRADED. `unwrapIdentity` mints a Master Key for a v1
 *    bundle and says `needsRewrap`; this is the only place that acts on it.
 *    Week 1 wrote that path with nothing calling it, which is exactly how a
 *    migration quietly stops working.
 *
 * 2. The failure is not "wrong password". The AEAD tag failing is the only
 *    signal the server could not have forged, so it is reported as what it is.
 */
export function UnlockForm({ next }: { next: string }) {
  const router = useRouter();
  const { setIdentity, restoring } = useCryptoSession();

  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);

  /*
   * The device attempt lives in `CryptoSessionProvider`, not here.
   *
   * It was here first, and that made "remember this browser" look broken:
   * opening a project link directly never rendered this form, so nothing tried
   * the device and the page arrived locked. Being remembered has to hold
   * everywhere or it holds nowhere.
   */

  async function unlock(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNote(null);

    try {
      const material = await getMyKeyMaterial();
      if (!material.ok) {
        setError(material.error);
        return;
      }
      if (!material.data) {
        setError("This account has no identity keys yet.");
        return;
      }

      const wrapped = await fromBase64(material.data.wrappedBundle);
      const salt = await fromBase64(material.data.kdfSalt);

      // Argon2id, on the main thread. One call, behind a disabled button — the
      // Web Worker move is still owed and is noted in the crypto package.
      const identity = await unwrapIdentity(wrapped, salt, passphrase.trim());

      if (identity.needsRewrap) {
        const upgraded = await rewrapIdentity(identity, salt, passphrase.trim());
        const stored = await storeRewrappedBundle({
          wrappedBundle: await toBase64(upgraded),
        });
        // A failed upgrade must not block the unlock: the keys in hand are
        // correct either way, and refusing entry over a housekeeping write
        // would turn a background migration into an outage.
        setNote(
          stored.ok
            ? "Your key bundle was upgraded to the current format."
            : "Unlocked. The key bundle upgrade did not save and will be retried.",
        );
      }

      if (remember) {
        // Registering AFTER a successful unlock, never before: the master key
        // has to exist in hand to be sealed to anything.
        try {
          const device = await getOrCreateDeviceKey();
          const wrapped = await wrapMasterKeyForDevice(identity.masterKey, device);
          const registered = await registerDevice({
            label: deviceLabel(),
            devicePubKey: await toBase64(await exportDevicePublicKey(device)),
            wrappedMasterKey: await toBase64(wrapped),
          });
          if (registered.ok) markRegistered();
          else setNote("Unlocked, but this browser could not be remembered.");
        } catch {
          setNote("Unlocked, but this browser could not be remembered.");
        }
      }

      setIdentity(identity);
      startTransition(() => {
        router.push(next);
        router.refresh();
      });
    } catch (err) {
      setError(
        err instanceof Error && /passphrase/i.test(err.message)
          ? "That passphrase did not open your keys."
          : "Could not unlock. Reload and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={unlock} className="flex flex-col gap-4">
      {error && <Banner tone="danger">{error}</Banner>}
      {note && <Banner>{note}</Banner>}

      <Field
        label="Recovery passphrase"
        id="passphrase"
        hint="The 30-character phrase shown once when you created your keys. There is no way to reset it — that is what end-to-end encryption means."
      >
        <Input
          id="passphrase"
          name="passphrase"
          autoComplete="off"
          spellCheck={false}
          required
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="font-mono"
        />
      </Field>

      <label className="text-ink-soft text-ui flex min-h-11 items-center gap-2">
        <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Remember this browser
      </label>

      <Button
        type="submit"
        disabled={passphrase.trim().length === 0}
        busy={pending || restoring}
        busyLabel={restoring ? "Checking this browser…" : "Unlocking…"}
      >
        Unlock
      </Button>

      <p className="text-muted measure text-fine">
        {/* Precise about what remembering does and does not do. Overstating it
            would be worse than not offering it at all. */}
        Without this, an unlock lasts until you reload or close the tab. Remembering
        stores a key in this browser that it cannot read back or send anywhere, and keeps
        your master key on the server sealed to that key — so neither half is enough on
        its own. Revoking the device later deletes the server&rsquo;s half and leaves this
        browser with nothing to open.
      </p>
    </form>
  );
}

/** A label a person will recognise in a list of devices. */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const platform = /Macintosh/.test(ua)
    ? "Mac"
    : /Windows/.test(ua)
      ? "Windows"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Browser";
  const browser = /Firefox/.test(ua)
    ? "Firefox"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Chrome/.test(ua)
        ? "Chrome"
        : /Safari/.test(ua)
          ? "Safari"
          : "browser";
  return `${browser} on ${platform}`;
}
