import { defineConfig, devices } from "@playwright/test";

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
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
