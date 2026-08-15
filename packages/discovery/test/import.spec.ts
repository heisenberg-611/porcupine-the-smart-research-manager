import { describe, expect, it } from "vitest";

import {
  deLatex,
  detectFormat,
  extractIdentifiers,
  importBibtex,
  importRis,
  parseBibtex,
  parseImport,
  parseRis,
  splitBibtexAuthors,
} from "../src/import";
import { parseWorkInput } from "../src/types";

/**
 * These fixtures are shaped like real exports, not like the tidy examples in
 * format documentation. Zotero, Mendeley, Google Scholar and journal sites
 * all disagree about the details, and the disagreements are the whole
 * difficulty — a parser that only handles the documentation is a parser that
 * fails on every file a user actually has.
 */

describe("deLatex", () => {
  it("resolves accents in both spellings", () => {
    expect(deLatex('Sch{\\"o}nberg')).toBe("Schönberg");
    expect(deLatex('Sch\\"{o}nberg')).toBe("Schönberg");
    expect(deLatex("Erd\\H{o}s")).toBe("Erdős");
    expect(deLatex("Fran\\c{c}ois")).toBe("François");
  });

  it("unescapes symbols", () => {
    expect(deLatex("Smith \\& Jones")).toBe("Smith & Jones");
    expect(deLatex("50\\% of cases")).toBe("50% of cases");
  });

  it("converts dashes", () => {
    expect(deLatex("pages 10--20")).toBe("pages 10–20");
    expect(deLatex("a --- b")).toBe("a — b");
  });

  it("strips capitalization-protecting braces but keeps the text", () => {
    // The braces exist so BibTeX does not lowercase DNA. Once the value is
    // plain text they carry no meaning — but the letters must survive.
    expect(deLatex("The {DNA} Structure")).toBe("The DNA Structure");
  });

  it("removes formatting commands without eating the next word", () => {
    expect(deLatex("An \\emph{important} result")).toBe("An important result");
  });
});

describe("parseBibtex", () => {
  it("reads nested braces without truncating the title", () => {
    // The classic failure: a regex stopping at the first `}` yields
    // "The {DNA" and mangles every chemistry and genetics title.
    const { entries } = parseBibtex(`
      @article{smith2020,
        title = {The {DNA} Structure of {E. coli}},
        author = {Smith, Jane},
        year = {2020}
      }
    `);

    expect(entries[0]?.fields.title).toBe("The DNA Structure of E. coli");
  });

  it("reads quoted values", () => {
    const { entries } = parseBibtex(`@article{k, title = "A Quoted Title", year = 1999}`);
    expect(entries[0]?.fields.title).toBe("A Quoted Title");
    expect(entries[0]?.fields.year).toBe("1999");
  });

  it("resolves @string macros and # concatenation", () => {
    const { entries } = parseBibtex(`
      @string{jgr = "Journal of Great Research"}
      @article{k, journal = jgr # " (Special Issue)", title = {T}}
    `);

    expect(entries[0]?.fields.journal).toBe("Journal of Great Research (Special Issue)");
  });

  it("ignores @comment and @preamble", () => {
    const { entries } = parseBibtex(`
      @comment{ this is ignored }
      @article{k, title = {Real}}
    `);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.key).toBe("k");
  });

  it("skips a broken entry instead of rejecting the file", () => {
    // Someone pasting 200 references does not want one stray brace to reject
    // the other 199.
    const { entries, problems } = parseBibtex(`
      @article{good1, title = {First}}
      @article{good2, title = {Second}}
      @article{broken, title = {Unclosed
    `);

    expect(entries.map((e) => e.key)).toEqual(["good1", "good2"]);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("handles an entry with no fields", () => {
    const { entries } = parseBibtex(`@misc{lonely}`);
    expect(entries[0]).toMatchObject({ key: "lonely", fields: {} });
  });

  it("reads a realistic multi-entry export", () => {
    const { entries, problems } = parseBibtex(`
      @inproceedings{vaswani2017attention,
        title     = {Attention Is All You Need},
        author    = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
        booktitle = {Advances in Neural Information Processing Systems},
        year      = {2017},
        eprint    = {1706.03762}
      }

      @article{devlin2019bert,
        title   = {{BERT}: Pre-training of Deep Bidirectional Transformers},
        author  = {Devlin, Jacob and Chang, Ming-Wei},
        journal = {NAACL},
        year    = {2019},
        doi     = {10.18653/v1/N19-1423}
      }
    `);

    expect(problems).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.fields.title).toBe(
      "BERT: Pre-training of Deep Bidirectional Transformers",
    );
  });
});

describe("splitBibtexAuthors", () => {
  it("splits on the literal ' and '", () => {
    expect(splitBibtexAuthors("Smith, Jane and Doe, John")).toEqual([
      "Smith, Jane",
      "Doe, John",
    ]);
  });

  it("does not split a name containing 'and' as a substring", () => {
    expect(splitBibtexAuthors("Andrews, Sandra")).toEqual(["Andrews, Sandra"]);
    expect(splitBibtexAuthors("Alexander, Ann")).toEqual(["Alexander, Ann"]);
  });

  it("returns nothing for an empty field", () => {
    expect(splitBibtexAuthors("")).toEqual([]);
  });
});

describe("importBibtex", () => {
  it("maps to WorkInput with identifiers normalized", () => {
    const { entries } = importBibtex(`
      @article{k,
        title = {A Paper},
        author = {Smith, Jane and Doe, John},
        journal = {Nature},
        year = {2020},
        doi = {https://doi.org/10.1038/ABC123},
        eprint = {2401.01234v2}
      }
    `);

    const work = entries[0];
    expect(work?.doi).toBe("10.1038/abc123");
    expect(work?.arxivId).toBe("2401.01234");
    expect(work?.publishedYear).toBe(2020);
    expect(work?.venue).toBe("Nature");
    expect(work?.authors.map((a) => a.name)).toEqual(["Smith, Jane", "Doe, John"]);
  });

  it("never trusts an imported file as evidence of open access", () => {
    // R-04: only a provider that verified redistributability may set this.
    const { entries } = importBibtex(`@article{k, title={T}, url={http://x/p.pdf}}`);
    expect(entries[0]?.oaPdfUrl).toBeNull();
  });

  it("reports an entry with no title rather than importing a blank", () => {
    const { entries, problems } = importBibtex(`@article{notitle, author = {Smith, J}}`);
    expect(entries).toHaveLength(0);
    expect(problems[0]).toMatch(/no title/i);
  });
});

describe("parseRis", () => {
  const sample = `TY  - JOUR
AU  - Smith, Jane
AU  - Doe, John
TI  - Deep Learning for Genomics
JO  - Nature Methods
PY  - 2021
DO  - 10.1038/s41592-021-01234
AB  - This is a long abstract that
wraps onto a second line without a tag.
ER  -

TY  - CONF
TI  - A Conference Paper
PY  - 2019
ER  -
`;

  it("reads records and accumulates repeated tags", () => {
    const { entries } = parseRis(sample);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.fields.AU).toEqual(["Smith, Jane", "Doe, John"]);
  });

  it("joins continuation lines", () => {
    const { entries } = parseRis(sample);
    expect(entries[0]?.fields.AB?.[0]).toBe(
      "This is a long abstract that wraps onto a second line without a tag.",
    );
  });

  it("keeps a record whose ER tag is missing", () => {
    // A missing ER is a common exporter bug. Discarding an otherwise
    // complete record over it helps nobody.
    const { entries, problems } = parseRis(`TY  - JOUR\nTI  - No Ending\nPY  - 2020\n`);
    expect(entries).toHaveLength(1);
    expect(problems[0]).toMatch(/no ER tag/i);
  });

  it("accepts a single space before the hyphen", () => {
    const { entries } = parseRis(`TY - JOUR\nTI - Loose Spacing\nER - \n`);
    expect(entries[0]?.fields.TI?.[0]).toBe("Loose Spacing");
  });
});

describe("importRis", () => {
  it("maps to WorkInput", () => {
    const { entries } = importRis(
      `TY  - JOUR\nTI  - A Title\nAU  - Smith, J\nPY  - 2021\nDO  - 10.1038/xyz\nER  - \n`,
    );

    expect(entries[0]).toMatchObject({
      title: "A Title",
      doi: "10.1038/xyz",
      publishedYear: 2021,
      type: "article",
    });
  });

  it("picks up an arXiv id from a UR link", () => {
    const { entries } = importRis(
      `TY  - JOUR\nTI  - Preprint\nUR  - https://arxiv.org/abs/2401.01234v1\nER  - \n`,
    );
    expect(entries[0]?.arxivId).toBe("2401.01234");
  });
});

describe("detectFormat", () => {
  it("recognizes RIS", () => {
    expect(detectFormat("TY  - JOUR\nTI  - x\nER  - ")).toBe("ris");
  });

  it("recognizes BibTeX", () => {
    expect(detectFormat("@article{k, title={x}}")).toBe("bibtex");
  });

  it("falls back to identifiers", () => {
    expect(detectFormat("10.1038/abc\n10.1038/def")).toBe("identifiers");
  });

  it("does not mistake an email in a RIS abstract for BibTeX", () => {
    expect(detectFormat("TY  - JOUR\nAB  - Contact a@b.com for data\nER  - ")).toBe(
      "ris",
    );
  });
});

describe("extractIdentifiers", () => {
  it("pulls DOIs out of a numbered list", () => {
    const { dois } = extractIdentifiers(`
      1. 10.1038/abc123
      2. https://doi.org/10.1101/xyz789
      3. doi:10.5555/qwe456
    `);

    expect(dois).toEqual(["10.1038/abc123", "10.1101/xyz789", "10.5555/qwe456"]);
  });

  it("strips prose punctuation around an identifier", () => {
    const { dois } = extractIdentifiers("see (10.1038/abc123), and also 10.1038/def456.");
    expect(dois).toEqual(["10.1038/abc123", "10.1038/def456"]);
  });

  it("separates arXiv ids from DOIs", () => {
    const { dois, arxivIds } = extractIdentifiers(
      "10.1038/abc arXiv:2401.01234 2402.05678",
    );
    expect(dois).toEqual(["10.1038/abc"]);
    expect(arxivIds).toEqual(["2401.01234", "2402.05678"]);
  });

  it("deduplicates", () => {
    const { dois } = extractIdentifiers(
      "10.1038/abc 10.1038/ABC https://doi.org/10.1038/abc",
    );
    expect(dois).toEqual(["10.1038/abc"]);
  });

  it("reports plausible-looking tokens but stays quiet about prose", () => {
    const { unrecognized } = extractIdentifiers("the 10.1038/abc paper and some words");
    expect(unrecognized).toEqual([]);
  });
});

describe("parseImport", () => {
  it("returns works directly for BibTeX", () => {
    const result = parseImport("@article{k, title={A Paper}, year={2020}}");
    expect(result.format).toBe("bibtex");
    expect(result.entries).toHaveLength(1);
    expect(result.lookups.dois).toEqual([]);
  });

  it("returns lookups for a bare identifier list", () => {
    // A DOI carries no metadata, so it becomes a provider lookup — which is
    // both more accurate than anything pasted and how the record gets an
    // abstract and citation count.
    const result = parseImport("10.1038/abc123");
    expect(result.format).toBe("identifiers");
    expect(result.entries).toEqual([]);
    expect(result.lookups.dois).toEqual(["10.1038/abc123"]);
  });

  it("handles empty input without throwing", () => {
    const result = parseImport("   ");
    expect(result.entries).toEqual([]);
    expect(result.lookups.dois).toEqual([]);
  });
});

describe("deLatex nesting", () => {
  it("unwraps nested formatting commands", () => {
    expect(deLatex("A \\textbf{\\emph{very} good} result")).toBe("A very good result");
  });

  it("keeps an accented letter inside a formatting command", () => {
    expect(deLatex('\\emph{Sch{\\"o}nberg}')).toBe("Schönberg");
  });
});

describe("the boundary check", () => {
  /**
   * `workInputSchema` sat in this package for months deriving a type and
   * validating nothing, which is how five external APIs and any pasted file
   * reached `upsert_work()` with only a compile-time cast between them and the
   * database. These assertions exist so that cannot quietly become true again.
   */
  it("accepts a well-formed work", () => {
    expect(
      parseWorkInput({
        title: "A perfectly ordinary paper",
        authors: [{ name: "Okonkwo, A." }],
        publishedYear: 2021,
      }),
    ).not.toBeNull();
  });

  it("rejects a work with no title", () => {
    // The single most common shape of a bad record: a provider answering 200
    // with an error document, or a converter that found no title field.
    expect(parseWorkInput({ title: "", authors: [] })).toBeNull();
    expect(parseWorkInput({ authors: [] })).toBeNull();
  });

  it("rejects an impossible publication year", () => {
    // 20024 is a typo away from 2002 and survives every type check there is.
    expect(parseWorkInput({ title: "Ok", authors: [], publishedYear: 20024 })).toBeNull();
  });

  it("rejects authors that are not a list of authors", () => {
    expect(parseWorkInput({ title: "Ok", authors: "Okonkwo, A." })).toBeNull();
    expect(parseWorkInput({ title: "Ok", authors: [{ nome: "wrong key" }] })).toBeNull();
  });

  it("reports a rejected entry rather than dropping it silently", () => {
    // The import path's contract: one bad record costs that record, and the
    // person is told which. Silence would leave them counting rows.
    const { entries, problems } = importBibtex(`
      @article{good, title = {A real title}, author = {Okonkwo, A.}, year = {2021}}
      @article{bad, author = {Nobody}, year = {2021}}
    `);

    expect(entries).toHaveLength(1);
    expect(problems.join(" ")).toMatch(/bad/);
  });
});
