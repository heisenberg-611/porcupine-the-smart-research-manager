/**
 * Just enough tar to unpack a TeX bundle.
 *
 * The bundle and every pack are `.tar.gz`, and no dependency in the tree reads
 * tar — so this does, in about sixty lines, because the alternative is another
 * package for a format that has not changed since 1988.
 *
 * What it deliberately does NOT do: symlinks, permissions, ownership, sparse
 * files, or writing anything to disk. The output is a name → bytes map handed
 * straight to the engine's virtual filesystem.
 */

/** Header field offsets, named rather than inlined as magic numbers. */
const NAME = 0;
const SIZE = 124;
const TYPEFLAG = 156;
const MAGIC = 257;
const PREFIX = 345;
const BLOCK = 512;

const decoder = new TextDecoder();

/**
 * Entry types worth keeping.
 *
 * `0` is a regular file and `\0` is the same thing written by pre-POSIX tars.
 * Everything else — directories (`5`), symlinks (`2`), character devices, and
 * the GNU/pax metadata entries below — is skipped rather than being added to
 * the filesystem as though it were a file. The previous version filtered
 * directories by looking for a trailing slash in the name, which works for
 * directories and silently admitted pax headers as files called
 * `PaxHeaders/…`.
 */
function isRegularFile(flag: number): boolean {
  return flag === 0x30 || flag === 0;
}

/** GNU long name (`L`) and pax extended headers (`x`, `g`). */
const GNU_LONGNAME = 0x4c;
const PAX_NEXT = 0x78;
const PAX_GLOBAL = 0x67;

export function untar(buffer: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  /** Set by a preceding GNU long-name entry; consumed by the next header. */
  let pendingName: string | null = null;

  while (offset + BLOCK <= buffer.length) {
    // Two blocks of nulls end the archive. One is enough to stop on: a header
    // whose name begins with NUL is not a file.
    if (buffer[offset + NAME] === 0) break;

    const size = readOctal(buffer, offset + SIZE, 12);
    if (size === null) {
      // A header we cannot size is a header we cannot skip past, so there is
      // no safe way to continue. Throwing beats silently returning half an
      // archive, which would surface later as an inscrutable "file not found"
      // from the TeX engine.
      throw new Error(`Corrupt tar: unreadable size at byte ${offset}`);
    }

    const flag = buffer[offset + TYPEFLAG] ?? 0;
    const content = buffer.subarray(offset + BLOCK, offset + BLOCK + size);

    if (flag === GNU_LONGNAME) {
      // The entry's *content* is the real name of the file that follows.
      pendingName = decodeCString(content);
    } else if (flag === PAX_NEXT || flag === PAX_GLOBAL) {
      // Extended attributes we do not need. Skipped rather than parsed —
      // nothing in a TeX bundle depends on them.
    } else if (isRegularFile(flag)) {
      const name = pendingName ?? readName(buffer, offset);
      pendingName = null;
      if (name.length > 0) files.set(name, content);
    } else {
      pendingName = null;
    }

    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }

  return files;
}

/** `prefix/name` for ustar archives, plain `name` otherwise. */
function readName(buffer: Uint8Array, offset: number): string {
  const name = decodeCString(buffer.subarray(offset + NAME, offset + NAME + 100));
  const magic = decoder.decode(buffer.subarray(offset + MAGIC, offset + MAGIC + 5));
  if (magic !== "ustar") return name;

  const prefix = decodeCString(buffer.subarray(offset + PREFIX, offset + PREFIX + 155));
  return prefix ? `${prefix}/${name}` : name;
}

function decodeCString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

/**
 * Tar sizes are octal, ASCII, and padded with spaces or NULs in any
 * combination — which is why this is not `parseInt` on a decoded string.
 *
 * Returns null rather than NaN. The previous version let a NaN size through,
 * which made the read offset NaN, which made the loop condition false, which
 * ended the archive early and quietly: the map came back with a plausible
 * number of files and the missing ones showed up as a LaTeX error much later.
 */
function readOctal(buffer: Uint8Array, offset: number, length: number): number | null {
  // GNU base-256 encoding for sizes that do not fit in octal. No TeX bundle
  // has an 8GB member, but detecting it beats misreading it as octal.
  if ((buffer[offset] ?? 0) & 0x80) return null;

  let value = 0;
  let seenDigit = false;

  for (let i = 0; i < length; i++) {
    const byte = buffer[offset + i];
    if (byte === undefined) return null;
    if (byte === 0 || byte === 0x20) {
      if (seenDigit) break;
      continue;
    }
    if (byte < 0x30 || byte > 0x37) return null;
    value = value * 8 + (byte - 0x30);
    seenDigit = true;
  }

  return seenDigit ? value : null;
}
