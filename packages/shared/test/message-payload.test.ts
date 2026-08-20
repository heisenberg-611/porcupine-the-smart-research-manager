import { describe, expect, it } from "vitest";

import { decodeMessage, encodeMessage } from "../src/message-payload";

describe("what a message's plaintext contains", () => {
  it("round-trips a plain message", () => {
    expect(decodeMessage(encodeMessage({ text: "the effect is small" }))).toEqual({
      text: "the effect is small",
    });
  });

  it("round-trips a reply", () => {
    const encoded = encodeMessage({ text: "agreed", replyTo: "abc-123" });
    expect(decodeMessage(encoded)).toEqual({ text: "agreed", replyTo: "abc-123" });
  });

  it("omits replyTo rather than sending null", () => {
    expect(encodeMessage({ text: "hello" })).not.toContain("replyTo");
  });

  /*
   * Every message sent before this format existed is a bare string, and no
   * migration can fix that — the server cannot read them, so nobody can
   * rewrite them. They have to keep working forever.
   */
  it("reads a message from before the format existed", () => {
    expect(decodeMessage("just some text")).toEqual({ text: "just some text" });
  });

  it("does not mistake pasted JSON for a payload", () => {
    // A researcher pasting a JSON snippet is not sending a payload, and
    // showing them an empty message would be the failure.
    const pasted = '{"doi": "10.1000/xyz", "year": 2020}';
    expect(decodeMessage(pasted)).toEqual({ text: pasted });
  });

  it("does not mistake pasted BibTeX for a payload either", () => {
    const bibtex = "{ vaswani2017, title = {Attention} }";
    expect(decodeMessage(bibtex)).toEqual({ text: bibtex });
  });

  it("survives a truncated or corrupt payload", () => {
    expect(decodeMessage('{"v":1,"text":')).toEqual({ text: '{"v":1,"text":' });
  });

  it("ignores a replyTo that is not an id", () => {
    const hostile = JSON.stringify({ v: 1, text: "hi", replyTo: { drop: "table" } });
    expect(decodeMessage(hostile)).toEqual({ text: "hi" });
  });

  /*
   * A message from a future version shows its text rather than nothing.
   * Whatever else that version adds, the text field is the part a reader
   * needs, and a blank line is the worst possible rendering of it.
   */
  it("shows the text of a newer payload it only partly understands", () => {
    const future = JSON.stringify({ v: 99, text: "from the future", threadId: "x" });
    expect(decodeMessage(future)).toEqual({ text: "from the future" });
  });
});
