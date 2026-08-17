"use client";

import { fromBase64, rewrapIdentity, toBase64, unwrapIdentity } from "@Porcupine/crypto";
import { useState } from "react";

import { getMyKeyMaterial, storeRewrappedBundle } from "@/app/unlock/actions";
import { Banner, Button, Field, Input } from "@/components/ui";
import { useCryptoSession } from "@/lib/crypto/session";

/**
 * The passphrase, asked for where it is needed.
 *
 * `/unlock` still exists and is still the right destination when something
 * sends you there deliberately. But routing to it from a page you were already
 * trying to use turned a single question into a journey: Messages said "unlock
 * your keys", took you to another screen, and returned you to a page that then
 * said "this project has no content key yet" and sent you somewhere else
 * again. Five screens and three concepts before anyone said a word.
 *
 * Nothing about the cryptography changes by asking here. The identity is
 * unwrapped in this browser, held in memory by the same provider, and the
 * server sees the same wrapped bundle it always did.
 */
export function InlineUnlock({ onUnlocked }: { onUnlocked?: () => void }) {
  const { setIdentity } = useCryptoSession();

  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

      // Argon2id, on the main thread, behind a disabled button. The Web Worker
      // move is still owed and noted in the crypto package.
      const identity = await unwrapIdentity(wrapped, salt, passphrase.trim());

      if (identity.needsRewrap) {
        const upgraded = await rewrapIdentity(identity, salt, passphrase.trim());
        const stored = await storeRewrappedBundle({
          wrappedBundle: await toBase64(upgraded),
        });
        // A failed upgrade must not block the unlock: the keys in hand are
        // correct either way.
        if (!stored.ok) {
          setNote("Unlocked. The key bundle upgrade did not save and will be retried.");
        }
      }

      setIdentity(identity);
      onUnlocked?.();
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
    <form onSubmit={unlock} className="flex flex-col gap-3">
      {error && <Banner tone="danger">{error}</Banner>}
      {note && <Banner>{note}</Banner>}

      <Field
        label="Recovery passphrase"
        id="inline-passphrase"
        hint="The 30-character phrase shown once when you created your keys. There is no way to reset it — that is what end-to-end encryption means."
      >
        <Input
          id="inline-passphrase"
          name="passphrase"
          autoComplete="off"
          spellCheck={false}
          required
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          className="font-mono"
        />
      </Field>

      <Button
        type="submit"
        variant="primary"
        disabled={pending || passphrase.trim().length === 0}
      >
        {pending ? "Unlocking…" : "Unlock"}
      </Button>
    </form>
  );
}
