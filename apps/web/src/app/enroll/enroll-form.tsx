"use client";

import { createIdentity, toBase64 } from "@porcupine/crypto";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Banner, Button, Card } from "@/components/ui";

import { storeIdentityKeys } from "./actions";

type Stage =
  | { name: "idle" }
  | { name: "generating" }
  | { name: "show-passphrase"; passphrase: string }
  | { name: "error"; message: string };

/**
 * Key enrollment.
 *
 * Runs entirely in the browser. The recovery passphrase is displayed once and
 * never transmitted — which means we have to be honest, at this exact moment,
 * that losing it is unrecoverable. Burying that in a help article would make
 * the encryption claim dishonest.
 *
 * Argon2id blocks the main thread for a few hundred milliseconds here. Phase
 * 3 moves this into a Web Worker; at one call per account it is acceptable
 * now, and noted so it is not forgotten.
 */
export function EnrollForm({ next }: { next: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [confirmed, setConfirmed] = useState(false);

  async function generate() {
    setStage({ name: "generating" });
    try {
      const identity = await createIdentity();

      const result = await storeIdentityKeys({
        identityPubKey: await toBase64(identity.identityPubKey),
        signingPubKey: await toBase64(identity.signingPubKey),
        wrappedBundle: await toBase64(identity.wrappedBundle),
        kdfSalt: await toBase64(identity.kdfSalt),
      });

      if (!result.ok) {
        setStage({ name: "error", message: result.error });
        return;
      }

      setStage({ name: "show-passphrase", passphrase: identity.recoveryPassphrase });
    } catch {
      setStage({
        name: "error",
        message: "Key generation failed. Reload and try again.",
      });
    }
  }

  if (stage.name === "show-passphrase") {
    return (
      <div className="flex flex-col gap-5">
        <Banner tone="danger">
          This is the only time this passphrase will be shown. Save it in your password
          manager now.{" "}
          <strong>If you lose it, encrypted content cannot be recovered</strong> — not by
          you, and not by us.
        </Banner>

        <Card>
          <p className="text-muted text-xs font-medium tracking-widest uppercase">
            Recovery passphrase
          </p>
          <p className="text-ink mt-3 font-mono text-lg break-all select-all">
            {stage.passphrase}
          </p>
        </Card>

        <label className="text-ink flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>I have saved this passphrase somewhere I can find it again.</span>
        </label>

        <Button
          disabled={!confirmed}
          onClick={() => {
            router.push(next);
            router.refresh();
          }}
        >
          Continue
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {stage.name === "error" && <Banner tone="danger">{stage.message}</Banner>}

      <Card>
        <ul className="text-muted flex list-disc flex-col gap-2 pl-4 text-sm">
          <li>Your keys are generated here, on this device.</li>
          <li>
            We store the public half, plus your private half encrypted with a passphrase
            we never see.
          </li>
          <li>You&rsquo;ll get a recovery passphrase on the next screen. Save it.</li>
        </ul>
      </Card>

      <Button onClick={generate} disabled={stage.name === "generating"}>
        {stage.name === "generating" ? "Generating keys…" : "Generate my keys"}
      </Button>
    </div>
  );
}
