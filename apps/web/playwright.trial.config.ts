import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

for (const candidate of [".env.local", "../../.env"]) {
  const envPath = resolve(process.cwd(), candidate);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
    break;
  }
}

/**
 * The Phase 1 exit trial, kept out of the normal e2e run.
 *
 * It signs up four accounts, imports 300 papers, and screens concurrently —
 * minutes, not seconds, and it needs a corpus fetched from OpenAlex first.
 * Putting it in CI would make every pull request wait on someone else's API.
 *
 * One worker and one project: the point is four members inside ONE browser
 * run, not the same script replayed on two viewports.
 */
export default defineConfig({
  testDir: "./trial",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 900_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "trial", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
