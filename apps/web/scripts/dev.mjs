#!/usr/bin/env node
/**
 * Start the dev server, and treat stopping it as stopping it.
 *
 * `pnpm dev` used to print pnpm's failure banner every time the server was
 * shut down — first ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL from the root's
 * `--filter` runner, and after that two `[ELIFECYCLE] Command failed` lines,
 * one per pnpm layer. Nothing was wrong: a process killed by SIGINT or SIGTERM
 * exits with 128+signal, every pnpm in the chain sees a non-zero status, and
 * each says so.
 *
 * That is noise on the one command developers run most, and noise on shutdown
 * is worse than it looks — it trains people to ignore a banner that means
 * something the rest of the time.
 *
 * So the signal is caught, passed to the child, and its death by signal is
 * reported as success. A real crash still exits non-zero and still reports.
 *
 * Verified as a pattern rather than end to end: with a dev server already
 * running in this directory Next refuses to start a second one and exits 1,
 * which exercises the failure path, not the signal path. The signal path was
 * measured on the same wrapper around `sleep`: bare, 143; wrapped, 0.
 */
import { execFileSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");

// Assets first, and synchronously: the dev server must not start serving a
// page that imports a stylesheet this is still writing. Cheap — it exits on
// the version stamp when nothing has changed.
execFileSync(process.execPath, [join(here, "vendor-pdfjs.mjs")], {
  stdio: "inherit",
});

const next = join(app, "node_modules", ".bin", "next");
const child = spawn(next, ["dev", "--turbopack", ...process.argv.slice(2)], {
  stdio: "inherit",
});

// Forwarded rather than ignored, so Next gets to shut down cleanly — it has
// its own handler, and killing it outright leaves the .next lock behind.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  // Asked to stop is not the same as failed.
  process.exit(signal ? 0 : (code ?? 0));
});

child.on("error", (error) => {
  console.error("could not start next dev:", error.message);
  process.exit(1);
});
