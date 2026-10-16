// Proveedor "api": backend FastAPI (backend/), contrato en docs/API_CONTRACT.md.
import { API_BASE } from "../config.js";
import { DataError } from "./errors.js";

const TIMEOUT_MS = 60000; // generoso: restaurar un respaldo grande puede tardar

async function request(path, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  // FormData se envía tal cual (el navegador pone el Content-Type con su boundary); el resto, JSON.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new DataError("NETWORK", "No hay conexión con el servidor. Revisá tu internet.");
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no JSON (p. ej. un proxy caído): se trata abajo como error genérico
  }
  if (res.ok) return data;

  const err = (data && data.error) || {};
  const code =
    {
      INVALID_PASSWORD: "INVALID_PASSWORD",
      TOO_MANY_ATTEMPTS: "TOO_MANY_ATTEMPTS",
      UNAUTHORIZED: "UNAUTHORIZED",
      STORE_NOT_FOUND: "STORE_NOT_FOUND",
      CHANGE_NOT_FOUND: "CHANGE_NOT_FOUND",
      INVOICE_NOT_FOUND: "INVOICE_NOT_FOUND",
      VALIDATION_ERROR: "VALIDATION_ERROR",
      ACCESS_NOT_CONFIGURED: "NOT_CONFIGURED",
    }[err.code] || "UNKNOWN";
  const detail = (err.details || []).map((d) => `${d.field}: ${d.message}`).join(" · ");
  throw new DataError(code, detail || err.message || `Error del servidor (HTTP ${res.status}).`);
}

export async function verifyAccess(password) {
  return request("/access", { method: "POST", body: { password } });
}

export async function listStores(token) {
  return (await request("/stores", { token })).items;
}

export async function listLocationChanges(token, storeId) {
  return (await request(`/stores/${storeId}/location-changes`, { token })).items;
}

export async function registerLocation(token, storeId, { latitude, longitude, source, accuracyM }) {
  const body = { latitude, longitude, source };
  if (accuracyM != null) body.accuracyM = Math.round(accuracyM * 10) / 10;
  return request(`/stores/${storeId}/location-changes`, { token, method: "POST", body });
}

export async function exportBackup(token) {
  return request("/backup", { token });
}

export async function restoreBackup(token, backup) {
  return request("/backup", { token, method: "POST", body: backup });
}

export async function deleteLocationChange(token, storeId, changeId) {
  return request(`/stores/${storeId}/location-changes/${changeId}`, { token, method: "DELETE" });
}

// --- Facturas (fotos) ----------------------------------------------------------

/** base64 (sin prefijo data:) → Blob, para subir la imagen como multipart. */
function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function listInvoices(token, storeId) {
  return (await request(`/stores/${storeId}/invoices`, { token })).items;
}

export async function registerInvoice(token, storeId, { base64, mimeType }) {
  const form = new FormData();
  form.append("image", base64ToBlob(base64, mimeType), `factura.${EXT[mimeType] || "jpg"}`);
  // No se fija Content-Type: el navegador agrega el boundary de multipart.
  return request(`/stores/${storeId}/invoices`, { token, method: "POST", body: form });
}

export async function deleteInvoice(token, storeId, invoiceId) {
  return request(`/stores/${storeId}/invoices/${invoiceId}`, { token, method: "DELETE" });
}

/** Descarga la imagen con el token y devuelve un object URL ({ url, revoke }). */
export async function getInvoiceImage(token, storeId, invoiceId) {
  let res;
  try {
    res = await fetch(`${API_BASE}/stores/${storeId}/invoices/${invoiceId}/image`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new DataError("NETWORK", "No hay conexión con el servidor. Revisá tu internet.");
  }
  if (!res.ok) {
    if (res.status === 401) throw new DataError("UNAUTHORIZED", "El acceso venció. Ingresá la contraseña de nuevo.");
    if (res.status === 404) throw new DataError("INVOICE_NOT_FOUND", "La factura ya no está disponible.");
    throw new DataError("UNKNOWN", `No se pudo cargar la imagen (HTTP ${res.status}).`);
  }
  const url = URL.createObjectURL(await res.blob());
  return { url, revoke: () => URL.revokeObjectURL(url) };
}
