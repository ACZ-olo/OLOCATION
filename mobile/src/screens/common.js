import { revokeAccess } from "../data/index.js";
import { clearAccess, getToken } from "../lib/access.js";
import { toast } from "../lib/ui.js";
import { go } from "../router.js";
import { resetState } from "../state.js";

let pendingAccessMessage = "";

/** Mensaje para mostrar en la pantalla de acceso la próxima vez que se abra. */
export const takeAccessMessage = () => {
  const msg = pendingAccessMessage;
  pendingAccessMessage = "";
  return msg;
};

/**
 * Sale de la app: cierra la sesión en el servidor, borra el acceso guardado y vuelve a la
 * pantalla de contraseña. Sin conexión, el token igual se borra del teléfono (la sesión del
 * servidor vence sola o se cierra al cambiar la contraseña).
 */
export function lockApp(message = "") {
  const token = getToken();
  if (token) revokeAccess(token).catch(() => {});
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
