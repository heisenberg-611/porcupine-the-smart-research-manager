import { describe, expect, it } from "vitest";

import { orderForMember, overlapRatio, stableHash } from "../src/queue-order";

const corpus = Array.from({ length: 300 }, (_, i) => ({
  id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
}));

const MEMBERS = ["alice", "bob", "carol", "dave"];

describe("stableHash", () => {
  it("is deterministic", () => {
    expect(stableHash("abc")).toBe(stableHash("abc"));
  });

  it("separates similar inputs", () => {
    expect(stableHash("paper-1:alice")).not.toBe(stableHash("paper-1:bob"));
    expect(stableHash("paper-1:alice")).not.toBe(stableHash("paper-2:alice"));
  });

  it("stays a 32-bit unsigned integer", () => {
    for (const input of ["", "a", "a".repeat(500), "🙂"]) {
      const h = stableHash(input);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("spreads across the range rather than clustering", () => {
    // A hash that returns near-identical values would produce an order that
    // is only decided by the id tie-break — the same order for everyone,
    // which is the bug this exists to prevent.
    const buckets = new Array(8).fill(0);
    for (let i = 0; i < 2000; i++) {
      buckets[Math.floor((stableHash(`id-${i}:alice`) / 0x100000000) * 8)]!++;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(2000 / 8 / 3);
    }
  });
});

describe("orderForMember", () => {
  it("is deterministic for the same member", () => {
    const first = orderForMember(corpus, "alice").map((i) => i.id);
    const second = orderForMember(corpus, "alice").map((i) => i.id);
    expect(first).toEqual(second);
  });

  it("does not depend on the input order", () => {
    // The queue arrives sorted by relevance; a member's order must not change
    // because two papers swapped rank.
    const forward = orderForMember(corpus, "alice").map((i) => i.id);
    const reversed = orderForMember([...corpus].reverse(), "alice").map((i) => i.id);
    expect(forward).toEqual(reversed);
  });

  it("gives different members different orders", () => {
    const alice = orderForMember(corpus, "alice").map((i) => i.id);
    const bob = orderForMember(corpus, "bob").map((i) => i.id);
    expect(alice).not.toEqual(bob);
    expect(alice[0]).not.toBe(bob[0]);
  });

  it("hides nothing — every member sees the same set", () => {
    const base = new Set(corpus.map((i) => i.id));
    for (const member of MEMBERS) {
      const ordered = orderForMember(corpus, member);
      expect(ordered).toHaveLength(corpus.length);
      expect(new Set(ordered.map((i) => i.id))).toEqual(base);
    }
  });

  it("leaves a trivial queue alone", () => {
    expect(orderForMember([], "alice")).toEqual([]);
    expect(orderForMember([{ id: "x" }], "alice")).toEqual([{ id: "x" }]);
  });

  it("falls back to the given order when there is no member id", () => {
    expect(orderForMember(corpus, "").map((i) => i.id)).toEqual(corpus.map((i) => i.id));
  });
});

describe("collision behaviour — the thing this exists for", () => {
  it("four members barely overlap in their first 20 papers", () => {
    // Before this change every pair overlapped 100%: same list, same start.
    for (let i = 0; i < MEMBERS.length; i++) {
      for (let j = i + 1; j < MEMBERS.length; j++) {
        const overlap = overlapRatio(corpus, MEMBERS[i]!, MEMBERS[j]!, 20);
        expect(
          overlap,
          `${MEMBERS[i]} vs ${MEMBERS[j]} overlap in first 20`,
        ).toBeLessThan(0.25);
      }
    }
  });

  it("overlap grows as the pool shrinks, which is expected and handled", () => {
    // With 8 papers left and 4 people, collisions are unavoidable — that is
    // arithmetic, not a flaw. The compare-and-swap catches the remainder, and
    // this assertion records that the design knows it.
    const nearlyDone = corpus.slice(0, 8);
    const overlap = overlapRatio(nearlyDone, "alice", "bob", 4);
    expect(overlap).toBeGreaterThan(0);
  });

  it("distributes first picks across the corpus", () => {
    const firsts = MEMBERS.map((m) => orderForMember(corpus, m)[0]!.id);
    expect(new Set(firsts).size).toBe(MEMBERS.length);
  });
});
