import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { CryptoSessionProvider } from "@/lib/crypto/session";
import { THEME_SCRIPT } from "@/lib/theme";

import { AppHeaderVisibility } from "@/components/app-header-visibility";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "porcupineResearch",
    template: "%s · porcupineResearch",
  },
  description:
    "Research and thesis management: read, screen, extract, synthesize, and write — without keeping tabs on a thousand things across a dozen websites.",
};

export const viewport: Viewport = {
  // The actual --color-canvas values. These were two near-misses invented
  // before the palette settled, so the browser chrome was a slightly different
  // colour from the page it framed.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before the first paint, so a reader who chose dark never sees a
            white flash. `suppressHydrationWarning` on <html> above is what
            lets this write to the element React is about to hydrate. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
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
          <AppHeaderVisibility>
            <AppHeader />
          </AppHeaderVisibility>
          {children}
        </CryptoSessionProvider>
      </body>
    </html>
  );
}
