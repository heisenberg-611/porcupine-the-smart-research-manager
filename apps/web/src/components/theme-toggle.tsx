"use client";

import { useEffect, useState } from "react";

import { THEME_KEY, THEMES, type Theme } from "@/lib/theme";

/**
 * Light, dark, or whatever the machine says.
 *
 * A segmented control rather than a single toggling button. A toggle can only
 * express two states, so "follow my system" — the default, and the setting a
 * person is most likely to want back after trying the other two — becomes
 * unreachable once they touch it. Three buttons, all three states visible,
 * current one marked.
 *
 * `aria-pressed` rather than a radiogroup: a radiogroup owes arrow-key roving
 * focus, and three buttons in a header do not justify a focus manager. Each
 * button is tabbable and announces whether it is the active one, which is the
 * information that matters.
 */
export function ThemeToggle() {
  // Starts as null, not "system": the real value lives in localStorage, which
  // the server cannot read. Rendering a guess would mark the wrong button and
  // then correct itself, which is a worse flicker than an unmarked control.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      setTheme(stored === "dark" || stored === "light" ? stored : "system");
    } catch {
      setTheme("system");
    }
  }, []);

  function choose(next: Theme) {
    setTheme(next);

    // "System" is the absence of an override, so it removes rather than sets.
    // See the note in lib/theme.ts.
    if (next === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", next);
    }

    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // The theme still applies for this tab; it just will not be remembered.
    }
  }

  return (
    <div
      role="group"
      aria-label="Theme"
      // Visible on a phone too. It is ~104px, which the header has room for
      // now that the email is hidden there — and a reader on a phone at night
      // is exactly who wants this.
      className="border-rule/80 bg-surface/70 inline-flex items-center gap-0.5 rounded-xl border p-1 shadow-xs"
    >
      {THEMES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => choose(value)}
          aria-pressed={theme === value}
          aria-label={`${label} theme`}
          title={label}
          className={cx(
            "inline-flex size-8 items-center justify-center rounded-lg transition-all",
            "focus-visible:ring-accent focus-visible:ring-2 focus-visible:outline-none",
            theme === value
              ? "bg-raised text-ink shadow-xs font-semibold"
              : "text-muted hover:text-ink hover:bg-surface/50",
          )}
        >
          <Icon theme={value} />
        </button>
      ))}
    </div>
  );
}

/** 16px line icons, inline so the CSP has no external origin to allow. */
function Icon({ theme }: { theme: Theme }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (theme === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }

  if (theme === "dark") {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
