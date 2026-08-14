import { dedupe } from "./dedupe";
import { arxiv } from "./providers/arxiv";
import { crossref } from "./providers/crossref";
import { europepmc } from "./providers/europepmc";
import { openalex } from "./providers/openalex";
import { semanticscholar } from "./providers/semanticscholar";
import type {
  FederatedResult,
  Provider,
  ProviderFailure,
  ProviderId,
  RateLimiter,
  SearchQuery,
} from "./types";

export const PROVIDERS: Record<ProviderId, Provider> = {
  openalex,
  crossref,
  arxiv,
  europepmc,
  semanticscholar,
};

/**
 * A limiter for local development and tests, where there is no database.
 *
 * Deliberately in-process and therefore WRONG for production — that is the
 * entire point of R-22. It exists so unit tests do not need Postgres, and it
 * says so loudly rather than being quietly swapped in one day.
 */
export class InProcessRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updated: number }>();

  take(
    key: string,
    limit: { capacity: number; refillPerSecond: number },
  ): Promise<number> {
    const now = Date.now() / 1000;
    const bucket = this.buckets.get(key) ?? { tokens: limit.capacity, updated: now };

    const elapsed = Math.max(0, now - bucket.updated);
    const tokens = Math.min(
      limit.capacity,
      bucket.tokens + elapsed * limit.refillPerSecond,
    );

    if (tokens >= 1) {
      this.buckets.set(key, { tokens: tokens - 1, updated: now });
      return Promise.resolve(0);
    }

    this.buckets.set(key, { tokens, updated: now });
    return Promise.resolve((1 - tokens) / limit.refillPerSecond);
  }
}

export interface FederatedSearchOptions {
  providers?: ProviderId[];
  limiter?: RateLimiter;
  /** Give up on a single provider after this long. */
  perProviderTimeoutMs?: number;
  /**
   * How long to wait for a rate-limit token before giving up on a provider.
   * arXiv's 3-second spacing means a real wait is normal here.
   */
  maxRateLimitWaitMs?: number;
  /**
   * Override the provider registry. Exists so the partial-failure behaviour
   * can be tested with a provider that reliably fails — testing it against
   * the real five would mean waiting for one of them to have a bad day.
   */
  registry?: Partial<Record<ProviderId, Provider>>;
}

/**
 * Search every provider at once and merge the results.
 *
 * PARTIAL FAILURE IS THE DESIGN POINT. Five providers means five chances for
 * something to be down, rate-limited, or slow. A user searching for their
 * thesis topic wants the four sets of results that came back, with a note
 * about the fifth — not an error page because Semantic Scholar was busy.
 *
 * So every provider is settled independently and failures are returned as
 * data. The only way this throws is if the caller passes an unknown provider
 * id, which is a programming error rather than a runtime condition.
 */
export async function federatedSearch(
  query: SearchQuery,
  options: FederatedSearchOptions = {},
): Promise<FederatedResult> {
  const registry = options.registry ?? PROVIDERS;
  const ids = options.providers ?? (Object.keys(registry) as ProviderId[]);
  const limiter = options.limiter ?? new InProcessRateLimiter();
  const perProviderTimeoutMs = options.perProviderTimeoutMs ?? 15_000;
  const maxRateLimitWaitMs = options.maxRateLimitWaitMs ?? 5_000;

  const failures: ProviderFailure[] = [];

  const settled = await Promise.all(
    ids.map(async (id) => {
      const provider = registry[id];
      if (!provider) throw new Error(`unknown provider: ${id}`);

      try {
        const wait = await limiter.take(`provider:${id}`, provider.rateLimit);

        if (wait > 0) {
          const waitMs = wait * 1000;
          if (waitMs > maxRateLimitWaitMs) {
            // Skipping is the honest outcome: holding the user's search open
            // for arXiv's turn would make every search as slow as the
            // slowest provider.
            failures.push({
              provider: id,
              message: `rate limited — would have waited ${wait.toFixed(1)}s`,
            });
            return [];
          }
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }

        return await withTimeout(provider.search(query), perProviderTimeoutMs, id);
      } catch (error) {
        failures.push({
          provider: id,
          message: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    }),
  );

  return { works: dedupe(settled.flat()), failures };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
