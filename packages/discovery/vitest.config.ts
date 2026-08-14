import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Both conventions — see packages/shared/vitest.config.ts.
    include: ["test/**/*.{test,spec}.ts"],
    // The SSRF suite makes a small number of real outbound requests: DNS
    // resolution and redirect behaviour are exactly what is under test, and a
    // mocked resolver would prove nothing about either.
    testTimeout: 20_000,
  },
});
