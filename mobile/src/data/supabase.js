// Proveedor "supabase" — PREPARADO, TODAVÍA NO EN USO.
//
// Usa las funciones RPC definidas en supabase/migrations/ (ver docs/SUPABASE.md). Las tablas
// tienen RLS sin políticas, así que la anon key no puede leerlas ni escribirlas directamente:
// todo pasa por funciones que validan el token de acceso emitido por verify_access().
//
// Para activarlo: aplicar la migración en el proyecto de Supabase, completar VITE_SUPABASE_URL y
// VITE_SUPABASE_ANON_KEY en mobile/.env y poner VITE_DATA_PROVIDER=supabase.
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config.js";
import { DataError } from "./errors.js";

let client;

function supabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new DataError(
      "NOT_CONFIGURED",
      "Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en la configuración de la app."
    );
  }
  // Sin sesión de Supabase Auth: el acceso se maneja con el token propio de la app.
  client ||= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

const KNOWN_CODES = [
  "UNAUTHORIZED",
  "INVALID_PASSWORD",
  "TOO_MANY_ATTEMPTS",
  "STORE_NOT_FOUND",
  "CHANGE_NOT_FOUND",
  "VALIDATION_ERROR",
];

async function rpc(name, params) {
  let result;
  try {
    result = await supabase().rpc(name, params);
  } catch (e) {
    if (e instanceof DataError) throw e;
    throw new DataError("NETWORK", "No hay conexión con el servidor. Revisá tu internet.");
  }
  const { data, error } = result;
  if (!error) return data;
  // Las funciones SQL lanzan el código como mensaje y la explicación en `hint`.
  const code = KNOWN_CODES.find((c) => error.message === c);
  if (code) throw new DataError(code, error.hint || error.message);
  if (!error.code && /fetch/i.test(error.message)) {
    throw new DataError("NETWORK", "No hay conexión con el servidor. Revisá tu internet.");
  }
  throw new DataError("UNKNOWN", error.message || "Error de Supabase.");
}

const toStore = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  address: row.address,
  latitude: row.latitude,
  longitude: row.longitude,
  locationUpdatedAt: row.location_updated_at,
  changeCount: Number(row.change_count),
});

const toChange = (row) => ({
  id: row.id,
  storeId: row.store_id,
  latitude: row.latitude,
  longitude: row.longitude,
  accuracyM: row.accuracy_m,
  source: row.source,
  previousLatitude: row.previous_latitude,
  previousLongitude: row.previous_longitude,
  createdAt: row.created_at,
});

export async function verifyAccess(password) {
  // verify_access no lanza error ante contraseña incorrecta: devuelve { ok: false, error, message }.
  const data = await rpc("verify_access", { p_password: password });
  if (!data.ok) {
    const code = KNOWN_CODES.includes(data.error) ? data.error : "UNKNOWN";
    throw new DataError(code, data.message || "No se pudo verificar la contraseña.");
  }
  return { token: data.token, expiresAt: data.expires_at };
}

export async function listStores(token) {
  return (await rpc("list_stores", { p_token: token })).map(toStore);
}

export async function listLocationChanges(token, storeId) {
  return (await rpc("list_store_location_changes", { p_token: token, p_store_id: storeId })).map(
    toChange
  );
}

export async function registerLocation(token, storeId, { latitude, longitude, source, accuracyM }) {
  const data = await rpc("register_store_location", {
    p_token: token,
    p_store_id: storeId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_source: source,
    p_accuracy_m: accuracyM ?? null,
  });
  return { store: toStore(data.store), change: toChange(data.change) };
}

export async function exportBackup(token) {
  return rpc("export_backup", { p_token: token });
}

export async function restoreBackup(token, backup) {
  return rpc("restore_backup", { p_token: token, p_backup: backup });
}

export async function deleteLocationChange(token, storeId, changeId) {
  const data = await rpc("delete_store_location_change", {
    p_token: token,
    p_store_id: storeId,
    p_change_id: changeId,
  });
  return { store: toStore(data.store) };
}
