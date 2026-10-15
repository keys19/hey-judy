// Light / dark / match-the-device. Saved on this device only.
export type ThemeChoice = "light" | "dark" | "system";
const KEY = "judy-theme";

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice = getTheme()) {
  if (typeof document === "undefined") return;
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", !!dark);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#17141C" : "#F3F3F5");
}

export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* private mode: still apply for this visit */
  }
  applyTheme(choice);
}

// Runs before the page paints, so there's no white flash in dark mode.
export const THEME_BOOT_SCRIPT = `(function(){try{var v=localStorage.getItem("${KEY}");var d=v==="dark"||(v!=="light"&&window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})();`;
