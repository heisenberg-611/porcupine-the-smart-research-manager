import { describe, expect, it } from "vitest";

import {
  __testing as arxivInternals,
  arxiv,
  arxivUserAgent,
} from "../src/providers/arxiv";
import { stripJats } from "../src/providers/crossref";
import { splitAuthorString } from "../src/providers/europepmc";
import { rebuildAbstract } from "../src/providers/openalex";
import { federatedSearch, InProcessRateLimiter } from "../src/search";
import type { Provider, WorkInput } from "../src/types";

/**
 * Parsing is tested against recorded payload shapes rather than live calls.
 * A test that hits five real APIs fails when someone else has an outage,
 * which trains everyone to ignore it.
 *
 * The live-network coverage that IS worth having lives in ssrf.spec.ts, where
 * DNS resolution is the thing under test and mocking it would prove nothing.
 */

describe("OpenAlex inverted-index abstracts", () => {
  it("rebuilds word order from positions", () => {
    // OpenAlex ships abstracts inverted to sidestep publisher restrictions on
    // redistributing abstract text. The format is a licensing artefact.
    expect(
      rebuildAbstract({ The: [0], immune: [1], response: [2], of: [3], mice: [4] }),
    ).toBe("The immune response of mice");
  });

  it("handles a word appearing more than once", () => {
    expect(rebuildAbstract({ a: [0, 2], b: [1] })).toBe("a b a");
  });

  it("returns null rather than an empty string when absent", () => {
    expect(rebuildAbstract(undefined)).toBeNull();
    expect(rebuildAbstract({})).toBeNull();
  });
});

describe("Crossref JATS abstracts", () => {
  it("strips XML tags", () => {
    expect(
      stripJats("<jats:p>The <jats:italic>effect</jats:italic> was large.</jats:p>"),
    ).toBe("The effect was large.");
  });

  it("decodes entities after stripping", () => {
    expect(stripJats("<jats:p>a &amp; b</jats:p>")).toBe("a & b");
  });

  it("returns null for missing or empty input", () => {
    expect(stripJats(undefined)).toBeNull();
    expect(stripJats("<jats:p></jats:p>")).toBeNull();
  });
});

describe("Europe PMC author strings", () => {
  it("splits on commas", () => {
    const authors = splitAuthorString("Smith J, Jones AB, Lee C.");
    expect(authors.map((a) => a.name)).toEqual(["Smith J", "Jones AB", "Lee C"]);
    expect(authors[0]?.position).toBe(0);
  });

  it("returns an empty list rather than a phantom author", () => {
    expect(splitAuthorString(undefined)).toEqual([]);
    expect(splitAuthorString("")).toEqual([]);
  });
});

describe("arXiv Atom parsing", () => {
  const entry = `
    <entry>
      <id>http://arxiv.org/abs/2401.01234v2</id>
      <title>Deep
        Learning for Genomics</title>
      <summary>We present a &lt;method&gt; for prediction.</summary>
      <published>2024-01-15T00:00:00Z</published>
      <author><name>Jane Smith</name></author>
      <author><name>Bo Lee</name></author>
      <arxiv:doi>10.1000/xyz123</arxiv:doi>
    </entry>`;

  it("extracts identifiers, dropping the version", () => {
    const parsed = arxivInternals.entryToWorkInput(entry);
    expect(parsed?.arxivId).toBe("2401.01234");
    expect(parsed?.doi).toBe("10.1000/xyz123");
  });

  it("normalizes the line-wrapped title arXiv actually sends", () => {
    // This is the real-world case behind the whitespace-ordering fix in
    // normalizeTitle: arXiv wraps titles across lines.
    const parsed = arxivInternals.entryToWorkInput(entry);
    expect(parsed?.title).toBe("Deep Learning for Genomics");
  });

  it("decodes entities in the abstract", () => {
    const parsed = arxivInternals.entryToWorkInput(entry);
    expect(parsed?.abstract).toBe("We present a <method> for prediction.");
  });

  it("decodes &amp;lt; to &lt; and not to <", () => {
    // Ordering trap: decoding &amp; first turns "&amp;lt;" into "<".
    expect(arxivInternals.decodeEntities("&amp;lt;")).toBe("&lt;");
  });

  it("reads both authors in order", () => {
    const parsed = arxivInternals.entryToWorkInput(entry);
    expect(parsed?.authors.map((a) => a.name)).toEqual(["Jane Smith", "Bo Lee"]);
  });

  it("marks the record as an open-access preprint", () => {
    const parsed = arxivInternals.entryToWorkInput(entry);
    expect(parsed?.type).toBe("preprint");
    expect(parsed?.oaPdfUrl).toBe("https://arxiv.org/pdf/2401.01234");
  });

  it("skips an entry with no title rather than throwing", () => {
    expect(arxivInternals.entryToWorkInput("<entry><id>x</id></entry>")).toBeNull();
  });

  it("asks for one request every three seconds", () => {
    expect(arxiv.rateLimit).toEqual({ capacity: 1, refillPerSecond: 1 / 3 });
  });

  it("sets a descriptive custom User-Agent identifying Porcupine", () => {
    expect(arxivUserAgent()).toMatch(/^Porcupine\/0\.1 \(/);
    expect(arxivUserAgent()).toContain("github.com/heisenberg-611/porcupine");
  });
});

describe("InProcessRateLimiter queuing", () => {
  it("queues concurrent callers sequentially to prevent thundering herds", async () => {
    const limiter = new InProcessRateLimiter();
    const limit = { capacity: 1, refillPerSecond: 1 / 3 }; // 3s per request

    const wait1 = await limiter.take("provider:arxiv", limit);
    const wait2 = await limiter.take("provider:arxiv", limit);
    const wait3 = await limiter.take("provider:arxiv", limit);

    expect(wait1).toBe(0);
    expect(wait2).toBeCloseTo(3, 0.5);
    expect(wait3).toBeCloseTo(6, 0.5);
  });
});

describe("federated search partial failure", () => {
  const ok: Provider = {
    id: "openalex",
    label: "Fake OK",
    rateLimit: { capacity: 10, refillPerSecond: 10 },
    search: () =>
      Promise.resolve([
        {
          doi: "10.1/a",
          title: "A Paper",
          authors: [],
          citedByCount: 1,
          referencedWorks: [],
        } as unknown as WorkInput,
      ]),
  };

  const broken: Provider = {
    id: "crossref",
    label: "Fake broken",
    rateLimit: { capacity: 10, refillPerSecond: 10 },
    search: () => Promise.reject(new Error("503 Service Unavailable")),
  };

  const slow: Provider = {
    id: "arxiv",
    label: "Fake slow",
    rateLimit: { capacity: 10, refillPerSecond: 10 },
    search: () => new Promise(() => {}), // never settles
  };

  it("returns results from the providers that worked", async () => {
    const result = await federatedSearch(
      { terms: "x" },
      {
        registry: { openalex: ok, crossref: broken },
        limiter: new InProcessRateLimiter(),
      },
    );

    expect(result.works).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ provider: "crossref" });
    expect(result.failures[0]?.message).toMatch(/503/);
  });

  it("does not let one slow provider hold the search open", async () => {
    const started = Date.now();
    const result = await federatedSearch(
      { terms: "x" },
      {
        registry: { openalex: ok, arxiv: slow },
        limiter: new InProcessRateLimiter(),
        perProviderTimeoutMs: 200,
      },
    );

    expect(Date.now() - started).toBeLessThan(2000);
    expect(result.works).toHaveLength(1);
    expect(result.failures[0]?.message).toMatch(/timed out/);
  });

  it("reports rate-limited providers as failures rather than stalling", async () => {
    const limiter = new InProcessRateLimiter();
    const stingy: Provider = {
      ...ok,
      id: "openalex",
      rateLimit: { capacity: 1, refillPerSecond: 0.01 },
    };

    // Drain the single token.
    await limiter.take("provider:openalex", stingy.rateLimit);

    const result = await federatedSearch(
      { terms: "x" },
      { registry: { openalex: stingy }, limiter, maxRateLimitWaitMs: 10 },
    );

    expect(result.works).toHaveLength(0);
    expect(result.failures[0]?.message).toMatch(/rate limited/);
  });

  it("succeeds with zero failures when everything works", async () => {
    const result = await federatedSearch(
      { terms: "x" },
      { registry: { openalex: ok }, limiter: new InProcessRateLimiter() },
    );
    expect(result.failures).toEqual([]);
  });
});
