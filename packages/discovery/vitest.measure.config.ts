import { defineConfig } from "vitest/config";

/**
 * Measurement runs, kept out of the default suite.
 *
 * These make real calls to bibliographic providers, so they are slow and
 * depend on someone else's uptime. A measurement that runs in CI is a
 * measurement that will eventually be deleted for being flaky — and the
 * number it produces is meant to be read by a person, not asserted.
 *
 *     pnpm --filter @porcupine/discovery measure:oa
 */
export default defineConfig({
  test: {
    include: ["test/**/*.measure.ts"],
    testTimeout: 180_000,
  },
});
