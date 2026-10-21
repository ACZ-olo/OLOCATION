/**
 * Capa de datos de la app. Las pantallas solo usan estas funciones; el proveedor real se elige
 * con VITE_DATA_PROVIDER ("api" o "supabase") y ambos implementan la misma interfaz:
 *
 *   verifyAccess(password)              → { token, expiresAt }
 *   listStores(token)                   → Store[]
 *   listLocationChanges(token, storeId) → LocationChange[]   (más reciente primero)
 *   registerLocation(token, storeId, { latitude, longitude, source, accuracyM })
 *                                       → { store: Store, change: LocationChange }
 *   deleteLocationChange(token, storeId, changeId)
 *                                       → { store: Store }   (tienda ya actualizada)
 *   exportBackup(token)                 → Backup (objeto JSON, ver docs/API_CONTRACT.md)
 *   restoreBackup(token, backup)        → { stores, changes }   (REEMPLAZA todos los datos)
 *
 * Store          { id, code, name, address, latitude, longitude, locationUpdatedAt, changeCount }
 * LocationChange { id, storeId, latitude, longitude, accuracyM, source: "gps"|"map",
 *                  previousLatitude, previousLongitude, createdAt }
 * Los errores son siempre DataError (ver errors.js).
 */
import { DATA_PROVIDER } from "../config.js";
import { DataError } from "./errors.js";

let providerPromise;

function provider() {
  if (!providerPromise) {
    // Import dinámico: el código de Supabase solo se descarga si se usa ese proveedor.
    providerPromise =
      DATA_PROVIDER === "supabase"
        ? import("./supabase.js")
        : DATA_PROVIDER === "api"
          ? import("./api.js")
          : Promise.reject(
              new DataError("NOT_CONFIGURED", `Proveedor de datos desconocido: "${DATA_PROVIDER}".`)
            );
  }
  return providerPromise;
}

export const verifyAccess = async (password) => (await provider()).verifyAccess(password);
export const listStores = async (token) => (await provider()).listStores(token);
export const listLocationChanges = async (token, storeId) =>
  (await provider()).listLocationChanges(token, storeId);
export const registerLocation = async (token, storeId, location) =>
  (await provider()).registerLocation(token, storeId, location);
export const deleteLocationChange = async (token, storeId, changeId) =>
  (await provider()).deleteLocationChange(token, storeId, changeId);
export const exportBackup = async (token) => (await provider()).exportBackup(token);
export const restoreBackup = async (token, backup) => (await provider()).restoreBackup(token, backup);

export { DataError };
