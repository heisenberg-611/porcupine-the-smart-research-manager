import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { CryptoSessionProvider } from "@/lib/crypto/session";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Porcupine",
    template: "%s · Porcupine",
  },
  description:
    "Research and thesis management: read, screen, extract, synthesize, and write — without keeping tabs on a thousand things across a dozen websites.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfdfc" },
    { media: "(prefers-color-scheme: dark)", color: "#101211" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-canvas text-ink min-h-dvh antialiased">
        <a
          href="#main"
          className="focus:bg-canvas focus:text-ink sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:ring-2 focus:ring-current"
        >
          Skip to content
        </a>
        {/* Wraps everything, because an unlocked identity has to survive
            navigation between project screens. It holds nothing until someone
            unlocks, and holds it only in memory — see the provider. */}
        <CryptoSessionProvider>
          <AppHeader />
          {children}
        </CryptoSessionProvider>
      </body>
    </html>
  );
}
