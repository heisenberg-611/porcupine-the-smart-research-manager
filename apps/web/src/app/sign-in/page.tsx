import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main id="main" className="mx-auto flex max-w-md flex-col gap-8 px-6 py-20">
      <div>
        <h1 className="text-ink text-2xl font-semibold tracking-tight">
          Sign in to Porcupine
        </h1>
        <p className="text-muted mt-2 text-sm text-pretty">
          We&rsquo;ll email you a six-digit code. No password to forget.
        </p>
      </div>
      {/* SignInForm reads `next` from the query string, which opts the whole
          route out of static prerendering unless it sits behind Suspense. */}
      <Suspense fallback={<div className="text-muted text-sm">Loading sign-in…</div>}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
