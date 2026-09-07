"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Top-level progress bar that provides instant visual response
 * when clicking internal links, bridging the latency gap while
 * Server Components render over the wire.
 */
export function NavigationProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // When route finishes loading (pathname or searchParams changes), complete and reset.
  useEffect(() => {
    if (active) {
      setProgress(100);
      const timeout = setTimeout(() => {
        setActive(false);
        setProgress(0);
      }, 250);
      return () => clearTimeout(timeout);
    }
  }, [pathname, searchParams]);

  // Clean up any interval on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Intercept click on internal navigation links
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest("a");
      if (!target) return;

      const href = target.getAttribute("href");
      if (!href) return;

      // Ignore external, target="_blank", modified clicks, or download links
      if (
        target.target === "_blank" ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.defaultPrevented ||
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("#") ||
        target.hasAttribute("download")
      ) {
        return;
      }

      // Check if target href is the exact same URL
      try {
        const url = new URL(href, window.location.href);
        const currentUrl = new URL(window.location.href);
        if (
          url.pathname === currentUrl.pathname &&
          url.search === currentUrl.search &&
          url.hash !== currentUrl.hash
        ) {
          return;
        }

        // Start progress bar animation
        if (timerRef.current) clearInterval(timerRef.current);
        setActive(true);
        setProgress(25);

        timerRef.current = setInterval(() => {
          setProgress((prev) => {
            if (prev < 70) return prev + 15;
            if (prev < 90) return prev + 5;
            return prev;
          });
        }, 150);
      } catch {
        // Ignore invalid URLs
      }
    };

    document.addEventListener("click", handleClick, { capture: true });
    return () => {
      document.removeEventListener("click", handleClick, { capture: true });
    };
  }, []);

  if (!active && progress === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-transparent"
    >
      <div
        className="bg-accent h-full shadow-[0_0_8px_var(--color-accent)] transition-all duration-200 ease-out"
        style={{
          width: `${progress}%`,
          opacity: active ? 1 : 0,
        }}
      />
    </div>
  );
}
