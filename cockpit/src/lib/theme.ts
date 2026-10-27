/**
 * P1-78e: the shell's theme choice. "system" follows `prefers-color-scheme`
 * (no `data-theme` on <html>); "light" and "dark" are stored per browser and
 * applied by the inline script in app.html before first paint. Storage can be
 * refused (a private window, a blocked origin): every access is wrapped, and a
 * refusal reads as "system".
 */
export const THEME_KEY = "cockpit-theme";

export type ThemeChoice = "system" | "light" | "dark";

const ORDER: readonly ThemeChoice[] = ["system", "light", "dark"];

/** The next choice the toggle offers: system, light, dark, then system again. */
export function nextTheme(t: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]!;
}

export function readTheme(storage: Pick<Storage, "getItem"> | undefined): ThemeChoice {
  try {
    const t = storage?.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

/** Store the choice and apply it to <html>; "system" clears both. */
export function applyTheme(
  t: ThemeChoice,
  root: Pick<HTMLElement, "setAttribute" | "removeAttribute">,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
): void {
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try {
    if (t === "system") storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, t);
  } catch {
    // Refused: the choice holds for this page only, and the next load follows the system.
  }
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
};
