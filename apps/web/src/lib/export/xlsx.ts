import { deflateRawSync } from "node:zlib";

import { neutralise } from "./csv";

/**
 * A styled XLSX writer with colors, zebra striping, frozen headers, and auto column widths.
 *
 * WHY THIS IS HAND-WRITTEN RATHER THAN A HEAVY DEPENDENCY:
 *
 * Full Excel styling (fills, bold fonts, borders, frozen header row, zebra rows)
 * can be implemented in pure OpenXML with zero external runtime dependencies.
 * Numbers remain typed numeric cells for Excel arithmetic and charting.
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
    // Fixed timestamp for byte-identical reproducibility
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
 */
function xmlText(value: string): string {
  return (
    value
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

/**
 * Renders a cell with cell reference `ref`, style index `styleId`, and value.
 *
 * Style indices in `styles.xml`:
 * - 0: Default white cell
 * - 1: Header cell (Bold white text on #1E293B dark slate)
 * - 2: Zebra row cell (#F8FAFC light tint)
 */
function cellXml(ref: string, value: XlsxCell, styleId: number): string {
  if (value === null || value === "") {
    return `<c r="${ref}" s="${styleId}"/>`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}" s="${styleId}"><v>${value}</v></c>`;
  }

  const text = xmlText(neutralise(String(value)));
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

export function toXlsx(
  rows: readonly (readonly XlsxCell[])[],
  sheetName = "Evidence",
): Buffer {
  // Determine column count and calculate column widths
  const maxCols = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const colWidths = new Array<number>(maxCols).fill(12);

  for (let c = 0; c < maxCols; c++) {
    let maxLen = 10;
    for (let r = 0; r < Math.min(rows.length, 100); r++) {
      const val = rows[r]?.[c];
      if (val !== null && val !== undefined) {
        const len = String(val).length;
        if (len > maxLen) maxLen = len;
      }
    }
    colWidths[c] = Math.min(50, Math.max(12, maxLen + 3));
  }

  const colsXml =
    maxCols > 0
      ? `<cols>${colWidths
          .map(
            (w, i) =>
              `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
          )
          .join("")}</cols>`
      : "";

  const sheetRows = rows
    .map((row, r) => {
      // Row 0 is the header (styleId 1), alternating rows use styleId 2 (zebra) or 0 (white)
      const styleId = r === 0 ? 1 : r % 2 === 1 ? 2 : 0;
      const cells = row
        .map((value, c) => cellXml(`${columnRef(c)}${r + 1}`, value, styleId))
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView tabSelected="1" workbookViewId="0">` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    colsXml +
    `<sheetData>${sheetRows}</sheetData></worksheet>`;

  // ── styles.xml with Colors, Fonts, and Borders ───────────────────────────
  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2">` +
    `<font><sz val="11"/><name val="Segoe UI"/><color rgb="FF0F172A"/></font>` +
    `<font><b/><sz val="11"/><name val="Segoe UI"/><color rgb="FFFFFFFF"/></font>` +
    `</fonts>` +
    `<fills count="4">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>` + // 2: Header Dark Slate
    `<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>` + // 3: Zebra Light Tint
    `</fills>` +
    `<borders count="2">` +
    `<border><left/><right/><top/><bottom/></border>` +
    `<border>` +
    `<left style="thin"><color rgb="FFE2E8F0"/></left>` +
    `<right style="thin"><color rgb="FFE2E8F0"/></right>` +
    `<top style="thin"><color rgb="FFE2E8F0"/></top>` +
    `<bottom style="thin"><color rgb="FFE2E8F0"/></bottom>` +
    `</border>` +
    `</borders>` +
    `<cellStyleXfs count="1">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>` +
    `</cellStyleXfs>` +
    `<cellXfs count="3">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` + // 0: Normal
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` + // 1: Header
    `<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` + // 2: Zebra
    `</cellXfs>` +
    `</styleSheet>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
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
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const utf8 = (s: string) => Buffer.from(s, "utf8");

  return zip([
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rels) },
    { name: "xl/workbook.xml", data: utf8(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels) },
    { name: "xl/styles.xml", data: utf8(stylesXml) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(sheet) },
  ]);
}
