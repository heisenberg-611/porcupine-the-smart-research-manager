import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/ui";

export const metadata: Metadata = {
  title: "Cookies",
  description:
    "porcupineResearch sets two cookies, both strictly necessary, both first-party. There is no analytics, no advertising, no third-party tracker, and therefore no consent banner.",
};

/**
 * Short, because the honest version of this page is short.
 *
 * Most cookie policies are long for one of two reasons: the site has a lot of
 * trackers, or it wants to look thorough. This app has neither problem — two
 * first-party cookies and a localStorage key, none of which follow anyone
 * anywhere — and a page padded out to look like a policy would obscure the
 * only fact a reader wants, which is that nothing here is tracking them.
 *
 * The absence of a consent banner is a legal consequence, not an oversight,
 * and the page says which exemption it is relying on. That sentence is the
 * reason this page exists at all: someone will otherwise assume the banner was
 * forgotten.
 */
export default function CookiesPage() {
  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-16">
      <PageHeader
        title="Cookies"
        description="Two cookies, both first-party, both required to keep you signed in. No analytics, no advertising, nothing that follows you off this site."
      />

      <div className="longform">
        <h2>Why there is no consent banner</h2>
        <p>
          Consent is required for cookies that are not strictly necessary — analytics,
          advertising, personalisation, anything that profiles a visitor. This app sets
          none of those, so there is nothing to ask about. Under the ePrivacy Directive
          and the UK PECR, cookies strictly necessary to deliver a service the user asked
          for are exempt, and a banner offering a choice that does not exist would be
          theatre.
        </p>
        <p>
          The public pages — the one you are reading, and the twelve linked from the
          footer — set no cookies at all. You can read every one of them without the app
          storing anything in your browser.
        </p>

        <h2>What is set once you sign in</h2>
        <ul>
          <li>
            <strong>Session cookies.</strong> A pair of first-party cookies holding your
            access and refresh tokens, issued when you sign in and refreshed as you use
            the app. Without them every page load would ask you to sign in again. They are{" "}
            <code>HttpOnly</code>, so page scripts cannot read them, and{" "}
            <code>SameSite</code>-restricted so they are not sent from other sites.
            Signing out clears them.
          </li>
          <li>
            <strong>Your theme choice.</strong> Stored in <code>localStorage</code>, not a
            cookie, and never sent to the server — which is why the setting is per-browser
            rather than per-account. It holds one of three words: light, dark, or nothing
            at all when you are following your system.
          </li>
        </ul>
        <p>
          There is a third thing in browser storage worth naming, though it is not a
          cookie and it is not tracking: if you register a browser so that unlocking your
          encrypted messages does not need the passphrase every time, that browser holds
          key material locally. It never leaves the machine, and you can revoke that
          browser from the app. <Link href="/security">Security</Link> explains the
          mechanism.
        </p>

        <h2>What is not here</h2>
        <ul>
          <li>No analytics of any kind — no page-view counting, no session recording.</li>
          <li>No advertising or retargeting pixels, and no social media trackers.</li>
          <li>
            No third-party scripts on the application pages at all. That is a security
            requirement rather than a privacy gesture: your unencrypted message text
            exists in the tab, and anything running there could read it.
          </li>
          <li>
            No fingerprinting, and no attempt to identify you across visits when you are
            signed out.
          </li>
        </ul>

        <h2>Blocking them</h2>
        <p>
          Your browser can refuse cookies from this site. The public pages will be
          unaffected; signing in will not work, since the session cookie is what a
          signed-in request consists of. Clearing site data signs you out and resets your
          theme to follow your system — and, if you had registered the browser for
          encryption, requires you to unlock with your recovery passphrase again.
        </p>

        <h2>Changes</h2>
        <p>
          If this app ever sets a cookie that is not strictly necessary, this page changes
          first and a consent mechanism ships with it. See the{" "}
          <Link href="/privacy">privacy policy</Link> for what is collected beyond the
          browser, and the <Link href="/dpa">data processing page</Link> for where it is
          held.
        </p>
      </div>
    </main>
  );
}
