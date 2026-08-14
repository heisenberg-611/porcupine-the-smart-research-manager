#!/usr/bin/env bash
# The repo's grep-based guards, runnable locally.
#
# These live in CI, and until now ONLY in CI — so the way to discover you had
# broken one was to push and wait. That happened: the protocol page shipped a
# bare `const { data }` destructure, the exact pattern its own rule forbids,
# and `pnpm lint` said nothing because these are not ESLint rules.
#
# Kept as shell rather than ported to ESLint because two of them read SQL and
# migrations, which ESLint does not.
set -uo pipefail
fail=0

check() {
  local name="$1"; shift
  local output
  output=$("$@" 2>/dev/null)
  if [ -n "$output" ]; then
    printf '\033[31m✗\033[0m %s\n' "$name"
    printf '%s\n' "$output" | sed 's/^/    /'
    fail=1
  else
    printf '\033[32m✓\033[0m %s\n' "$name"
  fi
}

service_key() {
  grep -rn --include='*.ts' --include='*.tsx' \
    -e 'SUPABASE_SERVICE_ROLE_KEY' -e 'SUPABASE_SECRET_KEY' apps/*/src \
    | grep -v '/src/server/'
}

set_config_use() {
  grep -rn --include='*.ts' --include='*.tsx' 'set_config' \
    apps packages --exclude-dir=node_modules --exclude-dir=generated \
    | grep -v 'packages/db/src/index.ts'
}

fts_config() {
  grep -rn --include='*.sql' --include='*.ts' -iE "to_tsvector\(\s*'(english|simple)'" \
    supabase packages apps --exclude-dir=node_modules --exclude-dir=generated \
    | grep -v 'text_search_config' \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(--|//|\*)'
}

raw_controls() {
  grep -rn --include='*.tsx' -E '<(input|select|textarea)\b' apps/*/src \
    | grep -v '/components/ui.tsx'
}

swallowed_errors() {
  grep -rn --include='*.ts' --include='*.tsx' \
    -E 'const \{ *data(: *[A-Za-z_]+)? *\} *= *await' apps/*/src \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)'
}

js_extensions() {
  grep -rn --include='*.ts' --include='*.tsx' -E 'from "\.{1,2}/[^"]+\.js"' \
    apps/*/src packages/*/src packages/*/test | grep -v '/generated/'
}

unsecured_tables() {
  local file tables table
  for file in supabase/migrations/*.sql; do
    tables=$(grep -oiE 'create table (if not exists )?public\.[a-z_]+' "$file" \
             | sed -E 's/.*public\.//' | sort -u)
    for table in $tables; do
      grep -qiE "alter table public\.$table enable row level security" "$file" \
        || echo "$file: $table is created but never has RLS enabled here"
    done
  done
}

# Raw C0 control bytes in source. Tab, newline and carriage return are fine;
# everything else below 0x20 is not.
#
# Written three times in one afternoon while building the XLSX writer, each
# time by pasting a literal control character into a string or a regex. The
# damage is not subtle once you see it — `file` reports the source as "data",
# grep treats it as binary and silently stops matching — but nothing in the
# toolchain says so. ESLint's no-irregular-whitespace catches a BOM and not
# these.
control_bytes() {
  # perl, not `grep -P`: BSD grep on macOS has no PCRE support, so -P fails,
  # prints nothing, and the check PASSES. That is exactly what the first
  # version of this guard did — it reported a clean tick with a control byte
  # planted in the tree, which is why every guard here gets sabotage-tested
  # before it is believed.
  find apps packages supabase scripts docs .github -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.sql' -o -name '*.css' \
       -o -name '*.json' -o -name '*.md' -o -name '*.yml' \) \
    -not -path '*/node_modules/*' -not -path '*/generated/*' \
    -not -path '*/.next/*' -not -path '*/test-results/*' \
    -exec perl -ne 'if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/) {
        print "$ARGV - use a \\u escape\n"; close ARGV;
      }' {} +
}

check "service-role key confined to src/server/"      service_key
check "set_config confined to withUserContext"        set_config_use
check "no hardcoded FTS configuration (R-14)"         fts_config
check "form controls use the shared primitives"       raw_controls
check "no swallowed Supabase query errors"            swallowed_errors
check "no .js extensions in relative imports"         js_extensions
check "every new table is secured in its migration"   unsecured_tables
check "no raw control bytes in source"                control_bytes

exit "$fail"
