import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e/ belongs to Playwright. Without this, vitest tries to run the
    // Playwright specs and fails on imports it cannot resolve.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    passWithNoTests: true,
  },
});
