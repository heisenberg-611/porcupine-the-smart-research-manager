import base from "./playwright.config";

/**
 * Measurements, not tests.
 *
 * Its own config because `*.measure.ts` deliberately does not match the
 * default `testMatch`, so `pnpm test:e2e` never runs it: a measurement takes
 * minutes, needs `pnpm db:seed --all-extracted` to have been run first, and
 * has no pass/fail worth gating a merge on. It prints numbers.
 *
 *     pnpm db:seed --all-extracted
 *     pnpm --filter @porcupine/web measure
 *
 * One browser, no retries, workers: 1 — a timing taken while another worker is
 * loading a 300-row page on the same machine is not a timing.
 */
export default {
  ...base,
  testMatch: "**/*.measure.ts",
  workers: 1,
  retries: 0,
  projects: [base.projects![0]!],
};
