import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env automatically. Node 24 can do it natively,
// so this stays dependency-free. CI supplies env directly and has no file.
const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

/**
 * Prisma 7 config.
 *
 * `DIRECT_URL` (port 5432) is used for migrations and introspection:
 * `migrate deploy` issues `SET session_replication_role` and CANNOT run
 * through Supavisor's transaction pooler. `DATABASE_URL` (port 6543) is the
 * pooled runtime connection used by the client.
 *
 * See docs/01-data-model.md §5 and docs/05-resolution-plan.md R-02.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations always take the direct connection.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
