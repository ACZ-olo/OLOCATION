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
  // Dirección del cambio para la animación de entrada: más profundo = avanzar.
  const d = depth();
  const nav = forcedNav || (d > renderedDepth ? "forward" : d < renderedDepth ? "back" : "none");
  forcedNav = null;
  renderedDepth = d;
  const changed = current && current.screen.id !== found.screen.id;
  // Por id y no por objeto: los dos módulos de tiendas usan las mismas pantallas.
  for (const r of routes) {
    const el = document.getElementById(r.screen.id);
    if (el) el.hidden = r.screen.id !== found.screen.id;
  }
  if (changed) animateIn(document.getElementById(found.screen.id), nav);
  current = found;
  found.screen.enter(found.params);
}

let renderedDepth = 0;
let forcedNav = null;
const withEndListener = new WeakSet();

/** Entrada de la pantalla nueva (styles.css, .screen.is-entering). La primera no se anima. */
function animateIn(el, nav) {
  if (!el) return;
  // Un solo listener por pantalla. animationcancel: si se sale antes de que termine (pantalla
  // oculta), animationend no llega y la clase quedaba puesta.
  if (!withEndListener.has(el)) {
    withEndListener.add(el);
    const done = (e) => {
      if (e.target === el) el.classList.remove("is-entering");
    };
    el.addEventListener("animationend", done);
    el.addEventListener("animationcancel", done);
  }
  el.classList.remove("is-entering");
  el.dataset.nav = nav;
  void el.offsetWidth; // reinicia la animación si se repite la misma pantalla
  el.classList.add("is-entering");
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
  if (parent) {
    forcedNav = "back"; // misma profundidad, pero es volver
    go(parent, { replace: true });
  }
}

/** true si la pantalla actual es "raíz" (en Android, atrás cierra la app). */
export const atRoot = () => !current?.screen.parent;

export function startRouter() {
  window.addEventListener("popstate", render);
  history.replaceState({ depth: 0 }, "", "#" + (currentPath() === "/" ? "/tiendas" : currentPath()));
  render();
}
