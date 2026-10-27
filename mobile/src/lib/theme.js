// Tema claro/oscuro. Por defecto sigue al teléfono; el botón lo fija y se recuerda.
import { Capacitor } from "@capacitor/core";
import { Style, StatusBar } from "@capacitor/status-bar";
import { safeStorage } from "./storage.js";

const KEY = "olocation.theme";
const BAR_COLORS = { light: "#ffffff", dark: "#1b1f22" }; // = --bar de styles.css
const media = window.matchMedia("(prefers-color-scheme: dark)");

const saved = () => {
  const value = safeStorage(localStorage).get(KEY);
  return value === "light" || value === "dark" ? value : null;
};

export const currentTheme = () => document.documentElement.dataset.theme || "light";

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR_COLORS[theme]);
  for (const btn of document.querySelectorAll(".theme-toggle")) {
    const next = theme === "dark" ? "claro" : "oscuro";
    btn.setAttribute("aria-label", `Cambiar a tema ${next}`);
    btn.title = `Tema ${next}`;
  }
  if (Capacitor.isNativePlatform()) {
    // Barra superior blanca en claro (íconos oscuros) y pizarra en oscuro (íconos claros).
    StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: BAR_COLORS[theme] }).catch(() => {});
  }
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  safeStorage(localStorage).set(KEY, next);
  apply(next);
}

export function initTheme() {
  apply(saved() || (media.matches ? "dark" : "light"));
  media.addEventListener("change", (e) => {
    if (!saved()) apply(e.matches ? "dark" : "light");
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest(".theme-toggle")) toggleTheme();
  });
}
