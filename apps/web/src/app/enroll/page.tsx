import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";

import { needsEnrollment } from "./actions";
import { EnrollForm } from "./enroll-form";

export const metadata: Metadata = { title: "Set up your account" };

export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const { next } = await searchParams;
  // Only ever redirect to a local path — an open redirect here would be a
  // phishing primitive on a sign-in flow.
  const destination = next?.startsWith("/") ? next : "/dashboard";

  if (!(await needsEnrollment())) redirect(destination);

  return (
    <main id="main" className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-16">
      <div>
        <h1 className="text-ink text-title font-semibold tracking-tight">
          One-time setup
        </h1>
        <p className="text-muted text-ui mt-2 text-pretty">
          Porcupine generates an encryption key on this device. It never leaves your
          browser — we store only the public half and a copy of the private half that we
          cannot open.
        </p>
      </div>
      <EnrollForm next="/dashboard" />
    </main>
  );
}
