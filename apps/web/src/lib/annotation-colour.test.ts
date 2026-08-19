import { describe, expect, it } from "vitest";

import { ANNOTATION_COLOURS, colourFor } from "./annotation-colour";

const uuid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

describe("a stable colour per person", () => {
  it("gives the same person the same colour every time", () => {
    const id = uuid(1);
    expect(colourFor(id)).toBe(colourFor(id));
  });

  it("gives different people different colours, usually", () => {
    // Not a guarantee — eight hues cannot separate every pair, which is why
    // the name is drawn beside the mark. What matters is that it SPREADS.
    const used = new Set(Array.from({ length: 40 }, (_, i) => colourFor(uuid(i)).name));
    expect(used.size).toBeGreaterThanOrEqual(6);
  });

  /*
   * The failure a naive hash produces.
   *
   * UUIDs share most of their alphabet, so summing char codes clusters them —
   * half a project comes out amber and the feature does nothing. Asserted on
   * REAL-shaped ids rather than on words.
   */
  it("spreads ids that differ only in a few characters", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 64; i++) {
      const name = colourFor(uuid(i)).name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const worst = Math.max(...counts.values());
    // A perfect spread is 8 of 64. Anything under a quarter of the sample in
    // one bucket is fine; clustering shows up as a third or more.
    expect(worst).toBeLessThan(64 / 4);
  });

  it("always returns a real colour, including for an empty id", () => {
    expect(ANNOTATION_COLOURS).toContain(colourFor(""));
  });
});
