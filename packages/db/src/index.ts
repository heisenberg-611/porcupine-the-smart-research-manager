/**
 * @porcupine/db — Prisma client and the RLS-safe access helper.
 *
 * ⚠️  Importing this package anywhere but a web app's `src/server/db`
 * directory is an ESLint error.
 *
 * Prisma connects as `porcupine_app` and, without a claim set, RLS
 * returns zero rows — the failure mode is fail-closed, but a query that
 * forgets `withUserContext` will simply appear broken rather than insecure.
 *
 * See docs/05-resolution-plan.md R-02.
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/client/client.js";

export * from "../generated/client/client.js";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // Prisma 7 requires a driver adapter. `pg` pools inside the process;
  // Supavisor pools in front of Postgres. Keep the local pool small — on
  // Vercel each function instance holds its own.
  const adapter = new PrismaPg({ connectionString, max: 5 });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

/**
 * Service-context client. Bypasses nothing — `porcupine_app` has no
 * BYPASSRLS — but carries no user claim either, so under RLS it sees
 * nothing until a claim is set. Use `withUserContext` for user-scoped work.
 *
 * Constructed lazily on first property access. Eager construction meant that
 * merely *importing* a module — which Next does when collecting page data at
 * build time — required a live DATABASE_URL. It also opened a connection
 * pool in every serverless instance that imported the module without ever
 * querying.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    globalForPrisma.prisma ??= createClient();
    return Reflect.get(globalForPrisma.prisma, prop, receiver) as unknown;
  },
});

/** Minimal shape of the JWT claims Postgres policies read. */
export interface UserClaims {
  sub: string;
  role?: string;
  email?: string;
}

/**
 * The transaction handle handed to `withUserContext` callbacks. Derived from
 * Prisma's own `$transaction` signature so it tracks the client version
 * rather than drifting from a hand-written Omit.
 */
export type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Runs `fn` inside a transaction whose `request.jwt.claims` GUC is set to
 * `claims`, so every RLS policy evaluates against that user.
 *
 * The third argument to `set_config` is `true`, meaning `SET LOCAL`:
 * **Postgres itself reverts the value at commit or rollback.** The isolation
 * guarantee therefore comes from the database, not from Supavisor's
 * connection handling — which is what makes this safe under a transaction
 * pooler. With no claim set, policy predicates evaluate NULL and every row
 * is filtered: the failure mode is fail-closed.
 *
 * This is the ONLY place `set_config` may appear. CI greps for violations.
 * See docs/05-resolution-plan.md R-02.
 */
export async function withUserContext<T>(
  claims: UserClaims,
  fn: (tx: TxClient) => Promise<T>,
  client: PrismaClient = prisma,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('request.jwt.claims', ${JSON.stringify(
      claims,
    )}, true)`;
    return fn(tx as TxClient);
  });
}
