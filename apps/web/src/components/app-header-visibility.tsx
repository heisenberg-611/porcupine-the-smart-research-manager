"use client";

import { usePathname } from "next/navigation";

export function AppHeaderVisibility({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // These are the public marketing pages where the dashboard header should not appear
  const hiddenPaths = ["/", "/about", "/privacy", "/terms"];
  
  if (hiddenPaths.includes(pathname)) {
    return null;
  }

  return <>{children}</>;
}
