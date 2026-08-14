#!/usr/bin/env bash
# Every test file is actually collected by a test run.
#
# WHY THIS EXISTS. Three times now, a test file has sat in this repo being
# silently ignored while the suite reported green:
#
#   1. apps/web had a `test` script and a vitest config that NOTHING invoked.
#   2. packages/shared included only `test/**/*.spec.ts`, so a new
#      `agreement.test.ts` in that very directory was never collected.
#   3. packages/discovery had the same include, waiting to do the same thing.
#
# A test that does not run is worse than no test. It reports the reassurance
# of coverage while providing none, and it fails silently in the one direction
# nobody checks — you notice a test that fails, never one that is absent.
#
# This asks VITEST what it would collect, rather than pattern-matching config
# files, so it cannot be fooled by a config shape it did not anticipate.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0

# Directories owned by Playwright, not vitest. Playwright has its own config
# and its own run; a spec here is not an orphan.
PLAYWRIGHT_DIRS="e2e trial"

for pkg_json in packages/*/package.json apps/*/package.json; do
  dir=$(dirname "$pkg_json")
  grep -q '"test": "vitest' "$pkg_json" || continue

  # What vitest says it will run.
  collected=$( (cd "$dir" && pnpm exec vitest list --filesOnly --run 2>/dev/null) \
               | grep -E '\.(test|spec)\.(ts|tsx)$' \
               | sed "s|^.*/$dir/||" | sed 's|^\./||' | sort -u)

  # What is actually on disk.
  prune=""
  for d in $PLAYWRIGHT_DIRS; do prune="$prune -path ./$d -prune -o"; done
  # shellcheck disable=SC2086
  on_disk=$( (cd "$dir" && find . $prune \
                \( -name '*.test.ts' -o -name '*.test.tsx' \
                   -o -name '*.spec.ts' -o -name '*.spec.tsx' \) -print) \
             | grep -v node_modules | sed 's|^\./||' | sort -u)

  orphans=$(comm -23 <(printf '%s\n' "$on_disk") <(printf '%s\n' "$collected"))

  if [ -n "$orphans" ]; then
    printf '\033[31m✗\033[0m %s — test files that no test run collects:\n' "$dir"
    printf '%s\n' "$orphans" | sed 's|^|    |'
    fail=1
  else
    count=$(printf '%s\n' "$on_disk" | grep -c . || true)
    printf '\033[32m✓\033[0m %-22s %s test file(s), all collected\n' "$dir" "$count"
  fi
done

exit "$fail"
