import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Both naming conventions. The include used to be `*.spec.ts` only, and a
    // new `agreement.test.ts` sat in this directory being silently ignored —
    // the suite reported green while never running it. scripts/check-tests.sh
    // now fails on a test file no config collects.
    include: ["test/**/*.{test,spec}.ts"],
  },
});
