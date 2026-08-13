import "server-only";

/**
 * The only module in the web app permitted to import Prisma.
 *
 * ESLint blocks `@porcupine/db` and `@prisma/client` everywhere else, so all
 * database access funnels through here and cannot route around
 * `withUserContext`. `server-only` makes an accidental client import a build
 * error rather than a runtime leak.
 *
 * Rule of thumb (docs/05-resolution-plan.md R-02):
 *   • user-scoped reads  → supabase-js (JWT per request, no session state)
 *   • trusted writes and anything transactional → withUserContext()
 */
export { prisma, withUserContext } from "@porcupine/db";
export type { UserClaims, TxClient } from "@porcupine/db";
