import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // no storage: light
  }
  // shortcut: light unless the user chose dark, because pages still on the legacy stylesheets
  // stay light and a dark system would get a half-dark app; follow prefers-color-scheme once all are migrated.
  return "light";
}

/**
 * Light/dark for the signed-in app: the saved choice, else light.
 * shortcut: applied when the shell mounts (the sign-in pages are light only), so a dark-mode
 * reload flashes light once; move the class to an inline script in index.html when those pages are migrated.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#09090b" : "#fafafa");
    return () => document.documentElement.classList.remove("dark");
  }, [theme]);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("theme", next);
    } catch {
      // not persisted; the choice still applies to this visit
    }
    setTheme(next);
  };
  return { theme, toggleTheme };
}
