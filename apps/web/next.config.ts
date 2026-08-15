import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not build output.
  //
  // Note: libsodium-wrappers-sumo@0.7.16 ships a broken ESM build that
  // imports "./libsodium-sumo.mjs" instead of the libsodium-sumo package.
  // Fixed by patches/libsodium-wrappers-sumo@0.7.16.patch rather than a
  // bundler alias, so every consumer gets it — including the future relay.
  transpilePackages: ["@porcupine/db", "@porcupine/shared", "@porcupine/crypto"],

  // The Prisma engine is a native binary and must not be bundled. The
  // generated client also reaches for runtime-utils, which the bundler
  // cannot statically resolve.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/client-runtime-utils",
    "@prisma/adapter-pg",
    "pg",
  ],

  typedRoutes: true,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Presigned R2 URLs are bearer tokens. Never let one leak in a
          // Referer header (hazard B-10).
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
      {
        // `/spike/:path*` as well as `/spike`: the header set applies to the
        // exact source only, so a nested route would silently lose cross-origin
        // isolation and the failure would look like a wasm bug.
        source: "/spike/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        source: "/spike",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        /*
         * The TeX distribution: a 3.5 MB wasm module, a 13 MB bundle, 8 MB of
         * packs.
         *
         * `public/` is served with `max-age=0` by default, so every visit
         * revalidated 24 MB of assets that had not changed since the engine
         * was released — and any miss in the browser's HTTP cache, which for
         * entries this size is common, meant downloading it all again.
         *
         * Safe to call immutable because the contents are copied out of a
         * versioned npm package: they change only when `glyphtex-engine` does,
         * and the worker's Cache Storage key carries that version, so an
         * upgrade lands in a new cache rather than reusing a stale one.
         */
        source: "/latex/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // The worker script itself, AFTER the rule above so it wins: Next
        // applies every matching block in order and the last one to set a
        // header keeps it. Short-lived on purpose — the worker is rebuilt on
        // every deploy, and an immutable copy of last week's worker talking to
        // this week's protocol is a bug nobody would ever find.
        source: "/latex/compile.worker.js",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
