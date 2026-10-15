// Navegación por hash (#/tiendas/12): funciona igual en el navegador y dentro de la app Android.
// Cada entrada del historial guarda su profundidad para saber si "Volver" puede ir atrás o si
// tiene que ir a la pantalla padre (por ejemplo, al abrir la app directo en una tienda).

const routes = [];
let current = null;

/** pattern: "/tiendas/:id" ; screen: { id, enter(params), leave?(), parent?(params) } */
export function route(pattern, screen) {
  const keys = [];
  const regex = new RegExp(
    "^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$"
  );
  routes.push({ regex, keys, screen, pattern });
}

let guard = () => null;
/** fn(path, screen) → otra ruta a la que redirigir, o null. */
export const setGuard = (fn) => (guard = fn);

const depth = () => history.state?.depth || 0;
const currentPath = () => decodeURIComponent(location.hash.replace(/^#/, "")) || "/";

function match(path) {
  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])) };
  }
  return null;
}

function render() {
  const path = currentPath();
  const found = match(path);
  if (!found) return go("/tiendas", { replace: true });
  const redirect = guard(path, found.screen);
  if (redirect && redirect !== path) return go(redirect, { replace: true });

  if (current && current.screen !== found.screen) current.screen.leave?.();
  for (const r of routes) {
    const el = document.getElementById(r.screen.id);
    if (el) el.hidden = r.screen !== found.screen;
  }
  current = found;
  found.screen.enter(found.params);
}

export function go(path, { replace = false } = {}) {
  const state = { depth: replace ? depth() : depth() + 1 };
  history[replace ? "replaceState" : "pushState"](state, "", "#" + path);
  render();
}

/** Volver: atrás en el historial si se llegó navegando, si no a la pantalla padre. */
export function back() {
  if (depth() > 0) {
    history.back();
    return;
  }
  const parent = current?.screen.parent?.(current.params);
  if (parent) go(parent, { replace: true });
}

/** true si la pantalla actual es "raíz" (en Android, atrás cierra la app). */
export const atRoot = () => !current?.screen.parent;

export function startRouter() {
  window.addEventListener("popstate", render);
  history.replaceState({ depth: 0 }, "", "#" + (currentPath() === "/" ? "/tiendas" : currentPath()));
  render();
}
