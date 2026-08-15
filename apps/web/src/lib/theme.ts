/**
 * The theme choice, and the script that applies it before anything is painted.
 *
 * Three states, because two is wrong: light, dark, and system — the default,
 * and the one most people never change. "System" is not a third palette, it is
 * the ABSENCE of a choice: no attribute, and the media query in globals.css
 * decides. Storing "system" as a value would be storing an override that says
 * "do not override".
 */

export const THEME_KEY = "porcupine.theme";

export type Theme = "light" | "dark" | "system";

export const THEMES: readonly { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * Runs in `<head>`, before the first paint.
 *
 * This has to be a blocking inline script and nothing else. React cannot do
 * it: by the time an effect runs the browser has already painted, so a reader
 * who chose dark gets a white flash on every navigation — worst at night,
 * which is when they chose dark.
 *
 * Wrapped in try/catch because `localStorage` throws outright when storage is
 * blocked, and a theme preference is not worth a blank page.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()`;
