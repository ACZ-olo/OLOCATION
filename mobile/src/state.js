// Estado compartido entre pantallas (en memoria).
import {
  deleteInvoiceLocationChange,
  deleteLocationChange,
  listInvoiceLocationChanges,
  listInvoiceStores,
  listLocationChanges,
  listStores,
  registerInvoiceLocation,
  registerLocation,
} from "./data/index.js";
import { getToken } from "./lib/access.js";

const STALE_MS = 60_000; // el listado se refresca solo si tiene más de un minuto

/**
 * Los dos módulos de tiendas. Comparten pantallas; cada uno tiene su listado, su ruta y sus
 * funciones de datos (la coordenada y el historial de cada módulo son independientes).
 *   stores   "Registro viejo" (solo admin): el listado de tiendas cargado por el administrador
 *   invoice  "Registro nuevo" ("Tiendas" para el transportista): los clientes tal cual figuran
 *            en las facturas escaneadas
 */
export const MODULES = {
  stores: {
    key: "stores",
    base: "/tiendas",
    list: listStores,
    listChanges: listLocationChanges,
    registerLocation,
    deleteChange: deleteLocationChange,
  },
  invoice: {
    key: "invoice",
    base: "/facturas",
    list: listInvoiceStores,
    listChanges: listInvoiceLocationChanges,
    registerLocation: registerInvoiceLocation,
    deleteChange: deleteInvoiceLocationChange,
  },
};

export const state = {
  stores: null, // Store[] ordenado por nombre
  invoiceStores: null, // InvoiceStore[] ordenado por nombre (registro nuevo)
  version: 0, // sube cada vez que cambia algún listado (para no redibujar de más)
};

const SLOT = { stores: "stores", invoice: "invoiceStores" };
const loadedAt = { stores: 0, invoice: 0 };
const loading = {};

/** Listado del módulo (null si todavía no se cargó). */
export const storesOf = (module) => state[SLOT[module]];

const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.code.localeCompare(b.code);

/** Carga el listado de un módulo (o usa el que ya hay si es reciente). */
export function loadStores({ force = false, module = "stores" } = {}) {
  const items = storesOf(module);
  if (!force && items && Date.now() - loadedAt[module] < STALE_MS) {
    return Promise.resolve(items);
  }
  loading[module] ||= MODULES[module]
    .list(getToken())
    .then((items) => {
      state[SLOT[module]] = items;
      loadedAt[module] = Date.now();
      state.version++;
      return items;
    })
    .finally(() => (loading[module] = null));
  return loading[module];
}

export const findStore = (id, module = "stores") =>
  storesOf(module)?.find((s) => s.id === Number(id)) || null;

/** Reemplaza una tienda con la versión que devolvió el servidor (o la agrega si es nueva). */
export function updateStore(store, module = "stores") {
  const items = storesOf(module);
  if (!items) return;
  state[SLOT[module]] = items.some((s) => s.id === store.id)
    ? items.map((s) => (s.id === store.id ? store : s))
    : [...items, store].sort(byName);
  state.version++;
}

export function resetState() {
  state.stores = null;
  state.invoiceStores = null;
  loadedAt.stores = loadedAt.invoice = 0;
  state.version++;
}
