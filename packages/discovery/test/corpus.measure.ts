import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { dedupe } from "../src/dedupe";
import { openalex } from "../src/providers/openalex";
import type { WorkInput } from "../src/types";

/**
 * Builds the 300-paper corpus for the Phase 1 exit trial.
 *
 *     pnpm --filter @porcupine/discovery measure:corpus
 *
 * Real papers, not generated ones. A synthetic corpus would have uniform
 * title lengths, no missing abstracts, no duplicate preprints, and no
 * unicode — precisely the properties that make a library easy to render and
 * a dedupe pass easy to pass. The awkwardness is the point.
 *
 * Output is BibTeX rather than a database seed so the trial exercises the
 * real import path — parse, dedupe, upsert_work, RLS — instead of writing
 * rows behind it. Generated on demand and gitignored: 300 abstracts is a
 * large blob to carry in the repo, and it should be re-fetched rather than
 * left to rot.
 */

const TARGET = 300;

const SEARCHES = [
  "randomised controlled trial cardiovascular outcomes",
  "transformer architecture language model",
  "postcolonial literature narrative theory",
  "survey methodology response bias",
  "quantum error correction surface code",
  "species distribution climate change modelling",
];

/** Escape the characters that would break the BibTeX we are about to parse. */
function bib(value: string): string {
  return value.replace(/[{}\\]/g, "").replace(/[&%$#_]/g, (c) => `\\${c}`);
}

function toBibtex(work: WorkInput, index: number): string {
  const key = `trial${index}`;
  const fields: string[] = [`title = {${bib(work.title)}}`];

  if (work.authors.length > 0) {
    fields.push(`author = {${work.authors.map((a) => bib(a.name)).join(" and ")}}`);
  }
  if (work.venue) fields.push(`journal = {${bib(work.venue)}}`);
  if (work.publishedYear) fields.push(`year = {${work.publishedYear}}`);
  if (work.doi) fields.push(`doi = {${work.doi}}`);
  if (work.arxivId) fields.push(`eprint = {${work.arxivId}}`);
  if (work.abstract) {
    // Trimmed: 300 full abstracts blow past the import size cap, and the
    // trial is about volume of records rather than volume of prose.
    fields.push(`abstract = {${bib(work.abstract.slice(0, 400))}}`);
  }

  return `@article{${key},\n  ${fields.join(",\n  ")}\n}`;
}

describe("Phase 1 exit trial corpus", () => {
  it("builds a 300-paper BibTeX corpus from real works", async () => {
    const collected: WorkInput[] = [];

    for (const terms of SEARCHES) {
      // OpenAlex caps per-page at 200; 60 per search across six searches
      // overshoots 300 so there is room for duplicates to be removed.
      const works = await openalex.search({ terms, limit: 60 });
      collected.push(...works);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    const merged = dedupe(collected);
    const corpus = merged.slice(0, TARGET);

    const outDir = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "fixtures",
    );
    mkdirSync(outDir, { recursive: true });

    // Two files: the import path caps a single paste at 400 KB, and
    // importing in batches is what a person with 300 references does
    // anyway.
    const half = Math.ceil(corpus.length / 2);
    const batches = [corpus.slice(0, half), corpus.slice(half)];

    batches.forEach((batch, batchIndex) => {
      const body = batch
        .map((work, i) => toBibtex(work, batchIndex * half + i))
        .join("\n\n");
      const path = join(outDir, `trial-corpus-${batchIndex + 1}.bib`);
      writeFileSync(path, `${body}\n`);
      const kb = (Buffer.byteLength(body, "utf8") / 1024).toFixed(0);
      console.log(
        `  wrote ${path.split("/").slice(-2).join("/")} — ${batch.length} entries, ${kb} KB`,
      );
    });

    const withAbstract = corpus.filter((w) => w.abstract).length;
    const withDoi = corpus.filter((w) => w.doi).length;

    console.log(`\n  corpus: ${corpus.length} papers`);
    console.log(
      `  with abstract: ${withAbstract} (${((withAbstract / corpus.length) * 100).toFixed(0)}%)`,
    );
    console.log(
      `  with DOI:      ${withDoi} (${((withDoi / corpus.length) * 100).toFixed(0)}%)`,
    );
    console.log(
      `  deduplicated away: ${collected.length - merged.length} of ${collected.length}\n`,
    );

    expect(corpus.length).toBe(TARGET);
    // Every entry must be importable, or the trial measures the wrong thing.
    expect(corpus.every((w) => w.title.trim().length > 0)).toBe(true);
  }, 240_000);
});
