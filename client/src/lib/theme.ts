import { useCallback, useState } from "react";

/**
 * Light or dark. Light is the default; the choice is remembered on this device.
 * index.html applies it before the first paint so the page never flashes the wrong theme.
 * Keep STORAGE_KEY and the default in sync with the script there.
 */
export type Theme = "light" | "dark";

const STORAGE_KEY = "mecrm:theme";

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage blocked: the choice lasts until the page reloads */
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }, []);
  return { theme, toggle };
}
