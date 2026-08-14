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
    ];
  },
};

export default nextConfig;
