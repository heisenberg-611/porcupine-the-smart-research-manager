import "server-only";

import { PostgresRateLimiter } from "@Porcupine/discovery";

import { prisma } from "./db";

/**
 * The production rate limiter, backed by the Postgres token bucket (R-22).
 *
 * This is the whole point of R-22: Vercel runs the app as Lambda functions
 * with no shared memory, so the in-process limiter that ships with
 * @Porcupine/discovery would be a per-invocation counter. Ten concurrent
 * functions would issue ten times the rate we agreed with arXiv, and the
 * first we would hear about it is a block.
 *
 * `$queryRawUnsafe` is used with a parameterised call — the SQL string is a
 * constant here and every value is bound, so there is no interpolation.
 */
export const rateLimiter = new PostgresRateLimiter(async (sql, params) => {
  return prisma.$queryRawUnsafe<Array<{ wait: number }>>(sql, ...params);
});
