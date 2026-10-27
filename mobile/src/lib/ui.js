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
 * Diálogo de confirmación. Devuelve una promesa con true (aceptar) o false (cancelar/atrás/Esc).
 * `body` es HTML ya escapado. Al cerrarse, el foco vuelve a donde estaba.
 */
export function confirmDialog({ title, body, accept = "Aceptar", cancel = "Cancelar" }) {
  const dialog = $("dialog");
  const opener = document.activeElement;
  $("dialogTitle").textContent = title;
  $("dialogBody").innerHTML = body;
  $("dialogBody").scrollTop = 0;
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
  $("dialog").addEventListener("click", (e) => {
    if (e.target === $("dialog")) openDialog?.(false);
  });
  // Teclado: Esc cancela y Tab no sale del diálogo (solo tiene los dos botones).
  document.addEventListener("keydown", (e) => {
    if (!openDialog) return;
    if (e.key === "Escape") {
      e.preventDefault();
      openDialog(false);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const next = document.activeElement === $("dialogAccept") ? $("dialogCancel") : $("dialogAccept");
      next.focus();
    }
  });
}
