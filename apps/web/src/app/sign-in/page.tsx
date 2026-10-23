import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main id="main" className="mx-auto flex max-w-md flex-col gap-8 px-6 py-16 sm:py-24">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="text-ink hover:text-accent font-serif text-xl font-bold tracking-tight transition-colors"
        >
          porcupine<span className="text-accent">Research</span>
        </Link>
        <Link
          href="/"
          className="text-muted hover:text-ink text-fine inline-flex items-center gap-1 transition-colors"
        >
          ← Back to home
        </Link>
      </div>
      {/* SignInForm reads `next` from the query string, which opts the whole
          route out of static prerendering unless it sits behind Suspense. */}
      <Suspense fallback={<div className="text-muted text-ui">Loading sign-in…</div>}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
