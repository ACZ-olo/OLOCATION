import { clearAccess } from "../lib/access.js";
import { PhotoError, takePhoto } from "../lib/photo.js";
import { $, confirmDialog, toast } from "../lib/ui.js";
import { go } from "../router.js";
import { resetState } from "../state.js";

let pendingAccessMessage = "";

/** Mensaje para mostrar en la pantalla de acceso la próxima vez que se abra. */
export const takeAccessMessage = () => {
  const msg = pendingAccessMessage;
  pendingAccessMessage = "";
  return msg;
};

/** Sale de la app (borra el acceso guardado) y vuelve a la pantalla de contraseña. */
export function lockApp(message = "") {
  clearAccess();
  resetState();
  pendingAccessMessage = message;
  go("/acceso", { replace: true });
}

/**
 * Manejo común de errores de datos. UNAUTHORIZED → volver al acceso.
 * Devuelve el texto a mostrar (o null si ya se manejó).
 */
export function handleDataError(e, { silent = false } = {}) {
  if (e?.code === "UNAUTHORIZED") {
    lockApp(e.message || "El acceso venció. Ingresá la contraseña de nuevo.");
    return null;
  }
  const message = e?.message || "Ocurrió un error inesperado.";
  if (!silent) toast(message, "error");
  return message;
}

/**
 * Pide elegir cámara o galería y toma la foto. Devuelve { base64, mimeType } o null si se canceló.
 * Los errores (permiso, imagen muy grande…) se muestran con un toast.
 */
export async function pickInvoicePhoto() {
  const choice = await confirmDialog({
    title: "Registrar factura",
    body: "<p>¿De dónde querés tomar la foto de la factura?</p>",
    accept: "Cámara",
    cancel: "Galería",
  });
  // El diálogo es binario: aceptar = cámara, cancelar = galería. Para poder "salir" sin elegir,
  // se usa un tercer estado: si se cierra con la tecla atrás, confirmDialog resuelve false igual
  // que "Galería"; es un compromiso aceptable (abrir la galería no hace daño y se puede cancelar).
  try {
    return await takePhoto(choice ? "camera" : "gallery");
  } catch (e) {
    if (e instanceof PhotoError) {
      if (e.code === "CANCELLED") return null;
      toast(e.message || "No se pudo obtener la foto.", "error");
      return null;
    }
    throw e;
  }
}

let viewerUrl = null;
let viewerRevoke = null;

/** Abre el visor de imagen a pantalla completa con una URL ya cargada. */
export function openImageViewer(url, revoke = () => {}) {
  closeImageViewer();
  viewerUrl = url;
  viewerRevoke = revoke;
  $("imageViewerImg").src = url;
  const viewer = $("imageViewer");
  viewer.hidden = false;
  requestAnimationFrame(() => viewer.classList.add("open"));
}

export function closeImageViewer() {
  const viewer = $("imageViewer");
  if (viewer.hidden) return false;
  viewer.classList.remove("open");
  viewer.hidden = true;
  $("imageViewerImg").removeAttribute("src");
  viewerRevoke?.();
  viewerUrl = viewerRevoke = null;
  return true;
}

export function initImageViewer() {
  $("imageViewerClose").addEventListener("click", closeImageViewer);
  $("imageViewer").addEventListener("click", (e) => {
    if (e.target === $("imageViewer")) closeImageViewer();
  });
}
