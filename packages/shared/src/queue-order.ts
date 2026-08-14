/**
 * Per-member ordering for a shared screening queue.
 *
 * The problem this solves, measured rather than imagined: the Phase 1 exit
 * trial ran four members against one project and every one of them was served
 * the same relevance-ordered list starting at position zero. All four screened
 * the same papers. Twenty decisions produced five screened papers; the
 * compare-and-swap correctly refused the other fifteen, but "correctly
 * refused" is still fifteen wasted decisions, and in a real lab that is most
 * of an afternoon.
 *
 * The fix is not a lock or a claim table. Those need expiry, and an expiry
 * gets it wrong in both directions — too short and two people collide anyway,
 * too long and a paper is frozen because someone closed their laptop.
 *
 * Instead each member walks the SAME pool in a DIFFERENT deterministic order.
 * Four people starting at four different points in 300 papers essentially
 * never meet, and when the pool runs low and they do, the compare-and-swap
 * still catches it. No schema, no state, no expiry.
 *
 * Two properties matter and both are tested:
 *
 *   - **Deterministic.** The same member sees the same order on every render.
 *     A list that reshuffles between page loads is unusable for screening,
 *     where people work through it by position.
 *   - **Same set.** Nobody's papers are hidden from anybody. This distributes
 *     starting points; it does not partition ownership, so a member who
 *     finishes their run still sees everything left.
 */

/**
 * FNV-1a, 32-bit.
 *
 * A cryptographic hash would be pointless here — this is a shuffle, not a
 * secret — and `Math.random()` would break determinism, which is the property
 * that makes the order usable at all.
 */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime, via shifts because Math.imul on the literal overflows.
    hash =
      (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>>
      0;
  }
  return hash >>> 0;
}

/**
 * Reorder a shared queue so this member starts somewhere of their own.
 *
 * The input should already be filtered and ranked — this is applied to the
 * relevant pool, not to the whole library, so the team is still working the
 * papers that matter rather than a random sample of everything.
 */
export function orderForMember<T extends { id: string }>(
  items: T[],
  memberId: string,
): T[] {
  if (items.length <= 1 || !memberId) return items;

  return [...items].sort((a, b) => {
    const ha = stableHash(`${a.id}:${memberId}`);
    const hb = stableHash(`${b.id}:${memberId}`);
    // Tie-break on id so the order is total, not merely mostly-determined.
    return ha - hb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/**
 * How much two members' first `window` papers overlap, 0..1.
 *
 * Exported because it is the thing worth asserting: the shuffle is only
 * useful if it actually separates people, and "it looks shuffled" is not a
 * measurement.
 */
export function overlapRatio<T extends { id: string }>(
  items: T[],
  memberA: string,
  memberB: string,
  window: number,
): number {
  const a = orderForMember(items, memberA).slice(0, window);
  const b = new Set(
    orderForMember(items, memberB)
      .slice(0, window)
      .map((i) => i.id),
  );
  if (a.length === 0) return 0;
  return a.filter((item) => b.has(item.id)).length / a.length;
}
