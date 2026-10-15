// Proveedor "api": backend FastAPI (backend/), contrato en docs/API_CONTRACT.md.
import { API_BASE } from "../config.js";
import { DataError } from "./errors.js";

const TIMEOUT_MS = 15000;

async function request(path, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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
