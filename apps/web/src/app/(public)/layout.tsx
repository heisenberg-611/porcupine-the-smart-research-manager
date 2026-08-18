import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/**
 * The shell for everything you can read without an account.
 *
 * A route group — the parentheses — so thirteen pages share a header, a footer
 * and a palette without any of them changing URL. `/pricing` is still
 * `/pricing`; there is no `/public/` segment.
 *
 * ─ Why these pages are always light ──────────────────────────────────────
 *
 * `theme-day` pins the palette to the light one regardless of what the reader
 * chose or what their machine reports. That is a deliberate split, not an
 * oversight:
 *
 *   Inside the app, the theme belongs to the reader. They are in it for hours
 *   at a stretch, often at night, and taking that away would be taking away
 *   the reason the toggle exists.
 *
 *   These pages are the product's face. They get linked to, screenshotted and
 *   shown to a supervisor. A landing page that arrives dark because of a
 *   preference set months ago on a different screen is not the page the person
 *   who sent the link was looking at.
 *
 * It is done with a class rather than the `<style>` block with fourteen
 * `!important` declarations that used to sit at the top of the landing page.
 * That block worked, in the narrow sense: it beat `[data-theme="dark"]` by
 * force. It also only ever applied to `/`, so every page it linked to stayed
 * dark, and `!important` on a design token leaves nothing below it — no page
 * in the group could have overridden a single value. The palette now lives in
 * `globals.css` next to the two it is competing with, which is where anyone
 * looking for it will look.
 *
 * The header and footer are siblings of `{children}`, not part of it, so each
 * page still owns its own `<main id="main">` — the skip link's target.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="theme-day bg-canvas text-ink flex min-h-dvh flex-col">
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
