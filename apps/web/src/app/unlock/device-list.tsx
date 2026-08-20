"use client";

import { useCallback, useEffect, useState } from "react";

import { Banner, Button } from "@/components/ui";
import { forgetDeviceKey } from "@/lib/crypto/device";

import { listDevices, revokeDevice, type DeviceRow } from "./device-actions";

/**
 * Browsers that can unlock without the passphrase.
 *
 * Revoking deletes the server's half of the pair, which is what makes it real
 * rather than advisory: the browser keeps a key it cannot export and no longer
 * has anything to open with it.
 *
 * The local key is forgotten too when you revoke from the same browser you are
 * sitting at — not because it would still work, but because leaving an orphan
 * behind means the next unlock spends a round trip discovering it is useless.
 */
export function DeviceList() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  /*
   * The id of the row being revoked, not a bare boolean.
   *
   * Every row shares this state. Disabling them all together was right — one
   * revoke at a time — but "Revoking…" on all of them at once would name the
   * wrong browser, and the whole point of the label is to say which thing is
   * happening.
   */
  const [revoking, setRevoking] = useState<string | null>(null);
  const pending = revoking !== null;

  const load = useCallback(async () => {
    const result = await listDevices();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDevices(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setRevoking(id);
    setError(null);
    try {
      const result = await revokeDevice(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Best effort, and harmless if it is a different browser's row.
      await forgetDeviceKey().catch(() => undefined);
      await load();
    } finally {
      setRevoking(null);
    }
  }

  if (devices.length === 0) return null;

  return (
    <section aria-labelledby="devices" className="border-rule border-t pt-6">
      <h2 id="devices" className="text-ink text-heading mb-1 font-medium">
        Remembered browsers
      </h2>
      <p className="text-muted text-fine mb-3">
        These can unlock without your passphrase. Revoking one takes effect immediately —
        the key it holds cannot open anything on its own.
      </p>

      {error && <Banner tone="danger">{error}</Banner>}

      <ul className="border-border divide-border divide-y rounded-lg border">
        {devices.map((device) => (
          <li
            key={device.id}
            className="flex flex-wrap items-center justify-between gap-3 p-3"
          >
            <span className="text-ink text-ui">
              {device.label}
              <span className="text-muted text-fine block">
                {device.lastSeenAt
                  ? `Last used ${new Date(device.lastSeenAt).toLocaleDateString()}`
                  : "Never used"}
              </span>
            </span>
            <Button
              variant="ghost"
              className="border-border border"
              disabled={pending}
              busy={revoking === device.id}
              busyLabel="Revoking…"
              onClick={() => void revoke(device.id)}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
