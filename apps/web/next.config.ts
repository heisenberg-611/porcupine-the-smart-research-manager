import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not build output.
  transpilePackages: ["@porcupine/db", "@porcupine/shared"],

  // The Prisma engine is a native binary and must not be bundled.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],

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
