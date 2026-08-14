"use client";

import { RouteError } from "@/components/route-error";

import "./globals.css";

/**
 * The last resort: a failure in the ROOT layout itself, which replaces the
 * whole document rather than rendering inside it. It therefore has to supply
 * its own html and body, and cannot rely on anything the layout provides.
 *
 * Without this file such a failure shows Next's unstyled default. With it, the
 * one error a user is least equipped to interpret at least looks like the
 * product and says what happened.
 */
export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-canvas text-ink min-h-dvh antialiased">
        <RouteError {...props} />
      </body>
    </html>
  );
}
