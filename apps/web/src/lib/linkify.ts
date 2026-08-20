/**
 * Split a message into text and the links inside it.
 *
 * Returns PARTS rather than HTML, deliberately. A message is written by a
 * member and decrypted in the reader's browser, so turning it into markup
 * would put somebody else's text into the DOM as code — and in a tool where
 * the server cannot see the message, it also cannot sanitise it. Parts go
 * through React as text, which escapes them, and only the pieces this function
 * recognised as links ever become anchors.
 */

export type MessagePart =
  { kind: "text"; value: string } | { kind: "link"; value: string; href: string };

/**
 * Brackets are allowed INTO the match and balanced afterwards. Excluding them
 * here looks safer and is not: the match then stops at the first bracket, so
 * `/wiki/Bayes_theorem_(statistics)` links only as far as the underscore and
 * the balancing code below never sees a bracket at all.
 *
 * Bare `example.com` is deliberately not matched.
 *
 * It would turn "e.g. see fig.2" and half the abbreviations in a methods
 * section into links. A scheme, or a `www.`, is the signal that somebody meant
 * an address.
 */
const PATTERN = /\b(https?:\/\/[^\s<>[\]]+|www\.[^\s<>[\]]+)/gi;

/**
 * Trailing punctuation belongs to the sentence, not to the URL.
 *
 * A closing bracket is excluded here and handled separately, because it is the
 * one character that can belong to either — `/wiki/Bayes_theorem_(statistics)`
 * ends in one and `(see https://example.com)` does not.
 */
const TRAILING = /[.,;:!?'"\u2019\u201d\]}]+$/;

export function linkify(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(PATTERN)) {
    const start = match.index;
    let raw = match[0].replace(TRAILING, "");

    /*
     * Then the brackets, counted rather than stripped.
     *
     * Balanced ones are part of the address; a closing one that never opened
     * belongs to the sentence around it. Stripping every trailing bracket
     * breaks Wikipedia, and stripping none turns "(see https://example.com)"
     * into a 404.
     */
    let closes = (raw.match(/\)/g) ?? []).length;
    const opens = (raw.match(/\(/g) ?? []).length;
    while (closes > opens && raw.endsWith(")")) {
      raw = raw.slice(0, -1).replace(TRAILING, "");
      closes--;
    }

    if (raw === "") continue;

    if (start > cursor) {
      parts.push({ kind: "text", value: text.slice(cursor, start) });
    }

    parts.push({
      kind: "link",
      value: raw,
      // `www.` gets a scheme so the browser does not read it as a relative
      // path. Only http(s) is ever produced, so `javascript:` cannot appear
      // here however the message was written.
      href: raw.toLowerCase().startsWith("www.") ? `https://${raw}` : raw,
    });

    cursor = start + raw.length;
  }

  if (cursor < text.length) {
    parts.push({ kind: "text", value: text.slice(cursor) });
  }

  return parts;
}
