// Acceso con contraseña general. Se guarda el token (nunca la contraseña):
// - "Recordar este dispositivo": en localStorage, sobrevive a cerrar la app.
// - Si no: en sessionStorage, se pierde al cerrar la app.
import { safeStorage } from "./storage.js";

const KEY = "olocation.access";
const REMEMBER_KEY = "olocation.remember";
const stores = () => [safeStorage(localStorage), safeStorage(sessionStorage)];

export function getAccess() {
  for (const store of stores()) {
    try {
      const access = JSON.parse(store.get(KEY) || "null");
      if (access?.token && (!access.expiresAt || new Date(access.expiresAt) > new Date())) {
        return access;
      }
    } catch {
      // valor corrupto: se ignora
    }
  }
  return null;
}

export const getToken = () => getAccess()?.token || null;

/**
 * true con la contraseña de admin. Un acceso guardado antes de que existieran los roles no trae
 * "role": en el servidor esas sesiones quedaron como empleado.
 */
export const isAdmin = () => getAccess()?.role === "admin";

export function saveAccess(access, remember) {
  clearAccess();
  const [local, session] = stores();
  (remember ? local : session).set(KEY, JSON.stringify(access));
  local.set(REMEMBER_KEY, remember ? "1" : "0");
}

export function clearAccess() {
  for (const store of stores()) store.remove(KEY);
}

/** Última elección de "Recordar este dispositivo" (por defecto, sí). */
export const rememberPreference = () => safeStorage(localStorage).get(REMEMBER_KEY) !== "0";
