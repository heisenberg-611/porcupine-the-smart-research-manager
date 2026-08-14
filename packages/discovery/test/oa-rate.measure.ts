import { describe, expect, it } from "vitest";

import { dedupe } from "../src/dedupe";
import { openalex } from "../src/providers/openalex";
import type { WorkInput } from "../src/types";

/**
 * R-04 — measuring the open-access rate the cost model assumes.
 *
 * `05-resolution-plan.md` §6 says plainly: *"R-04's OA dedupe rate is an
 * assumption. 45 % is plausible for biomedical corpora and optimistic for
 * humanities. Measure it in Phase 1 against a real project's library before
 * trusting the cost model."*
 *
 * This is that measurement. It hits OpenAlex for real, so it is NOT part of
 * the default suite — run it deliberately:
 *
 *     pnpm --filter @porcupine/discovery measure:oa
 *
 * What is actually being measured, and why it is narrower than "open access":
 *
 * R-04 lets a file into shared R2 storage (`R2_SHARED`, deduplicated across
 * users) only when it is verified REDISTRIBUTABLE. Free to read is not the
 * same thing: a green-OA copy in a repository is readable by anyone and still
 * not ours to serve to a second user.
 *
 * What this measures is OpenAlex's `is_oa` — "a free copy exists, here is its
 * URL". That is a CEILING on the redistributable share, not the share itself.
 * Establishing the latter needs Unpaywall's licence field, which is a Phase 2
 * integration. The number below should be read as "no more than this".
 *
 * Sampling spans disciplines on purpose, because the doc's own caveat is that
 * the rate varies by field, and a biomedical-only sample would confirm the
 * optimistic number by construction.
 */

const DISCIPLINES = [
  { field: "biomedical", terms: "randomised controlled trial cardiovascular outcomes" },
  { field: "computer science", terms: "transformer architecture language model" },
  { field: "humanities", terms: "postcolonial literature narrative theory" },
  { field: "social science", terms: "survey methodology response bias" },
  { field: "physics", terms: "quantum error correction surface code" },
  { field: "ecology", terms: "species distribution climate change modelling" },
];

interface FieldResult {
  field: string;
  total: number;
  withOaPdf: number;
  freeToRead: number;
}

describe("R-04: open-access rate", () => {
  it("measures the share of works with a redistributable PDF", async () => {
    const results: FieldResult[] = [];
    const all: WorkInput[] = [];

    for (const { field, terms } of DISCIPLINES) {
      const works = await openalex.search({ terms, limit: 50 });
      all.push(...works);

      results.push({
        field,
        total: works.length,
        withOaPdf: works.filter((w) => w.oaPdfUrl).length,
        // NOT an independent measure. Both this and `withOaPdf` derive from
        // OpenAlex's `is_oa`, so they agree by construction — kept only to
        // make that fact visible in the output rather than implied.
        freeToRead: works.filter((w) => w.oaStatus && w.oaStatus !== "closed").length,
      });

      // Politeness between searches, well inside OpenAlex's limits.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const merged = dedupe(all);
    const total = merged.length;
    const withPdf = merged.filter((w) => w.oaPdfUrl).length;
    const rate = total === 0 ? 0 : withPdf / total;

    console.log("\n  R-04 — open-access rate by field\n");
    console.log("  field                 works   with PDF   oa_status≠closed");
    for (const r of results) {
      const pdfPct = r.total === 0 ? 0 : (r.withOaPdf / r.total) * 100;
      const freePct = r.total === 0 ? 0 : (r.freeToRead / r.total) * 100;
      console.log(
        `  ${r.field.padEnd(20)} ${String(r.total).padStart(5)}   ` +
          `${pdfPct.toFixed(0).padStart(7)}%   ${freePct.toFixed(0).padStart(11)}%`,
      );
    }
    console.log(
      `\n  Overall (deduplicated, n=${total}): ` +
        `${(rate * 100).toFixed(1)}% report an open-access PDF`,
    );
    console.log(`  The cost model assumes 45%.`);
    console.log(
      "\n  UPPER BOUND, not the redistributable share. This is OpenAlex's\n" +
        "  is_oa flag, which says a copy is free to read — it does not check\n" +
        "  the LICENCE, and R-04 only permits R2_SHARED for files verified\n" +
        "  redistributable. Confirming that needs Unpaywall, which is a\n" +
        "  Phase 2 integration. Treat this as a ceiling.\n",
    );

    // The sample has to be big enough to mean anything.
    expect(total).toBeGreaterThan(100);

    // Deliberately NOT asserting the rate is >= 45%. This test exists to
    // produce a number, not to defend one — an assertion here would turn a
    // measurement into a thing that gets adjusted until it passes.
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
  }, 180_000);
});
