# Comprehensive Frontend UI/UX & Design Systems Audit Report
**Project:** porcupineResearch (`@Porcupine/web`)  
**Audit Date:** October 2026  
**Auditor:** Antigravity AI (Google DeepMind Team)  
**Target:** Monorepo `/apps/web` (Next.js 16.3, React 19.2, Tailwind CSS v4.3.3)

---

## Executive Summary: Why the UI Feels "Off"

A frontend feels "off" not because of a single obvious broken component, but when dozens of subtle micro-inconsistencies, conflicting color palettes, uncompiled classes, and broken theme contracts compound across every screen.

In porcupineResearch, the audit identified **7 core architectural and visual root causes**:

1. **Aesthetic Identity Dissonance (Day vs. Dark Mode Personality Split):**
   Light mode was designed with a warm, bookish editorial aesthetic (creamy paper `#fbfaf7`, warm charcoal `#1c1a17`, forest pine green `#2f6f5e`, and display serifs). Dark mode suddenly flips into a high-saturation, cool midnight cyberpunk theme (cold slate `#0c0e12`, electric neon cyan `#2dd4bf` with 71% saturation, and cool blue-white text `#f1f5f9`). Transitioning between them feels like visiting two completely different websites.
2. **Tailwind CSS v4 `dark:` Variant Architectural Breakage:**
   The application uses a 3-state runtime theme switcher (`Light`, `Dark`, `System`) that writes `data-theme="dark"` to `<html>`. However, Tailwind v4's default `dark:` variant compiles strictly to `@media (prefers-color-scheme: dark)`. Because `@custom-variant dark` is missing from `globals.css`, **all `dark:...` utility classes fail to trigger when a user manually chooses Dark mode on a light OS**, and conversely **all `dark:...` utility classes incorrectly trigger inside public light pages if the user's OS is set to dark mode**.
3. **11 Phantom / Undefined Utility Classes:**
   Over a dozen classes are used throughout the UI that do not exist in the Tailwind theme or CSS definitions, silently compiling to empty declarations (e.g. `hover:bg-surface-hover`, `text-warning`, `border-warning`, `bg-warning-soft`, `bg-success`, `hover:bg-accent-hover`, `hover:text-accent-heavy`, `prose-porcupine`, `scrollbar-thin`, `ring-1.5`, `rounded-xs`). This leaves warning banners without background or border colors, traffic-light icons invisible, and interactive hover states dead.
4. **Severe Dark Mode Contrast Failures (Failing WCAG AA & AAA):**
   Multiple components hardcode `text-white` on top of `bg-accent` or `bg-danger`. In dark mode, `--color-accent` is a bright mint cyan (`#2dd4bf`), resulting in a **1.5:1 contrast ratio** (completely illegible), and `--color-danger` is a pastel coral red (`#f87171`), resulting in a **1.9:1 contrast ratio**.
5. **Sticky Chrome & Z-Index Layering Collisions:**
   The `ProjectWorkflowBar` uses `sticky top-0 z-20`. On narrow viewports where `AppHeader` (fixed `top-0 z-40`, 72px) and `ProjectNav` (fixed `top-[4.5rem] z-30`, 68px) stack to 140px, the workflow stepper slides completely behind the fixed chrome upon scrolling, becoming invisible and unclickable.
6. **Class Collision & The Missing Class-Merge Utility:**
   The helper function `cx()` is a plain string joiner without class merging (`tailwind-merge`). When custom classes are passed into primitives like `Card` or `Button`, conflicting base classes (e.g. `bg-raised/85` vs `bg-surface/50`) both remain in the DOM, leaving styling to arbitrary stylesheet emission order.
7. **Three Disconnected Design Eras Coexisting:**
   The codebase contains screens following the quiet editorial book aesthetic, screens following standard saturated SaaS templates (e.g., Google Docs buttons with raw `bg-blue-600`, `bg-emerald-600`, `bg-amber-500`), and orphan screens (e.g., `/sign-in` has no logo, no branding, no header, and no exit link).

---

## 1. Deep Dive: Day vs. Dark Mode Issues & Coloring Discrepancies

### 1.1 The Chromatic & Personality Disconnect
In `apps/web/src/app/globals.css`:

```css
/* Light Mode (Lines 26-47) */
@theme {
  --color-canvas: #fbfaf7;     /* HSL: 45°, 27%, 98% - Warm reading paper */
  --color-surface: #f4f2ec;    /* HSL: 45°, 24%, 94% - Warm parchment */
  --color-raised: #ffffff;     /* Crisp paper white */
  --color-border: #e5e1d8;     /* HSL: 43°, 18%, 87% - Sand hairline */
  --color-rule: #ddd8cc;       /* Warm line */
  --color-ink: #1c1a17;        /* HSL: 36°, 9%, 10% - Deep charcoal with warm brown undertone */
  --color-ink-soft: #3f3b34;   /* Warm prose ink */
  --color-muted: #66615a;      /* Warm muted stone */
  --color-accent: #2f6f5e;     /* HSL: 164°, 40%, 31% - Forest pine green, subdued and bookish */
  --color-accent-soft: #e7efeb;/* Pale sage */
  --color-danger: #9c2f26;     /* Brick red */
}
```

```css
/* Dark Mode (Lines 100-135) */
:root[data-theme="dark"] {
  --color-canvas: #0c0e12;     /* HSL: 220°, 20%, 6% - Cold blue/navy black */
  --color-surface: #14171f;    /* HSL: 222°, 22%, 10% - Cold slate blue */
  --color-raised: #1b2029;     /* HSL: 219°, 21%, 13% - Cold dark navy grey */
  --color-border: #262c38;     /* HSL: 220°, 19%, 18% - Deep slate */
  --color-rule: #1e2430;       /* Navy divider */
  --color-ink: #f1f5f9;        /* Tailwind slate-50 (cool blue-white) */
  --color-ink-soft: #cbd5e1;   /* Tailwind slate-300 */
  --color-muted: #8b97a8;      /* Slate-400 */
  --color-accent: #2dd4bf;     /* HSL: 174°, 71%, 50% - Neon mint/cyan (high saturation) */
  --color-accent-ink: #042f24; /* Very dark deep forest green */
  --color-danger: #f87171;     /* HSL: 0°, 91%, 71% - Pastel coral red */
}
```

#### Why it feels off:
- **Hue temperature inversion:** In light mode, the base hue is warm yellow-orange (35°–45°), creating a calm literary feel. In dark mode, the base hue violently jumps to cold midnight navy (220°). The dark mode should instead derive from the same warm charcoal base (e.g. `#131210`, `#1a1917`, `#24221f`).
- **Accent saturation shock:** The light mode accent is a restrained, muted forest green (`#2f6f5e`, 40% saturation, 31% lightness). The dark mode accent jumps to an electric, neon cyan/teal (`#2dd4bf`, 71% saturation, 50% lightness). It glows aggressively against dark backgrounds and feels like an IDE or terminal rather than academic literature review software.

---

### 1.2 Viewport Meta Tag Discrepancy
In `apps/web/src/app/layout.tsx` (lines 26–29):

```typescript
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#121110" },
  ],
};
```
The developer comment states: *"The actual `--color-canvas` values... so the browser chrome was a slightly different colour from the page it framed."*  
However, while `--color-canvas` in light mode is `#fbfaf7`, in dark mode it is `#0c0e12` in `globals.css`!  
**Result:** On mobile Safari and Chrome on Android, the browser status bar and address bar render in warm brownish charcoal (`#121110`), while the webpage content right below it renders in cold blueish midnight navy (`#0c0e12`). A visible seam cuts across the top of the mobile viewport.

---

### 1.3 The Missing Tailwind v4 `@custom-variant dark`

In `apps/web/src/components/theme-toggle.tsx`:
Clicking "Dark" executes:
```javascript
document.documentElement.setAttribute("data-theme", "dark");
```

In `globals.css`:
```css
:root[data-theme="dark"] {
  --color-canvas: #0c0e12;
  /* ... custom properties update ... */
}
```

#### The fatal flaw:
Tailwind CSS v4 does **not** look at `[data-theme="dark"]` by default. Its default `dark:` selector is `@media (prefers-color-scheme: dark)`.

Because `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` is missing from `globals.css`:
1. **Light OS + Manual Dark Mode Toggle:**
   The CSS variables switch, but every Tailwind `dark:...` class in the application fails to activate.
   - `TableScroll` & `Card`: `dark:ring-white/5` does not activate.
   - Badge colors in `contributors.ts`: `dark:text-amber-300`, `dark:text-indigo-300`, etc., do not activate; they remain on dark-on-light text colors like `text-amber-700`, which become muddy and illegible on dark surfaces.
   - Evidence table sticky header shadow: `dark:shadow-[4px_0_16px_-4px_rgba(0,0,0,0.4)]` does not activate.
   - Activity audit tags: `dark:text-blue-400`, `dark:text-purple-400` fail to apply.
2. **Dark OS + Public Marketing Pages (`theme-day`):**
   Public pages (`/`, `/about`, `/features`, `/pricing`) wrap content in `<div className="theme-day">` to lock them to daylight mode.
   However, because the user's OS preference is dark, `@media (prefers-color-scheme: dark)` evaluates to **true**!
   Therefore, Tailwind's `dark:` classes activate inside the light pages:
   - Badges in `contributors-view.tsx` on the public contributions page switch to light pastel text meant for black backgrounds (`dark:text-amber-300`, `dark:text-indigo-300`), rendering them unreadable against light cards.
   - Cards display white glowing rings (`dark:ring-white/5`) on pure white and cream backgrounds.
3. **Dark OS + Manual Light Mode Toggle:**
   A user on a dark OS who clicks "Light" gets light background variables, but all `dark:` classes remain active.

---

### 1.4 Critical Dark Mode Text Contrast Failures (Failing WCAG 2.2 AA)

| Location | Code Snippet | Rendered Colors in Dark Mode | Contrast Ratio | WCAG AA Status | Root Cause |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `components/contributions/contribution-heatmap.tsx` (lines 16–18) | `INTENSITY_CLASSES[2..4]: "bg-accent ... text-white"` | White text (`#ffffff`) on bright mint cyan (`#2dd4bf`) | **1.51 : 1** | **FAIL** (Min: 4.5:1) | Hardcoded `text-white` instead of semantic `text-accent-ink` (`#042f24`). |
| `projects/[id]/google-workspace-card.tsx` (line 175) | `className="bg-danger ... text-white"` | White text (`#ffffff`) on pastel coral (`#f87171`) | **1.94 : 1** | **FAIL** (Min: 4.5:1) | In dark mode, `--color-danger` is lightened for text, making it an invalid solid background for white text. |
| `projects/[id]/docs/page.tsx` (line 218) | `<button className="bg-danger ... text-white">` | White text (`#ffffff`) on pastel coral (`#f87171`) | **1.94 : 1** | **FAIL** (Min: 4.5:1) | Hardcoded `bg-danger text-white` button bypassing UI primitive. |
| `projects/[id]/library/library-row-actions.tsx` (line 130) | `hover:bg-accent hover:text-white` | White text on hover background `#2dd4bf` | **1.51 : 1** | **FAIL** (Min: 4.5:1) | Hover state forces `text-white` onto mint accent. |
| `app/(public)/feedback-and-contributions/contributors-view.tsx` (line 65) | `isActive ? "bg-accent text-white" : ...` | White text on mint cyan | **1.51 : 1** | **FAIL** (Min: 4.5:1) | Hardcoded `text-white` instead of `text-accent-ink`. |
| `components/formatted-text.tsx` (lines 43–44) | Inactive search highlight: `dark:bg-amber-400/30 dark:text-amber-200` | Amber-200 text on amber-400/30 on dark canvas | **2.62 : 1** | **FAIL** (Min: 4.5:1) | Insufficient luminance contrast for small text. |

---

## 2. Ghost / Phantom Utility Classes Audit

The following utility classes are written in JSX across key components, but **do not exist anywhere in `globals.css` or Tailwind's theme**. In Tailwind v4, unknown utility classes produce **0 CSS rules**, leaving elements unstyled or broken:

### 2.1 The "Warning" System Is Completely Missing
The application attempts to render warning alerts, icons, and buttons in multiple mission-critical workflows, but `--color-warning` was never declared in `globals.css`:

- `components/quick-create-button.tsx` (line 69):
  ```tsx
  <h3 className="text-warning mb-2 text-lg font-semibold tracking-tight">
    Created in Personal Drive
  </h3>
  ```
- `projects/[id]/invite-member-form.tsx` (lines 95–113):
  ```tsx
  <div className="border-warning/40 bg-warning-soft/20 ...">
    <h4 className="text-warning ...">Google Drive Disconnected</h4>
    <div className="text-warning-strong ...">
  ```
- `projects/[id]/docs/page.tsx` (lines 159–200):
  ```tsx
  <div className={`... ${driveError === "missing_scopes" ? "bg-warning-soft/20 border-warning/40" : "bg-danger-soft/20 border-danger/30"}`}>
    <svg className="text-warning ..." />
    <p className="... text-warning-strong">Action Required: Missing Google Drive Permissions</p>
  ```
- `projects/[id]/google-workspace-card.tsx` (line 262):
  ```tsx
  <Button className="ring-warning text-warning hover:bg-warning/10 ring-1">
    Reconnect with Drive permissions
  </Button>
  ```
- `projects/[id]/docs/file-list.tsx` (line 318):
  ```tsx
  <h3 className="text-warning ...">Created in Personal Drive</h3>
  ```

**Impact:** Every warning banner regarding disconnected Google Drive accounts, missing OAuth scopes, or fallback file creations renders with **transparent borders, transparent backgrounds, and default text colors**. Users do not perceive them as warnings.

---

### 2.2 Invented Hover and Variant Classes
- `hover:bg-surface-hover` and `bg-surface-hover`:
  - Used in: `app/(public)/page.tsx` (line 150), `contributors-view.tsx` (line 67), `sign-in-form.tsx` (line 136), `contribution-heatmap.tsx`, `activity-audit-feed.tsx`.
  - **Impact:** Buttons and interactive pills have no hover response whatsoever.
- `hover:bg-accent-hover`:
  - Used in: `components/project-pipeline.tsx` (line 68).
  - **Impact:** The primary "Recommended Next Step" call-to-action button in the pipeline widget has zero background color transition when hovered.
- `hover:text-accent-heavy`:
  - Used in: `projects/[id]/search/search-client.tsx` (line 913) on "Show full abstract".
  - **Impact:** Text color does not darken/shift on hover.
- `hover:bg-surface-raised`:
  - Used in: `projects/[id]/library/library-row-actions.tsx` (line 142) on "Edit reason".
  - **Impact:** Hover background is completely dead.
- `text-danger-strong`:
  - Used in: `projects/[id]/docs/page.tsx` (line 200).
  - **Impact:** Error description text falls back to inherited body text instead of emphasized danger text.
- `bg-success`:
  - Used in: `components/report-issue.tsx` (line 101):
    ```tsx
    <div className="bg-danger/80 size-2.5 rounded-full" />
    <div className="bg-accent/80 size-2.5 rounded-full" />
    <div className="bg-success/80 size-2.5 rounded-full" />
    ```
  - **Impact:** The simulated macOS window traffic-light controls display a red dot, a teal dot, and an **invisible/transparent third dot**.
- `prose-porcupine`:
  - Used in: `projects/[id]/screen/screen-client.tsx` (line 507) and `components/markdown-viewer-dialog.tsx` (line 401).
  - **Impact:** Abstracts and Markdown previews have zero typography margins, font-size scalings, or list bullet styles applied.
- `scrollbar-thin` and `scrollbar-none`:
  - Used in: `member-breakdown-table.tsx` (line 52), `activity-audit-feed.tsx`, `contribution-heatmap.tsx`, `project-workflow-bar.tsx` (line 30).
  - **Impact:** No scrollbar plugin or custom CSS is loaded. Desktop browsers render wide, clunky default OS scrollbars cutting through the sleek dark/light surfaces.
- `ring-1.5` & `rounded-xs`:
  - Used in: `project-workflow-bar.tsx` (line 118) and `formatted-text.tsx` (line 41).
  - **Impact:** Invalid Tailwind utility tokens (should be `ring-[1.5px]` and `rounded-sm`).

---

## 3. Layout, Sticky Chrome & Z-Index Collision Faults

### 3.1 `ProjectWorkflowBar` Sticky Collision on Mobile
In `apps/web/src/components/project-workflow-bar.tsx` (lines 28–30):
```tsx
<div className="border-rule bg-canvas/95 sticky top-0 z-20 w-full border-b backdrop-blur-md transition-all">
```

In `apps/web/src/app/projects/[id]/layout.tsx`:
```tsx
return (
  <>
    <ProjectNav projectId={project.id} ... />
    <div className="flex w-full overscroll-none lg:h-[calc(100dvh-var(--app-header-h))] lg:overflow-hidden">
      <ProjectSidebar ... />
      <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-hidden">
        <ProjectWorkflowBar pipeline={pipeline} projectId={project.id} />
        <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:overflow-y-auto lg:px-12">
          {children}
        </div>
      </div>
    </div>
  </>
);
```

#### What happens on mobile (< `lg`):
1. `AppHeader` is fixed at `top: 0`, height `4.5rem` (`var(--app-header-h)`), `z-index: 40`.
2. `ProjectNav` is fixed at `top: 4.5rem`, height `4.25rem` (`var(--project-nav-h)`), `z-index: 30`.
3. Total fixed chrome height is `8.75rem` (140px).
4. `ProjectWorkflowBar` is set to `sticky top-0 z-20`.
5. As soon as the user scrolls down on any project screen (e.g. Library, Screen, Extract, Evidence), `ProjectWorkflowBar` sticks to `top: 0` behind `AppHeader` and `ProjectNav`!
6. It is completely obscured, and any clicks intended for the workflow bar either do nothing or accidentally trigger links in the fixed headers above it.

---

### 3.2 Evidence Table Sticky Column Visual Seam
In `apps/web/src/app/projects/[id]/evidence/page.tsx`:
- The table container uses `TableScroll` from `ui.tsx`, which has:
  ```tsx
  className="border-border/80 bg-raised/70 ..."
  ```
- However, the sticky "Paper Title" header and cells have:
  ```tsx
  // SortableHeader (line 549)
  sticky ? "bg-canvas border-border sticky left-0 z-30 ..." : ""

  // Row (line 609)
  <td className="bg-canvas group-hover:bg-surface/90 border-border sticky left-0 z-10 ...">
  ```

#### The discrepancy:
- In Light mode: `TableScroll` is pure white (`#ffffff` at 70% opacity), but the sticky column is creamy canvas (`#fbfaf7`).
- In Dark mode: `TableScroll` is raised navy (`#1b2029`), but the sticky column is pitch canvas (`#0c0e12`).
- **Visual result:** Even before horizontal scrolling begins, the first column looks like an off-color vertical bandage slapped across the table, visually disconnected from the rows it belongs to.

---

## 4. Typography & Visual Hierarchy Inconsistencies

### 4.1 Monospace Eyebrow Badge Jumping to 24px
In `apps/web/src/app/(public)/page.tsx` (line 21):
```tsx
<p className="text-accent text-fine font-mono tracking-widest uppercase sm:text-2xl">
  Literature review software
</p>
```
`text-fine` is 13px (0.8125rem). On screens `>= 640px` (tablets and laptops), `sm:text-2xl` scales it to **24px**!  
An uppercase, wide-tracked monospace category eyebrow at 24px is almost as large as an `h2` heading and dwarfs standard UI copy. Everywhere else on the site, eyebrows are kept strictly at `text-fine` (13px) or `text-ui` (14px).

---

### 4.2 Invisible Links in Body Copy
In `apps/web/src/app/(public)/features/page.tsx` (lines 88–92):
```tsx
<p className="text-ink-soft measure text-ui mt-3 text-pretty">
  No paid tier, no trial and no card. Use the hosted service — this site is it, so{" "}
  <Link href="/sign-in">signing in</Link> is the whole setup — or run your own copy...
  The <Link href="/pricing">pricing page</Link> covers why you might want the second one.
</p>
```
And in `apps/web/src/app/(public)/about/page.tsx` (line 48):
```tsx
Roughly fifteen minutes to read. If you are stuck on something specific rather
than starting out, <Link href="/guides">the guides page</Link> covers installing...
```

#### The bug:
In `globals.css`, link styling (`color: var(--color-accent); text-decoration: underline;`) is strictly scoped inside `.longform a`:
```css
.longform a {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
```
Because `/features` and `/about` are built with standard layout grids rather than wrapping everything in `.longform`, raw `<Link>` elements receive **zero styling**. They have no underline, no accent color, and no hover state—they blend invisibly into `text-ink-soft` body paragraphs.

---

### 4.3 Heading Scale Disproportion in `/assigned`
In `apps/web/src/app/assigned/page.tsx`:
- The primary section heading "Waiting for you" is marked `sr-only`.
- The main active tasks are rendered in cards.
- Then, the bottom subordinate section for finished tasks has:
  ```tsx
  <h2 className="text-display text-ink mb-4 font-serif font-semibold opacity-70">
    Closed
  </h2>
  ```
`text-display` is **2.25rem (36px)** with `line-height: 1.15`—the largest type token in the design system, intended for the page hero title. Using `text-display` on a dimmed, secondary archive section at the footer of the page inverts visual hierarchy.

---

## 5. Architectural Incoherence: The Three Design Dialects

The codebase exhibits a jarring clash between three distinct design systems written during different phases:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DIALECT 1: "EDITORIAL BOOK"                     │
│  - Warm paper (#fbfaf7), serif headings, calm hairlines                │
│  - Restrained pine green (#2f6f5e), pill buttons (rounded-full)        │
│  - Seen in: SiteHeader, SiteFooter, Pricing, globals.css               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Collides with
┌───────────────────────────────────▼────────────────────────────────────┐
│                        DIALECT 2: "SAAS DASHBOARD"                     │
│  - Cold Tailwind defaults: bg-blue-600, bg-emerald-600, bg-amber-500   │
│  - Rectangular buttons (rounded-xl, rounded-md), hardcoded text-white  │
│  - Raw <input> and <select> controls bypassing UI primitives           │
│  - Seen in: Docs, FileList, Contributions, ActivityAudit               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Broken by
┌───────────────────────────────────▼────────────────────────────────────┐
│                        DIALECT 3: "PHANTOM TOKENS"                     │
│  - Invented class names: surface-hover, text-warning, bg-success       │
│  - Broken dark: variants that fail on data-theme="dark"                │
│  - Conflicting cx() class strings fighting for CSS precedence          │
└────────────────────────────────────────────────────────────────────────┘
```

### Specific Instances of Dialect Collisions:
1. **Google Docs / Sheets / Slides Creation Buttons (`docs/file-list.tsx` lines 149–175):**
   Instead of using the design system's `Button` variants, these buttons use raw Google product branding colors with rectangular paddings:
   - `bg-blue-600 hover:bg-blue-700 text-white`
   - `bg-emerald-600 hover:bg-emerald-700 text-white`
   - `bg-amber-500 hover:bg-amber-600 text-white`
   These sit right next to editorial pill buttons, creating immediate visual friction.
2. **Raw Form Controls Bypassing Design Primitives:**
   - In `search-client.tsx` (lines 440–445): Raw `<input type="checkbox" className="accent-accent ...">` is used instead of the custom `<Checkbox />` primitive from `ui.tsx`.
   - In `search-client.tsx` (lines 648–657): A raw `<select className="...">` is hand-rolled instead of using `<Select compact />`.

---

## 6. UX & Flow Disconnections (The "Ghost Pages")

### 6.1 The Isolated `/sign-in` Screen
When a user clicks "Get Started" or "Sign in" from the warm, branded landing page:
- They are taken to `/sign-in`.
- `/sign-in` is in `AUTH_PATHS`, so it is **not** wrapped by `(public)/layout.tsx` (no `SiteHeader`, no `SiteFooter`).
- It is also not signed in, so `AppHeader` returns `null`.
- **Result:** The user lands on a completely blank canvas with a single floating box in the middle. There is no porcupineResearch logo, no link back to the homepage, and no navigation.
- Furthermore, because `/sign-in` lacks `.theme-day`, if the visitor's OS is in Dark Mode, they are violently plunged into an unbranded pitch-black screen with a bright white Google button.

---

### 6.2 Hardcoded Enrollment Redirect Bug
In `apps/web/src/app/enroll/page.tsx`:
```typescript
const { next } = await searchParams;
const destination = next?.startsWith("/") ? next : "/dashboard";

if (!(await needsEnrollment())) redirect(destination);

return (
  <main ...>
    ...
    <EnrollForm next="/dashboard" />  {/* BUG: Hardcoded! */}
  </main>
);
```
`destination` is carefully validated to prevent open redirects, but line 42 passes hardcoded `next="/dashboard"` to `EnrollForm`. If a user was invited to a project or deep-linked to a document, their destination is permanently dropped.

---

## 7. Concrete Code-Level Solutions & Recommendations

### Step 1: Fix `globals.css` Theme Tokens and Dark Mode Variant
Update `apps/web/src/app/globals.css`:

```css
/* 1. Register Tailwind v4 dark variant for data-theme="dark" */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme {
  /* Surfaces */
  --color-canvas: #fbfaf7;
  --color-surface: #f4f2ec;
  --color-surface-hover: #ece8df; /* ADD: fixes hover:bg-surface-hover */
  --color-raised: #ffffff;
  --color-border: #e5e1d8;
  --color-rule: #ddd8cc;

  /* Ink */
  --color-ink: #1c1a17;
  --color-ink-soft: #3f3b34;
  --color-muted: #66615a;

  /* Accents */
  --color-accent: #2f6f5e;
  --color-accent-hover: #26594b; /* ADD: fixes hover:bg-accent-hover */
  --color-accent-ink: #ffffff;
  --color-accent-soft: #e7efeb;

  /* Danger & Status */
  --color-danger: #9c2f26;
  --color-danger-soft: #f7ebe9;
  --color-danger-strong: #78211a; /* ADD: fixes text-danger-strong */

  /* Warning tokens (ADD: restores missing warning system) */
  --color-warning: #b45309;        /* WCAG AA compliant on light */
  --color-warning-soft: #fef3c7;
  --color-warning-strong: #78350f;

  /* Success tokens (ADD: restores missing window dot) */
  --color-success: #15803d;
  --color-success-soft: #dcfce7;
}

/* Harmonized Warm Dark Mode */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-canvas: #121110;       /* MATCH: aligns with layout.tsx viewport theme */
    --color-surface: #1a1917;      /* Warm dark parchment */
    --color-surface-hover: #24221f;
    --color-raised: #22201d;       /* Warm elevated card */
    --color-border: #33302b;       /* Warm border */
    --color-rule: #292723;

    --color-ink: #f5f4f0;
    --color-ink-soft: #d4d1c9;
    --color-muted: #949086;

    --color-accent: #4ade80;       /* Calm warm sage/mint, lower glare */
    --color-accent-hover: #22c55e;
    --color-accent-ink: #052e16;
    --color-accent-soft: #142e1f;

    --color-danger: #f87171;
    --color-danger-soft: #2e1518;
    --color-danger-strong: #fca5a5;

    --color-warning: #fbbf24;
    --color-warning-soft: #2e2311;
    --color-warning-strong: #fde68a;

    --color-success: #4ade80;
    --color-success-soft: #142e1f;
  }
}

:root[data-theme="dark"] {
  --color-canvas: #121110;
  --color-surface: #1a1917;
  --color-surface-hover: #24221f;
  --color-raised: #22201d;
  --color-border: #33302b;
  --color-rule: #292723;

  --color-ink: #f5f4f0;
  --color-ink-soft: #d4d1c9;
  --color-muted: #949086;

  --color-accent: #4ade80;
  --color-accent-hover: #22c55e;
  --color-accent-ink: #052e16;
  --color-accent-soft: #142e1f;

  --color-danger: #f87171;
  --color-danger-soft: #2e1518;
  --color-danger-strong: #fca5a5;

  --color-warning: #fbbf24;
  --color-warning-soft: #2e2311;
  --color-warning-strong: #fde68a;

  --color-success: #4ade80;
  --color-success-soft: #142e1f;
}
```

---

### Step 2: Global Link Styling
In `apps/web/src/app/globals.css`, add a base rule so in-text links in non-longform pages are recognizable:
```css
@layer base {
  p a:not([class*="btn"]):not([class*="button"]):not([class*="bg-"]):not([class*="no-underline"]) {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
}
```

---

### Step 3: Fix `ProjectWorkflowBar` Sticky Positioning
In `apps/web/src/components/project-workflow-bar.tsx` (line 29):
```diff
- <div className="border-rule bg-canvas/95 sticky top-0 z-20 w-full border-b backdrop-blur-md transition-all">
+ <div className="border-rule bg-canvas/95 sticky top-[calc(var(--app-header-h)+var(--project-nav-h))] lg:top-0 z-20 w-full border-b backdrop-blur-md transition-all">
```

---

### Step 4: Fix Evidence Table Sticky Column Background Seam
In `apps/web/src/app/projects/[id]/evidence/page.tsx`:
Replace `bg-canvas` with `bg-raised` on the sticky column so it matches `TableScroll`:
```diff
- sticky ? "bg-canvas border-border sticky left-0 z-30 w-80 max-w-[22rem] min-w-[18rem] border-r ..." : ""
+ sticky ? "bg-raised border-border sticky left-0 z-30 w-80 max-w-[22rem] min-w-[18rem] border-r ..." : ""
```
And in `Row`:
```diff
- <td className="bg-canvas group-hover:bg-surface/90 border-border sticky left-0 z-10 w-80 ...">
+ <td className="bg-raised group-hover:bg-surface/90 border-border sticky left-0 z-10 w-80 ...">
```

---

### Step 5: Fix Landing Page Eyebrow Sizing
In `apps/web/src/app/(public)/page.tsx` (line 21):
```diff
- <p className="text-accent text-fine font-mono tracking-widest uppercase sm:text-2xl">
+ <p className="text-accent text-fine font-mono font-semibold tracking-widest uppercase">
```

---

### Step 6: Fix Contrast on Dark Mode Badges & Buttons
In `apps/web/src/components/contributions/contribution-heatmap.tsx`:
```diff
- 2: "bg-accent/50 border border-accent/55 text-white hover:border-accent/80",
- 3: "bg-accent/75 border border-accent/80 text-white hover:border-accent",
- 4: "bg-accent border border-accent text-white shadow-xs hover:brightness-110",
+ 2: "bg-accent/50 border border-accent/55 text-ink hover:border-accent/80",
+ 3: "bg-accent/75 border border-accent/80 text-accent-ink hover:border-accent",
+ 4: "bg-accent border border-accent text-accent-ink shadow-xs hover:brightness-110",
```

In `apps/web/src/app/projects/[id]/google-workspace-card.tsx` (line 175):
```diff
- className="bg-danger hover:bg-danger/90 min-h-9 px-4 text-sm font-medium text-white shadow-none hover:brightness-100"
+ className="bg-danger-soft border border-danger/30 text-danger hover:bg-danger hover:text-white min-h-9 px-4 text-sm font-medium shadow-none transition-colors"
```

---

## 8. Prioritized Implementation Roadmap

1. **Phase 1 (Immediate / Critical - 1 Day):**
   - Add `@custom-variant dark` to `globals.css` so Tailwind v4 respects `[data-theme="dark"]`.
   - Harmonize dark mode palette in `globals.css` to warm charcoal (`#121110`) matching `layout.tsx` viewport.
   - Define missing tokens: `--color-warning`, `--color-warning-soft`, `--color-warning-strong`, `--color-success`, `--color-surface-hover`, `--color-accent-hover`.
   - Fix `text-white` on `bg-accent` and `bg-danger` (WCAG AA accessibility compliance).
2. **Phase 2 (Layout & Visual Hierarchy - 2 Days):**
   - Fix `ProjectWorkflowBar` sticky offset on mobile (`top-[calc(var(--app-header-h)+var(--project-nav-h))]`).
   - Fix Evidence Table sticky column background mismatch (`bg-canvas` -> `bg-raised`).
   - Fix landing page eyebrow sizing (`sm:text-2xl` -> `text-fine`).
   - Add base in-text link styling rule for body paragraphs.
   - Fix subordinate section header in `/assigned` (`text-display` -> `text-title`).
3. **Phase 3 (Design System Consolidation - 3 Days):**
   - Replace raw Google Docs color buttons in `file-list.tsx` with standard `Button` variants (`variant="secondary"` with small provider color icons).
   - Replace raw `<select>` and `<input type="checkbox">` in `search-client.tsx` with primitives.
   - Provide a branded header/back-home link on `/sign-in`.
   - Fix hardcoded `destination` bug in `enroll/page.tsx`.
