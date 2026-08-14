import { deflateRawSync } from "node:zlib";

import { neutralise } from "./csv";

/**
 * A minimal XLSX writer (4.4).
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN A DEPENDENCY.
 *
 * The obvious choices are SheetJS or ExcelJS. Both are large, both pull in
 * transitive dependencies, and the evidence table needs roughly two percent of
 * either: one sheet, a header row, strings and numbers, no styling, no
 * formulas, no charts. An .xlsx is a ZIP of four small XML parts, and Node
 * already ships the only hard part (DEFLATE) in zlib.
 *
 * The part that genuinely matters is that NUMBERS ARE NUMERIC CELLS. Writing
 * every value as a string produces a file that opens correctly and cannot be
 * averaged, summed or charted — which would quietly undo ADR-001's decision to
 * store extraction values as typed plaintext in the first place.
 *
 * Not implemented, deliberately: styling, column widths, frozen panes, shared
 * strings. Inline strings cost bytes and save a whole part plus its index.
 */

/** CRC-32, as ZIP requires. Table built once at module load. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

interface Entry {
  name: string;
  data: Buffer;
}

/**
 * A ZIP container, STORED as DEFLATE, with no ZIP64 and no data descriptors.
 *
 * Sizes are known before writing because everything is built in memory, which
 * keeps this to the simple case: local header, data, central directory, EOCD.
 */
function zip(entries: readonly Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method: deflate
    // A fixed timestamp. Two exports of an unchanged review should be
    // byte-identical, so a diff shows a changed review and nothing else.
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuf, end]);
}

/**
 * XML escaping, plus the control characters XML 1.0 cannot represent AT ALL.
 *
 * Escaping is not enough for those: `&#x1;` is as illegal as a raw 0x01 byte,
 * and Excel rejects the whole workbook rather than skipping the cell. Extracted
 * text comes out of PDFs, which are a reliable source of stray control bytes,
 * so they are dropped. Tab, newline and carriage return are legal and kept.
 */
function xmlText(value: string): string {
  return (
    value
      // Everything below 0x20 except tab (09), newline (0A) and carriage
      // return (0D), written as escapes: putting the raw bytes in this source
      // file made it stop being a text file at all — `file` reported "data"
      // and grep treated it as binary.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
  );
}

/** A1, B1 … Z1, AA1. */
export function columnRef(index: number): string {
  let ref = "";
  let n = index;
  while (n >= 0) {
    ref = String.fromCharCode(65 + (n % 26)) + ref;
    n = Math.floor(n / 26) - 1;
  }
  return ref;
}

export type XlsxCell = string | number | null;

function cellXml(ref: string, value: XlsxCell): string {
  if (value === null || value === "") return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    // A numeric cell. This is the whole reason for typed values.
    return `<c r="${ref}"><v>${value}</v></c>`;
  }

  const text = xmlText(neutralise(String(value)));
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

export function toXlsx(
  rows: readonly (readonly XlsxCell[])[],
  sheetName = "Evidence",
): Buffer {
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => cellXml(`${columnRef(c)}${r + 1}`, value))
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${sheetRows}</sheetData></worksheet>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  // Sheet names are limited to 31 characters and cannot contain : \ / ? * [ ]
  const safeName =
    xmlText(sheetName.replace(/[:\\/?*[\]]/g, "-").slice(0, 31)) || "Sheet1";

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`;

  const utf8 = (s: string) => Buffer.from(s, "utf8");

  return zip([
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rels) },
    { name: "xl/workbook.xml", data: utf8(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(sheet) },
  ]);
}
