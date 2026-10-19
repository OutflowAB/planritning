/**
 * Colour themes. Each is a set of CSS variables in app/globals.css under `[data-theme=…]`;
 * "neutral" is the plain :root. The default is what every visitor gets. During development the
 * preview page can try another, kept in localStorage and applied before first paint by the
 * script in the root layout.
 */

export const THEMES = [
  { id: "neutral", name: "Neutral", description: "Ljus meny, svarta knappar. Lugnt och stramt." },
  { id: "kund", name: "Kundfärgen", description: "Mörk meny i en djup ton av kundens färg, knappar i den." },
  { id: "skog", name: "Skog", description: "Djupgrön meny och knappar, kundens färg i detaljerna." },
  { id: "marin", name: "Marin", description: "Marinblå meny och knappar, kundens färg i detaljerna." },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "neutral";

export const THEME_STORAGE_KEY = "planritning-theme-preview";

/** Runs inline before paint, so a previewed theme does not flash the default first. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t&&${JSON.stringify(THEMES.map((theme) => theme.id))}.indexOf(t)>-1)document.documentElement.dataset.theme=t}catch(e){}`;

export function applyThemePreview(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try {
    if (id === DEFAULT_THEME) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    }
  } catch {
    // Without storage the choice simply lasts until the next page load.
  }
}

export function currentTheme(): ThemeId {
  const id = document.documentElement.dataset.theme;
  return THEMES.some((theme) => theme.id === id) ? (id as ThemeId) : DEFAULT_THEME;
}
