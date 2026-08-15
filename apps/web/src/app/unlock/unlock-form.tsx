"use client";

import { fromBase64, rewrapIdentity, toBase64, unwrapIdentity } from "@porcupine/crypto";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Banner, Button, Field, Input } from "@/components/ui";
import { useCryptoSession } from "@/lib/crypto/session";

import { getMyKeyMaterial, storeRewrappedBundle } from "./actions";

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
  const { setIdentity } = useCryptoSession();

  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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

      setIdentity(identity);
      router.push(next);
      router.refresh();
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

      <Button type="submit" disabled={pending || passphrase.trim().length === 0}>
        {pending ? "Unlocking…" : "Unlock"}
      </Button>

      <p className="text-muted text-fine">
        {/* Said here rather than discovered later. */}
        This unlock lasts until you reload or close the tab. Registering a device will
        remove that step; until then the passphrase is the only way in.
      </p>
    </form>
  );
}
