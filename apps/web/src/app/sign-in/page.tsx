import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main id="main" className="mx-auto flex max-w-md flex-col gap-8 px-6 py-20">
      {/* SignInForm reads `next` from the query string, which opts the whole
          route out of static prerendering unless it sits behind Suspense. */}
      <Suspense fallback={<div className="text-muted text-ui">Loading sign-in…</div>}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
