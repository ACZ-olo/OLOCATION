import { escapeHtml } from "./format.js";

export const $ = (id) => document.getElementById(id);

/** Ícono del sprite de index.html (<symbol id="i-...">). */
export const icon = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

const TOAST_ICON = { ok: "i-check", error: "i-warn" };
let toastTimer;
/** Mensaje breve abajo de la pantalla (snackbar). kind: "" | "ok" | "error". */
export function toast(message, kind = "") {
  const node = $("toast");
  const text = document.createElement("span");
  text.textContent = message;
  node.innerHTML = TOAST_ICON[kind] ? icon(TOAST_ICON[kind]) : "";
  node.append(text);
  node.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3500); // el tono queda durante la salida
}

/**
 * Estado en lugar de una lista (vacío, sin resultados, error, cargando).
 * state: null (nada) | { icon, title?, text, tone?: "error", action?: { label, run } }
 *        | { loading: "texto para lector de pantalla" }
 */
export function setState(id, state) {
  const node = $(id);
  node.className = node.className.replace(/\s*\b(error|loading)\b/g, "");
  if (!state) {
    node.innerHTML = "";
    return;
  }
  if (state.loading) {
    node.classList.add("loading");
    node.innerHTML = `<p class="sr-only">${escapeHtml(state.loading)}</p>`;
    return;
  }
  if (state.tone) node.classList.add(state.tone);
  node.innerHTML =
    `<span class="state-icon">${icon(state.icon)}</span>` +
    (state.title ? `<p class="state-title">${escapeHtml(state.title)}</p>` : "") +
    `<p class="state-text">${escapeHtml(state.text)}</p>` +
    (state.action
      ? `<button class="btn tonal small state-action" type="button">${icon("i-refresh", "ic sm")} ${escapeHtml(state.action.label)}</button>`
      : "");
  node.querySelector(".state-action")?.addEventListener("click", state.action.run);
}

/** Filas de relleno mientras carga una lista (se reemplazan al llegar los datos). */
export const skeletonRows = (count, row) => Array.from({ length: count }, () => row).join("");

export function setMsg(id, message, kind = "") {
  const node = $(id);
  node.textContent = message;
  node.className = "form-msg" + (kind ? " " + kind : "");
}

let openDialog = null;
let hideTimer;
/** Duración de la salida del diálogo (--duration-quick en styles.css). */
const DIALOG_CLOSE_MS = 150;

/**
 * Diálogo de confirmación. Devuelve una promesa con true (aceptar) o false (cancelar/atrás/Esc).
 * `body` es HTML ya escapado. Al cerrarse, el foco vuelve a donde estaba.
 * - role: "alertdialog" (pide confirmar algo) o "dialog" (formulario).
 * - destructive: el botón de aceptar se pinta de rojo y el foco arranca en "Cancelar".
 * - extra: texto de un tercer botón (entre los dos); si se toca, la promesa da "extra".
 */
export function confirmDialog({
  title,
  body,
  accept = "Aceptar",
  cancel = "Cancelar",
  extra = "",
  role = "alertdialog",
  destructive = false,
}) {
  const dialog = $("dialog");
  const opener = document.activeElement;
  clearTimeout(hideTimer); // se abre otro mientras el anterior terminaba de salir
  dialog.querySelector(".dialog").setAttribute("role", role);
  $("dialogTitle").textContent = title;
  $("dialogBody").innerHTML = body;
  $("dialogBody").scrollTop = 0;
  $("dialogAccept").textContent = accept;
  $("dialogAccept").classList.toggle("destructive", destructive);
  $("dialogCancel").textContent = cancel;
  $("dialogExtra").textContent = extra;
  $("dialogExtra").hidden = !extra;
  const wasHidden = dialog.hidden;
  dialog.hidden = false;
  if (wasHidden) {
    void dialog.offsetWidth; // aplica el estado inicial antes de animar la entrada
  }
  dialog.classList.add("open");
  (destructive ? $("dialogCancel") : $("dialogAccept")).focus();
  return new Promise((resolve) => {
    openDialog = (result) => {
      openDialog = null;
      dialog.classList.remove("open");
      // Se oculta al terminar la salida (fundido + escala); la respuesta no espera la animación.
      hideTimer = setTimeout(() => (dialog.hidden = true), DIALOG_CLOSE_MS);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      resolve(result);
    };
  });
}

/** Cierra el diálogo abierto (como "Cancelar"). Devuelve true si había uno. */
export function closeDialog() {
  if (!openDialog) return false;
  openDialog(false);
  return true;
}

export function initDialog() {
  $("dialogAccept").addEventListener("click", () => openDialog?.(true));
  $("dialogCancel").addEventListener("click", () => openDialog?.(false));
  $("dialogExtra").addEventListener("click", () => openDialog?.("extra"));
  $("dialog").addEventListener("click", (e) => {
    if (e.target === $("dialog")) openDialog?.(false);
  });
  // Teclado: Esc cancela y Tab no sale del diálogo (recorre sus campos y botones).
  document.addEventListener("keydown", (e) => {
    if (!openDialog) return;
    if (e.key === "Escape") {
      e.preventDefault();
      openDialog(false);
    } else if (e.key === "Tab") {
      const items = [...$("dialog").querySelectorAll("input, textarea, select, button")].filter(
        (el) => !el.disabled && el.offsetParent !== null
      );
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
      items[next].focus();
    }
  });
}
