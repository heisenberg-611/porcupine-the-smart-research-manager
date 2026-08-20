import { describe, expect, it } from "vitest";

import { linkify } from "./linkify";

/** The links only, without the discriminant, so assertions read as the claim. */
const links = (text: string) =>
  linkify(text)
    .filter((part) => part.kind === "link")
    .map((part) => ({ value: part.value, href: (part as { href: string }).href }));

describe("finding the links in a message", () => {
  it("leaves a message with no link alone", () => {
    expect(linkify("the effect is small")).toEqual([
      { kind: "text", value: "the effect is small" },
    ]);
  });

  it("finds a plain https address", () => {
    expect(links("see https://example.com/paper.pdf now")).toEqual([
      { value: "https://example.com/paper.pdf", href: "https://example.com/paper.pdf" },
    ]);
  });

  it("gives a bare www. address a scheme", () => {
    // Without one the browser treats it as a path relative to the app.
    expect(links("www.example.com")).toEqual([
      { value: "www.example.com", href: "https://www.example.com" },
    ]);
  });

  it("keeps a DOI query string intact", () => {
    const doi = "https://doi.org/10.1000/xyz?utm=1&x=2";
    expect(links(`ref: ${doi}`)[0]?.href).toBe(doi);
  });

  /*
   * The sentence is not part of the address. A full stop after a URL is
   * punctuation, and including it sends the reader to a 404.
   */
  it("does not swallow the full stop that ends the sentence", () => {
    expect(links("read https://example.com/a.")[0]?.value).toBe("https://example.com/a");
  });

  it("keeps balanced brackets that belong to the address", () => {
    const wiki = "https://en.wikipedia.org/wiki/Bayes_theorem_(statistics)";
    expect(links(`see ${wiki}`)[0]?.value).toBe(wiki);
  });

  it("but not a closing bracket that never opened", () => {
    expect(links("(see https://example.com)")[0]?.value).toBe("https://example.com");
  });

  /*
   * The security property. Parts are rendered as text by React and only what
   * this function calls a link becomes an anchor, so a message cannot smuggle
   * a scheme the reader did not ask for.
   */
  it("never produces a javascript: link", () => {
    expect(links("javascript:alert(1)")).toEqual([]);
    expect(links("data:text/html,<script>")).toEqual([]);
  });

  it("does not linkify prose that merely contains a dot", () => {
    // "fig.2" and "e.g." are everywhere in a methods section.
    expect(links("see fig.2 and e.g. the appendix")).toEqual([]);
  });

  it("finds several links in one message, keeping the text between them", () => {
    const parts = linkify("a https://one.example b https://two.example c");
    expect(parts.map((p) => p.kind)).toEqual(["text", "link", "text", "link", "text"]);
    expect(parts[4]).toEqual({ kind: "text", value: " c" });
  });
});
