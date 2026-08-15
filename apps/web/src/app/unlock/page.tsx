import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { getCurrentUser } from "@/lib/supabase/server";

import { DeviceList } from "./device-list";
import { UnlockForm } from "./unlock-form";

export const metadata: Metadata = { title: "Unlock" };

/**
 * A route, not a dialog.
 *
 * Unlocking is consequential and occasionally slow — Argon2id is deliberately
 * expensive — and a modal that appears over whatever you were doing is the
 * wrong shape for both. A route is bookmarkable, survives a reload, can be
 * redirected to with a `next`, and needs no focus trap.
 *
 * It also sidesteps the unexplained narrow-layout interaction from Phase 2c
 * week 3, which is not a good reason on its own but is a real one while that
 * remains unexplained.
 */
export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const params = await searchParams;
  const raw = params.next;
  const candidate = Array.isArray(raw) ? raw[0] : raw;

  // Only same-site paths. An open redirect on the page that asks for the
  // passphrase would be a particularly bad one to have.
  const next =
    candidate && candidate.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : "/projects";

  return (
    <main id="main" className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-12">
      <PageHeader
        backHref="/projects"
        backLabel="All projects"
        title="Unlock your keys"
        description="Encrypted content is opened in this browser, with a key only you hold. Nothing here is sent to the server."
      />
      <UnlockForm next={next} />
      <DeviceList />
    </main>
  );
}
