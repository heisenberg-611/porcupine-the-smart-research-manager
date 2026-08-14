import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Playwright does not load .env, and it compiles this config to CJS — so no
// import.meta here. The e2e suite needs the secret key to provision an
// invitee via the auth admin API: the only use of that key outside
// src/server, and only in test setup.
for (const candidate of [".env.local", "../../.env"]) {
  const envPath = resolve(process.cwd(), candidate);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
    break;
  }
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Omitted rather than set to undefined: exactOptionalPropertyTypes treats
  // "absent" and "explicitly undefined" as different things, correctly.
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [["html"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Responsive is a stated requirement (desktop, tablet, mobile), so the
    // a11y gate runs on a phone viewport too — touch targets and reflow
    // violations only appear there.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm start",
    url: "http://127.0.0.1:3000",
    // Never reuse whatever happens to be on port 3000.
    //
    // `reuseExistingServer: !process.env.CI` looks harmless and is not: a
    // `pnpm dev` left running locally gets silently adopted, so the suite
    // tests a stale Turbopack dev build instead of the production build it
    // just made. The symptom is 403s on client chunks, no hydration, and
    // every interactive test timing out with an error that names none of
    // that — which cost a long debugging session to trace back to a
    // forgotten terminal tab.
    //
    // Playwright fails fast with "port 3000 is used" instead, which is a
    // sentence someone can act on.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
