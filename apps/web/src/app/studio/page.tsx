import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/supabase/server";

import { StudioClient } from "./studio-client";

export const metadata: Metadata = { title: "LaTeX Studio" };

export default async function LatexPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  return (
    // Fills what is left below the sticky app header. The offset was a bare
    // `top-[57px]`, which is not the header's height — `--app-header-h` is,
    // and it is the variable everything else in the app already uses.
    <main
      id="main"
      className="bg-canvas fixed inset-0 top-[var(--app-header-h)] flex flex-col"
    >
      <StudioClient />
    </main>
  );
}
