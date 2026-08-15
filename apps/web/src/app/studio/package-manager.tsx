"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Input } from "@/components/ui";
import { extractUpload } from "@/lib/latex/extract";
import {
  listPackages,
  putFiles,
  removeAll,
  removePackage,
  requestPersistence,
  storeToken,
  sweepExpired,
  TTL_DAYS,
  type StoredPackage,
} from "@/lib/latex/package-store";

/**
 * The packages this browser holds, and the way to add more.
 *
 * The shipped TeX distribution is small on purpose — everyone downloads it —
 * so anything beyond the curated packs comes from the person who needs it.
 * Drop in a `.sty`, or a whole CTAN `.zip`/`.tar.gz`, and it lives in this
 * browser only: nothing is uploaded anywhere, which is also why nobody has to
 * work out whether we may redistribute it.
 */
export function PackageManager({ onChange }: { onChange: (token: string) => void }) {
  const [packages, setPackages] = useState<StoredPackage[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const current = await listPackages();
    setPackages(current);
    onChange(await storeToken());
  }, [onChange]);

  useEffect(() => {
    void (async () => {
      try {
        // Expiry is enforced on load rather than by a timer: a browser tab
        // that has been open for a month is exactly the case a timer misses.
        const swept = await sweepExpired();
        if (swept > 0) {
          setNote(
            `${swept} ${swept === 1 ? "file" : "files"} passed ${TTL_DAYS} days and ${
              swept === 1 ? "was" : "were"
            } removed. Upload again to keep using them.`,
          );
        }
        await refresh();
      } catch {
        setError("This browser refused local storage, so packages cannot be kept.");
      }
    })();
  }, [refresh]);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setNote(null);

    try {
      // Asked for on first use rather than on page load: a permission prompt
      // that arrives before anyone has done anything gets dismissed.
      setPersisted(await requestPersistence());

      let added = 0;
      let skipped = 0;
      const collisions: string[] = [];

      for (const file of Array.from(files)) {
        const result = await extractUpload(file);
        if (result.files.size === 0) {
          setError(`Nothing TeX can read in ${file.name}.`);
          continue;
        }
        added += await putFiles(result.files, file.name);
        skipped += result.skipped;
        collisions.push(...result.collisions);
      }

      if (added > 0) {
        setNote(
          `Added ${added} ${added === 1 ? "file" : "files"}` +
            (skipped > 0 ? `, skipped ${skipped} (documentation and sources)` : "") +
            (collisions.length > 0
              ? `. Same-named files replaced: ${[...new Set(collisions)].join(", ")}`
              : ".") +
            ` Available for ${TTL_DAYS} days.`,
        );
      }

      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not read that: ${cause.message}`
          : "Upload failed.",
      );
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const total = packages.reduce((sum, p) => sum + p.bytes, 0);
  const soonest = packages.reduce(
    (min, p) => Math.min(min, p.daysLeft),
    Number.POSITIVE_INFINITY,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Reading…" : "Add packages"}
        </Button>
        <Input
          ref={input}
          type="file"
          multiple
          accept=".sty,.cls,.def,.cfg,.clo,.ldf,.fd,.bst,.bbx,.cbx,.lbx,.tex,.tfm,.otf,.ttf,.pfb,.zip,.gz,.tgz,.tar"
          onChange={(e) => void add(e.target.files)}
          className="sr-only"
          aria-label="TeX package files or archives"
        />
        {packages.length > 0 && (
          <Button
            variant="ghost"
            className="border-border border"
            disabled={busy}
            onClick={() => void removeAll().then(refresh)}
          >
            Remove all
          </Button>
        )}
        <span className="text-muted text-fine">
          {packages.length === 0
            ? "None yet"
            : `${packages.length} files · ${format(total)} · expires in ${soonest} ${
                soonest === 1 ? "day" : "days"
              }`}
        </span>
      </div>

      <p aria-live="polite" className="text-fine">
        {error && <span className="text-danger">{error}</span>}
        {!error && note && <span className="text-muted">{note}</span>}
      </p>

      {persisted === false && (
        <p className="text-muted text-fine">
          {/* Stated, because the alternative is a promise the browser can
              break without telling anyone. */}
          This browser would not mark the storage as persistent, so it may clear these
          sooner than {TTL_DAYS} days if it runs short of space.
        </p>
      )}

      {packages.length > 0 && (
        <ul className="border-rule divide-rule max-h-48 divide-y overflow-auto rounded border">
          {packages.map((pkg) => (
            <li
              key={pkg.name}
              className="flex items-center justify-between gap-3 px-3 py-1.5"
            >
              <span className="text-ink text-fine min-w-0 truncate font-mono">
                {pkg.name}
              </span>
              <span className="text-muted text-fine flex shrink-0 items-center gap-3">
                {format(pkg.bytes)}
                <span>
                  {pkg.daysLeft} {pkg.daysLeft === 1 ? "day" : "days"} left
                </span>
                <button
                  type="button"
                  onClick={() => void removePackage(pkg.name).then(refresh)}
                  aria-label={`Remove ${pkg.name}`}
                  className="hover:text-danger focus-visible:ring-accent rounded focus-visible:ring-2 focus-visible:outline-none"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted text-fine text-pretty">
        Files stay in this browser and are never uploaded. Directory structure is
        flattened, because the engine looks files up by name — so a CTAN archive can be
        dropped in whole and its documentation is discarded.
      </p>
    </div>
  );
}

function format(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
