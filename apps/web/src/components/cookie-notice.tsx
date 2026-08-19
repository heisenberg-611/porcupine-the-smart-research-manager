"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * What this site stores, said once, before anybody signs in.
 *
 * ─ Why this is a notice and not an accept/reject gate ─────────────────────
 *
 * There is nothing here to reject. Two first-party session cookies keep you
 * signed in, and a `localStorage` key remembers your theme. No analytics, no
 * advertising, no third-party anything — the application pages load no
 * external scripts at all, which is a security requirement rather than a
 * privacy gesture, because your unencrypted message text exists in that tab.
 *
 * Strictly-necessary cookies are exempt from consent under the ePrivacy
 * Directive and the UK PECR, so a pair of Accept and Reject buttons would be
 * offering a choice that does not exist. Worse, "Reject" would have to either
 * do nothing — which is the dark pattern regulators actually pursue — or sign
 * you out of a site you are trying to use.
 *
 * So this tells you what is stored and what happens if you block it, and gets
 * out of the way. That is the honest version of the thing everybody else
 * builds as a gate.
 *
 * ─ Mechanics ─────────────────────────────────────────────────────────────
 *
 * Dismissal is remembered in `localStorage`, not in a cookie. A cookie banner
 * whose own consent is stored in a cookie is a joke that writes itself, and
 * `localStorage` is not sent to the server, so this component adds nothing to
 * any request.
 *
 * Renders nothing until mounted. The server cannot read `localStorage`, so an
 * SSR guess would show the banner to somebody who dismissed it a month ago and
 * then snatch it away — a flash of content that is worse than a beat of
 * silence. Placed LAST in the document for the same reason it is fixed to the
 * bottom: the skip link must remain the first thing a keyboard reaches.
 */
const STORAGE_KEY = "Porcupine.cookie-notice";

export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "seen") setVisible(true);
    } catch {
      // Storage blocked entirely. Showing the notice on every visit would be
      // its own annoyance, and somebody who has blocked storage has already
      // made the decision this notice is about.
    }
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "seen");
    } catch {
      // It reappears next visit. Nothing else breaks.
    }
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="About cookies on this site"
      className="border-rule bg-raised fixed inset-x-0 bottom-0 z-50 border-t shadow-lg"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-6 py-4">
        <h2 className="text-ink text-ui font-medium">What this site stores</h2>

        <p className="text-ink-soft text-ui text-pretty">
          Two first-party cookies to keep you signed in, and one browser setting
          remembering whether you chose light or dark. That is the whole list.{" "}
          <strong className="text-ink">
            No analytics, no advertising, nothing that follows you anywhere.
          </strong>{" "}
          None of it is optional, which is why there is no button here promising to turn
          things off.
        </p>

        <p className="text-muted text-fine text-pretty">
          <strong className="text-ink-soft">If you block them</strong> in your browser,
          every page you can read now still works — this one, and everything linked from
          the footer. Signing in will not, because the session cookie is what a signed-in
          request is made of. Nothing is lost either way; you simply stay signed out.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={dismiss}
            className="bg-accent text-accent-ink focus-visible:ring-accent text-ui inline-flex min-h-11 items-center rounded-lg px-4 font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
          >
            Got it
          </button>
          <Link
            href="/cookies"
            className="text-accent text-ui focus-visible:ring-accent rounded underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
          >
            Read the detail
          </Link>
        </div>
      </div>
    </div>
  );
}
