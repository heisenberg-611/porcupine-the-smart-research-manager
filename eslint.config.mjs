// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/generated/**",
      "**/*.config.*",
      "supabase/**",
    ],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // Node scripts (pgTAP runner, migration tooling). Plain JS, so eslint's
  // base `no-undef` applies and needs the runtime globals declared. These
  // are CLI tools — printing to stdout is the point.
  {
    files: ["**/scripts/**/*.mjs", "**/*.config.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // ADR-002 / R-02: the Prisma boundary.
  //
  // Prisma bypasses RLS unless it is used through withUserContext(), which
  // wraps the query in a transaction and sets a claim-scoped GUC. Confining
  // every Prisma import to src/server/db/** is what makes that helper
  // impossible to route around. See docs/05-resolution-plan.md R-02.
  // ───────────────────────────────────────────────────────────────────────
  {
    files: ["apps/**/*.{ts,tsx}"],
    ignores: ["apps/*/src/server/db/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@porcupine/db",
              message:
                "Prisma bypasses RLS. Import from '@/server/db' and use withUserContext(), or use supabase-js for user-scoped reads. See docs/05-resolution-plan.md R-02.",
            },
            {
              name: "@prisma/client",
              message:
                "Do not import @prisma/client directly. Use '@/server/db'. See docs/05-resolution-plan.md R-02.",
            },
          ],
        },
      ],
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // The service-role key must never reach a client-reachable module.
  // CI greps for it too; this catches it at authoring time.
  // ───────────────────────────────────────────────────────────────────────
  {
    files: ["apps/**/*.{ts,tsx}"],
    ignores: ["apps/*/src/server/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "SUPABASE_SERVICE_ROLE_KEY bypasses RLS entirely and must never appear outside src/server/**.",
        },
        {
          selector: "Literal[value='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "SUPABASE_SERVICE_ROLE_KEY bypasses RLS entirely and must never appear outside src/server/**.",
        },
      ],
    },
  },
);
