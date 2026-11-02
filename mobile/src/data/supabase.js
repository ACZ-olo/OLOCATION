// Proveedor "supabase" (el que usa la app desde 2026-10-16).
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
  "FORBIDDEN",
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
  // Un error no previsto puede traer detalles internos de la base: no se le muestran al usuario.
  console.error(`Supabase ${name}:`, error);
  // `cause` guarda el código de PostgREST (p. ej. PGRST202 = la función no existe con esos
  // parámetros) para que quien llama pueda reaccionar sin mostrarle el detalle al usuario.
  throw Object.assign(
    new DataError("UNKNOWN", "Ocurrió un error en el servidor. Intentá de nuevo en unos minutos."),
    { cause: error.code }
  );
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

const toInvoiceStore = (row) => ({
  ...toStore(row),
  notes: row.notes,
  notesLocation: row.notes_location ?? null,
  createdAt: row.created_at,
});
const toInvoiceChange = (row) => ({ ...toChange(row), storeId: row.invoice_store_id });

export async function verifyAccess(password) {
  // verify_access no lanza error ante contraseña incorrecta: devuelve { ok: false, error, message }.
  const data = await rpc("verify_access", { p_password: password });
  if (!data.ok) {
    const code = KNOWN_CODES.includes(data.error) ? data.error : "UNKNOWN";
    throw new DataError(code, data.message || "No se pudo verificar la contraseña.");
  }
  return { token: data.token, expiresAt: data.expires_at, role: data.role };
}

/** Cierra la sesión en el servidor (el token deja de servir). */
export async function revokeAccess(token) {
  await rpc("revoke_access", { p_token: token });
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

// Borrar tiendas (solo admin; supabase/migrations/20261027150000_delete_stores.sql).
export async function deleteStore(token, storeId) {
  await rpc("delete_store", { p_token: token, p_store_id: storeId });
}

export async function deleteInvoiceStore(token, storeId) {
  await rpc("delete_invoice_store", { p_token: token, p_store_id: storeId });
}

// Registro nuevo (supabase/migrations/20261026090000_invoice_stores.sql).

export async function listInvoiceStores(token) {
  return (await rpc("list_invoice_stores", { p_token: token })).map(toInvoiceStore);
}

export async function registerInvoiceStore(token, { code, name, address, notes, notesLocation }) {
  const params = {
    p_token: token,
    p_code: code,
    p_name: name,
    p_address: address || null,
    p_notes: notes || null,
  };
  let data;
  try {
    data = await rpc("register_invoice_store", { ...params, p_notes_location: notesLocation || null });
  } catch (e) {
    // La base todavía no tiene la migración 20261102110000 (sin p_notes_location): se registra
    // igual, sin el campo nuevo.
    if (e.cause !== "PGRST202") throw e;
    data = await rpc("register_invoice_store", params);
  }
  // filled: campos vacíos que se completaron con esta factura (código ya registrado).
  const filled = (data.filled || []).map((f) => (f === "notes_location" ? "notesLocation" : f));
  return { store: toInvoiceStore(data.store), created: data.created, filled };
}

/** Edición del admin: todos los datos menos la coordenada (migración 20261102140000). */
export async function updateInvoiceStore(token, storeId, { code, name, address, notes, notesLocation }) {
  const data = await rpc("update_invoice_store", {
    p_token: token,
    p_store_id: storeId,
    p_code: code,
    p_name: name,
    p_address: address || null,
    p_notes: notes || null,
    p_notes_location: notesLocation || null,
  });
  return { store: toInvoiceStore(data.store) };
}

const AI_TIMEOUT_MS = 25_000;

/**
 * Analiza con IA las observaciones de una factura (Edge Function supabase/functions/analyze-invoice).
 * Devuelve { notesIsAddress, notesLocation }. Lanza DataError si falla (sin internet, función sin
 * desplegar o sin configurar): quien llama sigue sin la IA.
 */
export async function analyzeInvoice(token, { notes, address }) {
  const call = supabase().functions.invoke("analyze-invoice", { body: { token, notes, address } });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DataError("NETWORK", "La IA tardó demasiado en responder.")), AI_TIMEOUT_MS);
  });
  let result;
  try {
    result = await Promise.race([call, timeout]);
  } catch (e) {
    if (e instanceof DataError) throw e;
    throw new DataError("NETWORK", "No hay conexión con el servidor de IA.");
  } finally {
    clearTimeout(timer);
  }
  const { data, error } = result;
  if (!error && data?.ok && data.result) return data.result;
  // Error de la función: su cuerpo trae { ok: false, error: { code, message } }.
  let body = data;
  if (error?.context && typeof error.context.json === "function") {
    body = await error.context.json().catch(() => null);
  }
  const errorCode = body?.error?.code;
  throw new DataError(
    errorCode === "UNAUTHORIZED" ? "UNAUTHORIZED" : errorCode === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNKNOWN",
    body?.error?.message || "No se pudo analizar la factura con IA."
  );
}

export async function listInvoiceLocationChanges(token, storeId) {
  return (
    await rpc("list_invoice_store_location_changes", { p_token: token, p_store_id: storeId })
  ).map(toInvoiceChange);
}

export async function registerInvoiceLocation(token, storeId, { latitude, longitude, source, accuracyM }) {
  const data = await rpc("register_invoice_store_location", {
    p_token: token,
    p_store_id: storeId,
    p_latitude: latitude,
    p_longitude: longitude,
    p_source: source,
    p_accuracy_m: accuracyM ?? null,
  });
  return { store: toInvoiceStore(data.store), change: toInvoiceChange(data.change) };
}

export async function deleteInvoiceLocationChange(token, storeId, changeId) {
  const data = await rpc("delete_invoice_store_location_change", {
    p_token: token,
    p_store_id: storeId,
    p_change_id: changeId,
  });
  return { store: toInvoiceStore(data.store) };
}
