export const $ = (id) => document.getElementById(id);

/** Ícono del sprite de index.html (<symbol id="i-...">). */
export const icon = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

let toastTimer;
/** Mensaje breve abajo de la pantalla (snackbar). kind: "" | "ok" | "error". */
export function toast(message, kind = "") {
  const node = $("toast");
  node.textContent = message;
  node.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.className = "toast"), 3500);
}

export function setMsg(id, message, kind = "") {
  const node = $(id);
  node.textContent = message;
  node.className = "form-msg" + (kind ? " " + kind : "");
}

let openDialog = null;

/**
 * Diálogo de confirmación. Devuelve una promesa con true (aceptar) o false (cancelar/atrás).
 * `body` es HTML ya escapado.
 */
export function confirmDialog({ title, body, accept = "Aceptar", cancel = "Cancelar" }) {
  const dialog = $("dialog");
  $("dialogTitle").textContent = title;
  $("dialogBody").innerHTML = body;
  $("dialogAccept").textContent = accept;
  $("dialogCancel").textContent = cancel;
  dialog.hidden = false;
  requestAnimationFrame(() => dialog.classList.add("open"));
  $("dialogAccept").focus();
  return new Promise((resolve) => {
    openDialog = (result) => {
      openDialog = null;
      dialog.classList.remove("open");
      dialog.hidden = true;
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
  $("dialog").addEventListener("click", (e) => {
    if (e.target === $("dialog")) openDialog?.(false);
  });
}
