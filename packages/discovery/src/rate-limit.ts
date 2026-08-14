import type { RateLimit, RateLimiter } from "./types.js";

/**
 * The production limiter: the Postgres token bucket from R-22.
 *
 * Takes a query function rather than a Prisma client so this package stays
 * free of a database dependency — it is imported by provider adapters that
 * have no business knowing what an ORM is.
 */
export type QueryFn = (
  sql: string,
  params: unknown[],
) => Promise<Array<{ wait: number }>>;

export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly query: QueryFn) {}

  async take(key: string, limit: RateLimit): Promise<number> {
    const rows = await this.query("select public.rate_limit_take($1, $2, $3) as wait", [
      key,
      limit.capacity,
      limit.refillPerSecond,
    ]);
    return Number(rows[0]?.wait ?? 0);
  }
}
